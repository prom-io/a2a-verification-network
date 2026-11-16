import {
  DEV_WEBHOOK_SECRET,
  activeSigningSecrets,
  signingSecretProblems,
} from './webhook-secrets';

const NOW = new Date('2026-05-01T12:00:00.000Z');
const STRONG = 'a'.repeat(32);
const OLD = 'b'.repeat(32);

describe('activeSigningSecrets', () => {
  it('falls back to the development secret when nothing is configured', () => {
    expect(activeSigningSecrets({}, NOW)).toEqual([DEV_WEBHOOK_SECRET]);
    expect(activeSigningSecrets({ current: '   ' }, NOW)).toEqual([DEV_WEBHOOK_SECRET]);
  });

  it('signs with the current secret alone outside a rotation', () => {
    expect(activeSigningSecrets({ current: STRONG }, NOW)).toEqual([STRONG]);
    expect(activeSigningSecrets({ current: STRONG, previous: '' }, NOW)).toEqual([STRONG]);
    expect(activeSigningSecrets({ current: STRONG, previous: STRONG }, NOW)).toEqual([STRONG]);
  });

  it('adds the previous secret, current first, until the overlap ends', () => {
    const settings = { current: STRONG, previous: OLD, previousUntil: '2026-05-02T00:00:00.000Z' };

    expect(activeSigningSecrets(settings, NOW)).toEqual([STRONG, OLD]);
    expect(activeSigningSecrets(settings, new Date('2026-05-02T00:00:00.000Z'))).toEqual([STRONG, OLD]);
    expect(activeSigningSecrets(settings, new Date('2026-05-02T00:00:01.000Z'))).toEqual([STRONG]);
  });

  it('keeps the previous secret without a deadline or with an unreadable one', () => {
    expect(activeSigningSecrets({ current: STRONG, previous: OLD }, NOW)).toEqual([STRONG, OLD]);
    expect(
      activeSigningSecrets({ current: STRONG, previous: OLD, previousUntil: 'next week' }, NOW),
    ).toEqual([STRONG, OLD]);
  });
});

describe('signingSecretProblems', () => {
  it('accepts the development secret outside production', () => {
    expect(signingSecretProblems({ nodeEnv: 'development' })).toEqual([]);
    expect(signingSecretProblems({ nodeEnv: 'test', current: 'short' })).toEqual([]);
  });

  it('refuses a missing, default or short secret in production', () => {
    expect(signingSecretProblems({ nodeEnv: 'production' })).toEqual([
      'WEBHOOK_SIGNING_SECRET must be set to a real secret in production',
    ]);
    expect(signingSecretProblems({ nodeEnv: 'production', current: DEV_WEBHOOK_SECRET })).toHaveLength(1);
    expect(signingSecretProblems({ nodeEnv: 'production', current: 'x'.repeat(31) })).toEqual([
      'WEBHOOK_SIGNING_SECRET must be at least 32 characters in production',
    ]);
    expect(signingSecretProblems({ nodeEnv: 'production', current: STRONG })).toEqual([]);
  });

  it('refuses the development secret as the one being rotated out in production', () => {
    expect(
      signingSecretProblems({ nodeEnv: 'production', current: STRONG, previous: DEV_WEBHOOK_SECRET }),
    ).toEqual(['WEBHOOK_SIGNING_SECRET_PREVIOUS cannot be the development secret in production']);
  });

  it('reports an unreadable rotation deadline in every environment', () => {
    expect(signingSecretProblems({ nodeEnv: 'development', previousUntil: 'soon' })).toEqual([
      'WEBHOOK_SIGNING_SECRET_PREVIOUS_UNTIL is not a valid date',
    ]);
  });
});
