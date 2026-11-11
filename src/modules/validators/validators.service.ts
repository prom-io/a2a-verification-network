import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Validator } from './entities/validator.entity';
import { RegisterValidatorDto } from './dto/register-validator.dto';
import {
  EligibleValidator,
  ValidatorSetCache,
  ValidatorSetSnapshot,
} from './validator-set.cache';
import {
  StakingTier,
  TierDefinition,
  buildTierTable,
  parseStake,
  tierForStake,
} from './staking-tiers';

const DEFAULT_MIN_STAKE_WEI = '1000000000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type { EligibleValidator } from './validator-set.cache';

@Injectable()
export class ValidatorsService {
  private readonly tiers: TierDefinition[];

  constructor(
    @InjectRepository(Validator)
    private readonly validatorRepo: Repository<Validator>,
    private readonly configService: ConfigService,
    private readonly setCache: ValidatorSetCache,
  ) {
    const minStake = this.configService.get<string>(
      'security.validators.minStakeWei',
      DEFAULT_MIN_STAKE_WEI,
    );
    this.tiers = buildTierTable(BigInt(minStake));
  }

  async register(dto: RegisterValidatorDto): Promise<Validator> {
    const validator = this.validatorRepo.create({
      address: dto.address,
      publicKey: dto.publicKey,
      stake: dto.stake,
      tier: this.tierOf(dto.stake).tier,
      endpoint: dto.endpoint,
      capabilities: dto.capabilities ?? [],
    });
    const saved = await this.validatorRepo.save(validator);
    this.setCache.invalidate();
    return saved;
  }

  async findAll(): Promise<Validator[]> {
    return this.validatorRepo.find();
  }

  async findOne(id: string): Promise<Validator> {
    const validator = await this.validatorRepo.findOneBy({ id });
    if (!validator) throw new NotFoundException(`Validator ${id} not found`);
    return validator;
  }

  /**
   * Registered validators among the given ids. Committee lists can contain
   * placeholders that are not validator ids at all; those are skipped instead
   * of being sent to a uuid column.
   */
  async findByIds(ids: string[]): Promise<Validator[]> {
    const valid = [...new Set(ids.filter((id) => UUID.test(id)))];
    if (valid.length === 0) return [];
    return this.validatorRepo.findBy({ id: In(valid) });
  }

  async exit(id: string): Promise<Validator> {
    const validator = await this.findOne(id);
    validator.isActive = false;
    validator.exitedAt = validator.exitedAt ?? new Date();
    const saved = await this.validatorRepo.save(validator);
    this.setCache.invalidate();
    return saved;
  }

  /** Sets the validator's total stake and moves it to the matching tier. */
  async updateStake(id: string, stake: string): Promise<Validator> {
    const validator = await this.findOne(id);
    validator.stake = stake;
    validator.tier = this.tierOf(stake).tier;
    const saved = await this.validatorRepo.save(validator);
    this.setCache.invalidate();
    return saved;
  }

  /** Tier thresholds and weights in effect, with stakes as wei strings. */
  tierTable(): Array<{ tier: StakingTier; minStakeWei: string; weight: number }> {
    return this.tiers.map((definition) => ({
      tier: definition.tier,
      minStakeWei: definition.minStakeWei.toString(),
      weight: definition.weight,
    }));
  }

  /**
   * Active validators that hold at least the minimum stake, with the weight
   * their tier gives them in committee selection. The tier is recomputed from
   * the stake instead of read from the column, so a changed minimum stake
   * takes effect without rewriting every row.
   */
  async findEligible(): Promise<EligibleValidator[]> {
    return [...(await this.eligibleSet()).validators];
  }

  /**
   * The eligible set as committee selection sees it: read once per epoch and
   * served from memory in between (see ValidatorSetCache).
   */
  async eligibleSet(): Promise<ValidatorSetSnapshot> {
    return this.setCache.get(() => this.loadEligible());
  }

  private async loadEligible(): Promise<EligibleValidator[]> {
    const active = await this.validatorRepo.findBy({ isActive: true });
    return active
      .map((validator) => {
        const definition = this.tierOf(validator.stake);
        return { id: validator.id, tier: definition.tier, weight: definition.weight };
      })
      .filter((candidate) => candidate.weight > 0);
  }

  private tierOf(stake: string): TierDefinition {
    return tierForStake(parseStake(stake), this.tiers);
  }
}
