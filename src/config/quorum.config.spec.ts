import { QuorumWeighting } from '../modules/commit-reveal/weighted-quorum';
import { parseQuorumConfig } from './quorum.config';

describe('parseQuorumConfig', () => {
  it('weighs by stake with a strict majority by default', () => {
    expect(parseQuorumConfig({})).toEqual({ weighting: QuorumWeighting.STAKE, thresholdBps: 5001 });
    expect(parseQuorumConfig({ QUORUM_THRESHOLD_BPS: '', QUORUM_WEIGHTING: '' })).toEqual({
      weighting: QuorumWeighting.STAKE,
      thresholdBps: 5001,
    });
  });

  it('reads the weighting and threshold from the environment', () => {
    expect(parseQuorumConfig({ QUORUM_WEIGHTING: 'equal', QUORUM_THRESHOLD_BPS: '6667' })).toEqual({
      weighting: QuorumWeighting.EQUAL,
      thresholdBps: 6667,
    });
  });

  it.each(['5000', '0', '10001', '66.67', 'two-thirds'])(
    'refuses the threshold %s instead of guessing',
    (value) => {
      expect(() => parseQuorumConfig({ QUORUM_THRESHOLD_BPS: value })).toThrow('QUORUM_THRESHOLD_BPS');
    },
  );

  it('refuses an unknown weighting', () => {
    expect(() => parseQuorumConfig({ QUORUM_WEIGHTING: 'reputation' })).toThrow(
      'QUORUM_WEIGHTING must be one of equal, stake',
    );
  });
});
