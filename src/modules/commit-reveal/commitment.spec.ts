import { ethers } from 'ethers';
import { VerdictOutcome } from '../verdicts/entities/verdict.entity';
import { computeCommitHash, recoverCommitSigner, tallyReveals } from './commitment';

const SALT = ethers.id('salt');

describe('computeCommitHash', () => {
  it('matches the packed keccak a validator node computes', () => {
    const expected = ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes('job-1'),
        ethers.toUtf8Bytes('validator-1'),
        ethers.toUtf8Bytes('accept'),
        SALT,
      ]),
    );

    expect(computeCommitHash('job-1', 'validator-1', VerdictOutcome.ACCEPT, SALT)).toBe(expected);
  });

  it('changes with every part of the preimage', () => {
    const base = computeCommitHash('job-1', 'validator-1', VerdictOutcome.ACCEPT, SALT);

    expect(computeCommitHash('job-2', 'validator-1', VerdictOutcome.ACCEPT, SALT)).not.toBe(base);
    expect(computeCommitHash('job-1', 'validator-2', VerdictOutcome.ACCEPT, SALT)).not.toBe(base);
    expect(computeCommitHash('job-1', 'validator-1', VerdictOutcome.REJECT, SALT)).not.toBe(base);
    expect(
      computeCommitHash('job-1', 'validator-1', VerdictOutcome.ACCEPT, ethers.id('other')),
    ).not.toBe(base);
  });

  it('refuses a salt that is not 32 bytes', () => {
    expect(() => computeCommitHash('job-1', 'validator-1', VerdictOutcome.ACCEPT, '0x1234')).toThrow();
  });
});

describe('recoverCommitSigner', () => {
  it('recovers the address that signed the commit hash', async () => {
    const wallet = ethers.Wallet.createRandom();
    const hash = computeCommitHash('job-1', 'validator-1', VerdictOutcome.PARTIAL, SALT);
    const signature = await wallet.signMessage(ethers.getBytes(hash));

    expect(recoverCommitSigner(hash, signature)).toBe(wallet.address);
  });

  it('recovers a different address for a different hash', async () => {
    const wallet = ethers.Wallet.createRandom();
    const hash = computeCommitHash('job-1', 'validator-1', VerdictOutcome.PARTIAL, SALT);
    const other = computeCommitHash('job-2', 'validator-1', VerdictOutcome.PARTIAL, SALT);
    const signature = await wallet.signMessage(ethers.getBytes(hash));

    expect(recoverCommitSigner(other, signature)).not.toBe(wallet.address);
  });
});

describe('tallyReveals', () => {
  const vote = (validatorId: string, outcome: VerdictOutcome) => ({ validatorId, outcome });

  it('needs more than half of the committee for an outcome', () => {
    expect(tallyReveals([], 3).quorum).toBe(2);
    expect(tallyReveals([], 4).quorum).toBe(3);
    expect(tallyReveals([], 5).quorum).toBe(3);
    expect(tallyReveals([], 1).quorum).toBe(1);
  });

  it('names the majority outcome and the validators behind it', () => {
    const tally = tallyReveals(
      [
        vote('a', VerdictOutcome.ACCEPT),
        vote('b', VerdictOutcome.REJECT),
        vote('c', VerdictOutcome.ACCEPT),
      ],
      3,
    );

    expect(tally.outcome).toBe(VerdictOutcome.ACCEPT);
    expect(tally.supporters).toEqual(['a', 'c']);
    expect(tally.counts).toEqual({ accept: 2, partial: 0, reject: 1 });
  });

  it('has no outcome on a split vote', () => {
    const tally = tallyReveals(
      [
        vote('a', VerdictOutcome.ACCEPT),
        vote('b', VerdictOutcome.REJECT),
        vote('c', VerdictOutcome.PARTIAL),
      ],
      3,
    );

    expect(tally.outcome).toBeNull();
    expect(tally.supporters).toEqual([]);
  });

  it('counts silent validators against the quorum', () => {
    // Two of five revealed and agree, but two is not a majority of five.
    const tally = tallyReveals(
      [vote('a', VerdictOutcome.ACCEPT), vote('b', VerdictOutcome.ACCEPT)],
      5,
    );

    expect(tally.outcome).toBeNull();
    expect(tally.quorum).toBe(3);
  });
});
