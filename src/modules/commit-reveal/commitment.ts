import { ethers } from 'ethers';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';

/**
 * Hash a validator publishes in the commit phase.
 *
 * Job and validator are part of the preimage so a commitment cannot be replayed
 * for another job or copied by another validator; the 32-byte salt keeps the
 * three possible outcomes from being brute-forced out of the hash.
 */
export function computeCommitHash(
  jobId: string,
  validatorId: string,
  outcome: VerdictOutcome,
  salt: string,
): string {
  return ethers.solidityPackedKeccak256(
    ['string', 'string', 'string', 'bytes32'],
    [jobId, validatorId, outcome, salt],
  );
}

/** Address that signed the commitment hash (EIP-191 personal message). */
export function recoverCommitSigner(commitHash: string, signature: string): string {
  return ethers.verifyMessage(ethers.getBytes(commitHash), signature);
}

export interface RevealedVote {
  validatorId: string;
  outcome: VerdictOutcome;
}

export interface Tally {
  /** Outcome backed by a strict majority of the committee, if there is one. */
  outcome: VerdictOutcome | null;
  /** Validators that revealed the winning outcome. */
  supporters: string[];
  counts: Record<VerdictOutcome, number>;
  /** Votes one outcome needs: more than half of the whole committee. */
  quorum: number;
}

/**
 * Counts revealed votes against the size of the committee, not against the
 * number of reveals: validators that stay silent must not make it easier for
 * the rest to reach a verdict.
 */
export function tallyReveals(votes: RevealedVote[], committeeSize: number): Tally {
  const counts: Record<VerdictOutcome, number> = {
    [VerdictOutcome.ACCEPT]: 0,
    [VerdictOutcome.PARTIAL]: 0,
    [VerdictOutcome.REJECT]: 0,
  };
  for (const vote of votes) counts[vote.outcome]++;

  const quorum = Math.floor(committeeSize / 2) + 1;
  const winner = (Object.keys(counts) as VerdictOutcome[]).find(
    (outcome) => counts[outcome] >= quorum,
  );

  return {
    outcome: winner ?? null,
    supporters: winner
      ? votes.filter((vote) => vote.outcome === winner).map((vote) => vote.validatorId)
      : [],
    counts,
    quorum,
  };
}
