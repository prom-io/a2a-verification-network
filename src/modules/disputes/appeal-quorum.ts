import { ethers } from 'ethers';

export enum AppealVoteChoice {
  /** The dispute resolution stands. */
  UPHOLD = 'uphold',
  /** The dispute resolution was wrong and is reversed. */
  OVERTURN = 'overturn',
}

export enum AppealDecision {
  UPHELD = 'upheld',
  REVERSED = 'reversed',
}

/**
 * Size of the appeal panel for a verdict issued by `originalCommitteeSize`
 * validators. The panel has to be clearly larger than the body it reviews, and
 * odd, so `multiplier` times the committee plus one: 3 becomes 7 by default.
 */
export function appealPanelSize(originalCommitteeSize: number, multiplier: number): number {
  const base = Math.max(1, Math.trunc(originalCommitteeSize));
  const factor = Math.max(2, Math.trunc(multiplier) || 2);
  return base * factor + 1;
}

/**
 * Votes needed to reverse a resolution: two thirds of the panel, rounded up.
 * Reversing a decision that money has already moved on takes more than a bare
 * majority; anything short of it leaves the resolution in place.
 */
export function reversalQuorum(panelSize: number): number {
  return Math.ceil((2 * panelSize) / 3);
}

export interface AppealTally {
  uphold: number;
  overturn: number;
  panelSize: number;
  quorum: number;
  /**
   * Set as soon as the result can no longer change: enough overturn votes, or
   * so many uphold votes that the quorum is out of reach. Null while open.
   */
  decision: AppealDecision | null;
}

export function tallyAppeal(votes: AppealVoteChoice[], panelSize: number): AppealTally {
  const overturn = votes.filter((vote) => vote === AppealVoteChoice.OVERTURN).length;
  const uphold = votes.length - overturn;
  const quorum = reversalQuorum(panelSize);

  let decision: AppealDecision | null = null;
  if (overturn >= quorum) decision = AppealDecision.REVERSED;
  else if (uphold > panelSize - quorum) decision = AppealDecision.UPHELD;

  return { uphold, overturn, panelSize, quorum, decision };
}

/** Result when voting closes: silence counts for the existing resolution. */
export function decisionAtDeadline(tally: AppealTally): AppealDecision {
  return tally.overturn >= tally.quorum ? AppealDecision.REVERSED : AppealDecision.UPHELD;
}

/** Message a panel member signs (EIP-191) to cast a vote. */
export function appealVoteMessage(appealId: string, vote: AppealVoteChoice): string {
  return `prom-appeal:${appealId}:${vote}`;
}

export function recoverAppealVoter(
  appealId: string,
  vote: AppealVoteChoice,
  signature: string,
): string {
  return ethers.verifyMessage(appealVoteMessage(appealId, vote), signature);
}
