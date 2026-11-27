import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoliciesService } from '../policies/policies.service';
import { ReputationService } from '../reputation/reputation.service';
import { ValidatorsService } from '../validators/validators.service';
import { EligibleValidator } from '../validators/validator-set.cache';
import { ScoredCandidate, parseMinScore, scoreCandidates } from './reputation-gate';

export interface PolicyCandidates {
  /** Minimum effective reputation the policy asks for; 0 when it is not gated. */
  minScore: number;
  /** Staked, active validators that meet the minimum. */
  candidates: EligibleValidator[];
  /** How many staked validators the gate turned away. */
  excluded: number;
}

export interface EligibilityReport {
  policyId: string;
  minReputationScore: number;
  qualifying: number;
  validators: ScoredCandidate[];
}

/**
 * Who may sit on the committee of a job: the staked, active validators, and,
 * when the job's policy sets a minimum reputation, only those whose effective
 * score reaches it. Validators nobody has rated yet count with the neutral
 * score, so a policy can choose whether newcomers are let in by setting its
 * minimum below or above it.
 */
@Injectable()
export class EligibilityService {
  private readonly logger = new Logger(EligibilityService.name);

  constructor(
    private readonly validatorsService: ValidatorsService,
    private readonly reputationService: ReputationService,
    private readonly policiesService: PoliciesService,
    private readonly configService: ConfigService,
  ) {}

  async candidatesFor(policyId: string, now = new Date()): Promise<PolicyCandidates> {
    const all = await this.validatorsService.findEligible();
    const minScore = await this.minScoreOf(policyId);
    if (minScore <= 0 || all.length === 0) return { minScore, candidates: all, excluded: 0 };

    const scored = await this.score(all, minScore, now);
    const candidates = scored
      .filter((candidate) => candidate.qualifies)
      .map(({ id, tier, weight, stake }) => ({ id, tier, weight, ...(stake !== undefined ? { stake } : {}) }));
    const excluded = all.length - candidates.length;
    if (excluded > 0) {
      this.logger.debug(
        `Policy ${policyId}: ${excluded} of ${all.length} validators below reputation ${minScore}`,
      );
    }
    return { minScore, candidates, excluded };
  }

  /** Every staked validator with its score and whether the policy would admit it. */
  async report(policyId: string, now = new Date()): Promise<EligibilityReport> {
    const policy = await this.policiesService.findOne(policyId);
    const minScore = parseMinScore(policy.minReputationScore);
    const validators = await this.score(await this.validatorsService.findEligible(), minScore, now);
    return {
      policyId,
      minReputationScore: minScore,
      qualifying: validators.filter((validator) => validator.qualifies).length,
      validators: validators.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)),
    };
  }

  private async minScoreOf(policyId: string): Promise<number> {
    // Jobs may name a policy this instance does not know (the policy registry
    // lives on chain too); those are not gated rather than refused here.
    const policy = await this.policiesService.findById(policyId);
    return parseMinScore(policy?.minReputationScore);
  }

  private async score(
    candidates: ReadonlyArray<EligibleValidator>,
    minScore: number,
    now: Date,
  ): Promise<ScoredCandidate[]> {
    const scores = await this.reputationService.effectiveScores(
      candidates.map((candidate) => candidate.id),
      now,
    );
    const neutral = Number(this.configService.get('reputation.neutralScore', 0.5));
    return scoreCandidates(candidates, scores, minScore, neutral);
  }
}
