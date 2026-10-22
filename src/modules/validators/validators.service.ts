import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Validator } from './entities/validator.entity';
import { RegisterValidatorDto } from './dto/register-validator.dto';
import {
  StakingTier,
  TierDefinition,
  buildTierTable,
  parseStake,
  tierForStake,
} from './staking-tiers';

const DEFAULT_MIN_STAKE_WEI = '1000000000000000000';

export interface EligibleValidator {
  id: string;
  tier: StakingTier;
  weight: number;
}

@Injectable()
export class ValidatorsService {
  private readonly tiers: TierDefinition[];

  constructor(
    @InjectRepository(Validator)
    private readonly validatorRepo: Repository<Validator>,
    private readonly configService: ConfigService,
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
    return this.validatorRepo.save(validator);
  }

  async findAll(): Promise<Validator[]> {
    return this.validatorRepo.find();
  }

  async findOne(id: string): Promise<Validator> {
    const validator = await this.validatorRepo.findOneBy({ id });
    if (!validator) throw new NotFoundException(`Validator ${id} not found`);
    return validator;
  }

  async exit(id: string): Promise<Validator> {
    const validator = await this.findOne(id);
    validator.isActive = false;
    return this.validatorRepo.save(validator);
  }

  /** Sets the validator's total stake and moves it to the matching tier. */
  async updateStake(id: string, stake: string): Promise<Validator> {
    const validator = await this.findOne(id);
    validator.stake = stake;
    validator.tier = this.tierOf(stake).tier;
    return this.validatorRepo.save(validator);
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
