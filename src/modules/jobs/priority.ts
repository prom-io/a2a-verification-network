/**
 * Ordering of the pending-job queue.
 *
 * A job's priority is its fee, measured in fee units, plus one unit for every
 * `agingSeconds` it has been waiting. Paying more moves a job ahead, but only
 * by a bounded amount of waiting time: a job with no fee is not starved, it is
 * overtaken until its age makes up the difference.
 */
export interface PriorityOptions {
  /** Fee, in wei, that is worth one priority point. */
  feeUnitWei: bigint;
  /** Seconds of waiting that are worth one priority point. */
  agingSeconds: number;
}

export const DEFAULT_PRIORITY_OPTIONS: PriorityOptions = {
  feeUnitWei: 10n ** 15n,
  agingSeconds: 60,
};

/** Fees arrive as numeric strings; anything malformed counts as no fee. */
export function parseFee(fee: string | bigint | null | undefined): bigint {
  if (typeof fee === 'bigint') return fee < 0n ? 0n : fee;
  if (!fee) return 0n;
  const integerPart = String(fee).trim().split('.')[0];
  return /^\d+$/.test(integerPart) ? BigInt(integerPart) : 0n;
}

/** Fee in fee units with three decimals, without overflowing a double. */
function feeUnits(feeWei: bigint, feeUnitWei: bigint): number {
  if (feeUnitWei <= 0n) return 0;
  return Number((feeWei * 1000n) / feeUnitWei) / 1000;
}

export function priorityScore(
  feeWei: bigint,
  waitedMs: number,
  options: PriorityOptions = DEFAULT_PRIORITY_OPTIONS,
): number {
  const aging = options.agingSeconds > 0 ? Math.max(0, waitedMs) / 1000 / options.agingSeconds : 0;
  return feeUnits(feeWei, options.feeUnitWei) + aging;
}

export interface QueueCandidate {
  id: string;
  fee: string;
  submittedAt: Date;
}

export interface QueueEntry<T extends QueueCandidate> {
  job: T;
  /** 1 is processed next. */
  position: number;
  score: number;
  waitedSeconds: number;
}

/**
 * Sorts pending jobs by priority, highest first. Equal scores go to the job
 * that was submitted first, and the id settles what is left so the order is
 * the same on every node.
 */
export function orderQueue<T extends QueueCandidate>(
  jobs: T[],
  now: Date,
  options: PriorityOptions = DEFAULT_PRIORITY_OPTIONS,
): QueueEntry<T>[] {
  return jobs
    .map((job) => {
      const waitedMs = Math.max(0, now.getTime() - new Date(job.submittedAt).getTime());
      return {
        job,
        score: priorityScore(parseFee(job.fee), waitedMs, options),
        waitedSeconds: Math.floor(waitedMs / 1000),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(a.job.submittedAt).getTime() - new Date(b.job.submittedAt).getTime() ||
        a.job.id.localeCompare(b.job.id),
    )
    .map((entry, index) => ({
      ...entry,
      position: index + 1,
      score: Number(entry.score.toFixed(3)),
    }));
}
