import { QuorumWeighting } from '../modules/commit-reveal/weighted-quorum';
import { parseQuorumConfig } from './quorum.config';

describe('parseQuorumConfig', () => {
  it('weighs by stake with a strict majority by default', () => {
    const defaults = {
      weighting: QuorumWeighting.STAKE,
      thresholdBps: 5001,
      maxExpansions: 1,
      expansionSize: 0,
      timeoutSweepMs: 0,
    };
    expect(parseQuorumConfig({})).toEqual(defaults);
    expect(parseQuorumConfig({ QUORUM_THRESHOLD_BPS: '', QUORUM_WEIGHTING: '' })).toEqual(defaults);
  });

  it('reads the weighting and threshold from the environment', () => {
    expect(
      parseQuorumConfig({
        QUORUM_WEIGHTING: 'equal',
        QUORUM_THRESHOLD_BPS: '6667',
        QUORUM_MAX_EXPANSIONS: '2',
        QUORUM_EXPANSION_SIZE: '4',
        QUORUM_TIMEOUT_SWEEP_MS: '15000',
      }),
    ).toEqual({
      weighting: QuorumWeighting.EQUAL,
      thresholdBps: 6667,
      maxExpansions: 2,
      expansionSize: 4,
      timeoutSweepMs: 15000,
    });
  });

  it.each(['5000', '0', '10001', '66.67', 'two-thirds'])(
    'refuses the threshold %s instead of guessing',
    (value) => {
      expect(() => parseQuorumConfig({ QUORUM_THRESHOLD_BPS: value })).toThrow('QUORUM_THRESHOLD_BPS');
    },
  );

  it.each([
    ['QUORUM_MAX_EXPANSIONS', '-1'],
    ['QUORUM_EXPANSION_SIZE', '1.5'],
    ['QUORUM_TIMEOUT_SWEEP_MS', 'often'],
  ])('refuses %s=%s', (key, value) => {
    expect(() => parseQuorumConfig({ [key]: value })).toThrow(`${key} must be a non-negative integer`);
  });

  it('refuses an unknown weighting', () => {
    expect(() => parseQuorumConfig({ QUORUM_WEIGHTING: 'reputation' })).toThrow(
      'QUORUM_WEIGHTING must be one of equal, stake',
    );
  });
});
