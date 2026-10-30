import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityType, ReputationScore } from './entities/reputation-score.entity';
import {
  compositeScore,
  daysToMs,
  decayFactor,
  decayToward,
  foldObservation,
} from './decay';

/** One piece of evidence about how an entity behaved. */
export interface ReputationObservation {
  /** The verdict the entity backed held up. */
  accurate: boolean;
  /** The observation is a dispute the entity lost. */
  disputeLost?: boolean;
}

export interface ReputationView extends ReputationScore {
  /** Score from the stored components, before time decay. */
  rawScore: number;
  /** Score as of now: the raw score pulled towards the neutral score. */
  effectiveScore: number;
  /** Share of the raw score's distance from neutral that is left, 0..1. */
  decayFactor: number;
  halfLifeDays: number;
}

const round4 = (value: number): string => Math.min(1, Math.max(0, value)).toFixed(4);

@Injectable()
export class ReputationService {
  private readonly logger = new Logger(ReputationService.name);

  constructor(
    @InjectRepository(ReputationScore)
    private readonly reputationRepo: Repository<ReputationScore>,
    private readonly configService: ConfigService,
  ) {}

  async findByEntityId(entityId: string, now = new Date()): Promise<ReputationView> {
    const score = await this.reputationRepo.findOneBy({ entityId });
    if (!score)
      throw new NotFoundException(
        `Reputation for entity ${entityId} not found`,
      );
    return this.view(score, now);
  }

  async upsert(data: Partial<ReputationScore>): Promise<ReputationScore> {
    const existing = await this.reputationRepo.findOneBy({
      entityId: data.entityId,
    });
    if (existing) {
      Object.assign(existing, data);
      return this.reputationRepo.save(existing);
    }
    const score = this.reputationRepo.create(data);
    return this.reputationRepo.save(score);
  }

  /**
   * Folds an observation into the entity's averages. Evidence gathered before
   * is first discounted by how long ago the entity was last seen, so the
   * averages follow recent behaviour instead of the whole history.
   */
  async recordObservation(
    entityId: string,
    entityType: EntityType,
    observation: ReputationObservation,
    now = new Date(),
  ): Promise<ReputationScore> {
    const existing = await this.reputationRepo.findOneBy({ entityId });
    const score =
      existing ??
      this.reputationRepo.create({
        entityId,
        entityType,
        accuracy: '1.0000',
        uptime: '1.0000',
        disputeLossRate: '0.0000',
        totalJobs: 0,
        evidenceWeight: '0',
        lastActivityAt: null,
      });

    const factor = this.factorSince(score.lastActivityAt, now);
    const weight = Number(score.evidenceWeight) || 0;
    const accuracy = foldObservation(Number(score.accuracy), weight, observation.accurate ? 1 : 0, factor);
    const losses = foldObservation(
      Number(score.disputeLossRate),
      weight,
      observation.disputeLost ? 1 : 0,
      factor,
    );

    score.accuracy = round4(accuracy.mean);
    score.disputeLossRate = round4(losses.mean);
    score.evidenceWeight = accuracy.weight.toFixed(6);
    score.lastActivityAt = now;
    if (!observation.disputeLost) score.totalJobs += 1;
    return this.reputationRepo.save(score);
  }

  /**
   * Records the same observation for several validators. Reputation is
   * bookkeeping on top of the verdict flow: a failure here is logged and must
   * never fail the job or the dispute that triggered it.
   */
  async recordForValidators(
    validatorIds: string[],
    observation: ReputationObservation,
    now = new Date(),
  ): Promise<void> {
    for (const validatorId of validatorIds) {
      try {
        await this.recordObservation(validatorId, EntityType.VALIDATOR, observation, now);
      } catch (error) {
        this.logger.warn(
          `Could not record reputation for validator ${validatorId}: ${(error as Error).message}`,
        );
      }
    }
  }

  private halfLifeDays(): number {
    return Number(this.configService.get('reputation.halfLifeDays', 30));
  }

  private factorSince(reference: Date | null | undefined, now: Date): number {
    if (!reference) return 1;
    return decayFactor(now.getTime() - new Date(reference).getTime(), daysToMs(this.halfLifeDays()));
  }

  private view(score: ReputationScore, now: Date): ReputationView {
    const rawScore = compositeScore({
      accuracy: Number(score.accuracy),
      uptime: Number(score.uptime),
      disputeLossRate: Number(score.disputeLossRate),
    });
    const neutral = Number(this.configService.get('reputation.neutralScore', 0.5));
    // Rows written before activity was tracked fall back to their last update.
    const factor = this.factorSince(score.lastActivityAt ?? score.lastUpdated, now);

    return {
      ...score,
      rawScore: Number(rawScore.toFixed(4)),
      effectiveScore: Number(decayToward(rawScore, neutral, factor).toFixed(4)),
      decayFactor: Number(factor.toFixed(6)),
      halfLifeDays: this.halfLifeDays(),
    };
  }
}
