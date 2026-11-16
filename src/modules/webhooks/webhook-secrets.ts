/** Secret used when nothing is configured; only acceptable outside production. */
export const DEV_WEBHOOK_SECRET = 'dev-webhook-secret-change-me';

/** Shortest secret accepted in production: 32 characters, e.g. 16 random bytes as hex. */
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

export interface SigningSecretSettings {
  /** WEBHOOK_SIGNING_SECRET: what every delivery is signed with. */
  current?: string;
  /** WEBHOOK_SIGNING_SECRET_PREVIOUS: the secret being rotated out. */
  previous?: string;
  /**
   * WEBHOOK_SIGNING_SECRET_PREVIOUS_UNTIL: ISO time after which the previous
   * secret is dropped. Without it the previous secret stays until removed.
   */
  previousUntil?: string;
  nodeEnv?: string;
}

/**
 * Secrets that sign a delivery sent at `now`, current first.
 *
 * During a rotation both secrets sign every delivery (see signPayload), which
 * gives receivers an overlap window to switch. The window closes on its own at
 * `previousUntil`, so a forgotten rotation does not leave the old secret valid
 * for ever.
 */
export function activeSigningSecrets(settings: SigningSecretSettings, now: Date = new Date()): string[] {
  const current = settings.current?.trim() || DEV_WEBHOOK_SECRET;
  const previous = settings.previous?.trim();
  if (!previous || previous === current) return [current];

  if (settings.previousUntil) {
    const until = new Date(settings.previousUntil);
    if (!Number.isNaN(until.getTime()) && now > until) return [current];
  }
  return [current, previous];
}

/**
 * Problems with the signing configuration, empty when it is usable. Outside
 * production only the format of the rotation deadline is checked; in
 * production a missing, default or short secret is refused, because every
 * receiver would accept forged verdicts signed with it.
 */
export function signingSecretProblems(settings: SigningSecretSettings): string[] {
  const problems: string[] = [];
  if (settings.previousUntil && Number.isNaN(new Date(settings.previousUntil).getTime())) {
    problems.push('WEBHOOK_SIGNING_SECRET_PREVIOUS_UNTIL is not a valid date');
  }
  if (settings.nodeEnv !== 'production') return problems;

  const current = settings.current?.trim() ?? '';
  if (!current || current === DEV_WEBHOOK_SECRET) {
    problems.push('WEBHOOK_SIGNING_SECRET must be set to a real secret in production');
  } else if (current.length < MIN_PRODUCTION_SECRET_LENGTH) {
    problems.push(
      `WEBHOOK_SIGNING_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`,
    );
  }
  const previous = settings.previous?.trim();
  if (previous && previous === DEV_WEBHOOK_SECRET) {
    problems.push('WEBHOOK_SIGNING_SECRET_PREVIOUS cannot be the development secret in production');
  }
  return problems;
}
