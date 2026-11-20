import { registerAs } from '@nestjs/config';
import {
  DEFAULT_THRESHOLD_BPS,
  MAX_THRESHOLD_BPS,
  MIN_THRESHOLD_BPS,
  QuorumWeighting,
  isValidThreshold,
} from '../modules/commit-reveal/weighted-quorum';

export interface QuorumConfig {
  weighting: QuorumWeighting;
  thresholdBps: number;
}

/**
 * Quorum rules for committee votes. They are copied onto each job when its
 * committee is assigned, so changing them affects new rounds only.
 *
 * A malformed value stops the service at startup instead of being replaced by
 * a default: a quorum silently weaker than configured is worse than no start.
 */
export function parseQuorumConfig(env: NodeJS.ProcessEnv = process.env): QuorumConfig {
  const weighting = (env.QUORUM_WEIGHTING || QuorumWeighting.STAKE) as QuorumWeighting;
  if (!Object.values(QuorumWeighting).includes(weighting)) {
    throw new Error(
      `QUORUM_WEIGHTING must be one of ${Object.values(QuorumWeighting).join(', ')}, got ${weighting}`,
    );
  }
  const raw = env.QUORUM_THRESHOLD_BPS;
  const thresholdBps = raw === undefined || raw === '' ? DEFAULT_THRESHOLD_BPS : Number(raw);
  if (!isValidThreshold(thresholdBps)) {
    throw new Error(
      `QUORUM_THRESHOLD_BPS must be an integer from ${MIN_THRESHOLD_BPS} to ${MAX_THRESHOLD_BPS}, got ${raw}`,
    );
  }
  return { weighting, thresholdBps };
}

export default registerAs('quorum', (): QuorumConfig => parseQuorumConfig());
