import { registerAs } from '@nestjs/config';

const numberFrom = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
};

export default registerAs('reputation', () => ({
  // Days after which stale reputation has lost half of its distance from the
  // neutral score. 0 disables decay.
  halfLifeDays: numberFrom(process.env.REPUTATION_HALF_LIFE_DAYS, 30),
  // Score an entity drifts towards when nothing is known about it any more.
  neutralScore: Math.min(1, Math.max(0, numberFrom(process.env.REPUTATION_NEUTRAL_SCORE, 0.5))),
}));
