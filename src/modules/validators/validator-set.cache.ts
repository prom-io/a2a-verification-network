import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StakingTier } from './staking-tiers';

export interface EligibleValidator {
  id: string;
  tier: StakingTier;
  weight: number;
  /** Stake in wei, when known; weighs the validator's vote in stake-weighted quorums. */
  stake?: string;
}

export interface ValidatorSetSnapshot {
  /** Epoch the snapshot belongs to; -1 when caching is switched off. */
  epoch: number;
  takenAt: Date;
  validators: ReadonlyArray<EligibleValidator>;
  totalWeight: number;
}

/**
 * Snapshot of the eligible validator set, reused for a whole epoch.
 *
 * Every committee draw needs the full set of staked, active validators, and
 * reading it per job means one table scan per job. The set changes far less
 * often than jobs arrive, so it is loaded once per epoch and kept in memory.
 *
 * Writes made through this instance (registration, exit, stake change,
 * suspension, reactivation) invalidate the snapshot at once. Writes made by
 * another instance are picked up at the next epoch, so the staleness seen by
 * committee selection is bounded by VALIDATOR_SET_EPOCH_SECONDS.
 */
@Injectable()
export class ValidatorSetCache {
  private snapshot?: ValidatorSetSnapshot;
  private pending?: Promise<ValidatorSetSnapshot>;
  private generation = 0;
  private hits = 0;
  private misses = 0;

  constructor(private readonly configService: ConfigService) {}

  async get(
    load: () => Promise<EligibleValidator[]>,
    now = new Date(),
  ): Promise<ValidatorSetSnapshot> {
    const epochMs = this.epochMs();
    if (epochMs <= 0) {
      this.misses++;
      return this.build(await load(), now, -1);
    }

    const epoch = Math.floor(now.getTime() / epochMs);
    if (this.snapshot && this.snapshot.epoch === epoch) {
      this.hits++;
      return this.snapshot;
    }
    // Callers that arrive while the set is being read share that one read.
    if (this.pending) return this.pending;

    this.misses++;
    const generation = this.generation;
    const pending: Promise<ValidatorSetSnapshot> = load()
      .then((validators) => {
        const snapshot = this.build(validators, now, epoch);
        // A write that landed while the query was running has already made
        // this result stale; hand it to the waiting callers but do not keep it.
        if (generation === this.generation) this.snapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
    this.pending = pending;
    return pending;
  }

  /** Drops the snapshot; the next reader loads the set again. */
  invalidate(): void {
    this.generation++;
    this.snapshot = undefined;
    this.pending = undefined;
  }

  stats(): { hits: number; misses: number; cachedEpoch: number | null } {
    return { hits: this.hits, misses: this.misses, cachedEpoch: this.snapshot?.epoch ?? null };
  }

  private epochMs(): number {
    const seconds = Number(this.configService.get('VALIDATOR_SET_EPOCH_SECONDS', 30));
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  }

  private build(validators: EligibleValidator[], now: Date, epoch: number): ValidatorSetSnapshot {
    return {
      epoch,
      takenAt: now,
      validators: Object.freeze([...validators]),
      totalWeight: validators.reduce((sum, validator) => sum + validator.weight, 0),
    };
  }
}
