import { ethers } from 'ethers';
import {
  AppealDecision,
  AppealVoteChoice,
  appealPanelSize,
  appealVoteMessage,
  decisionAtDeadline,
  recoverAppealVoter,
  reversalQuorum,
  tallyAppeal,
} from './appeal-quorum';

const votes = (overturn: number, uphold: number) => [
  ...Array<AppealVoteChoice>(overturn).fill(AppealVoteChoice.OVERTURN),
  ...Array<AppealVoteChoice>(uphold).fill(AppealVoteChoice.UPHOLD),
];

describe('appeal panel sizing', () => {
  it('more than doubles the original committee and stays odd', () => {
    expect(appealPanelSize(3, 2)).toBe(7);
    expect(appealPanelSize(5, 2)).toBe(11);
    expect(appealPanelSize(3, 3)).toBe(10);
    expect(appealPanelSize(1, 2)).toBe(3);
  });

  it('never shrinks the panel below an expansion of two', () => {
    expect(appealPanelSize(3, 1)).toBe(7);
    expect(appealPanelSize(3, 0)).toBe(7);
    expect(appealPanelSize(3, Number.NaN)).toBe(7);
    expect(appealPanelSize(0, 2)).toBe(3);
  });

  it('requires two thirds of the panel to reverse', () => {
    expect(reversalQuorum(7)).toBe(5);
    expect(reversalQuorum(9)).toBe(6);
    expect(reversalQuorum(11)).toBe(8);
    expect(reversalQuorum(4)).toBe(3);
  });
});

describe('tallyAppeal', () => {
  it('stays open while either result is still possible', () => {
    expect(tallyAppeal(votes(4, 2), 7)).toEqual({
      uphold: 2,
      overturn: 4,
      panelSize: 7,
      quorum: 5,
      decision: null,
    });
  });

  it('reverses as soon as the quorum is reached', () => {
    expect(tallyAppeal(votes(5, 0), 7).decision).toBe(AppealDecision.REVERSED);
    expect(tallyAppeal(votes(5, 2), 7).decision).toBe(AppealDecision.REVERSED);
  });

  it('upholds as soon as the quorum is out of reach', () => {
    // Three uphold votes leave at most four overturn votes on a panel of seven.
    expect(tallyAppeal(votes(0, 3), 7).decision).toBe(AppealDecision.UPHELD);
    expect(tallyAppeal(votes(0, 2), 7).decision).toBeNull();
  });

  it('does not reverse on a simple majority', () => {
    const tally = tallyAppeal(votes(4, 3), 7);

    expect(tally.decision).toBe(AppealDecision.UPHELD);
    expect(tally.overturn).toBeGreaterThan(tally.uphold);
  });

  it('counts silent panel members for the existing resolution at the deadline', () => {
    expect(decisionAtDeadline(tallyAppeal(votes(4, 0), 7))).toBe(AppealDecision.UPHELD);
    expect(decisionAtDeadline(tallyAppeal(votes(0, 0), 7))).toBe(AppealDecision.UPHELD);
    expect(decisionAtDeadline(tallyAppeal(votes(5, 0), 7))).toBe(AppealDecision.REVERSED);
  });
});

describe('appeal vote signatures', () => {
  it('binds the signature to the appeal and to the vote', async () => {
    const wallet = ethers.Wallet.createRandom();
    const signature = await wallet.signMessage(appealVoteMessage('appeal-1', AppealVoteChoice.OVERTURN));

    expect(recoverAppealVoter('appeal-1', AppealVoteChoice.OVERTURN, signature)).toBe(wallet.address);
    expect(recoverAppealVoter('appeal-1', AppealVoteChoice.UPHOLD, signature)).not.toBe(wallet.address);
    expect(recoverAppealVoter('appeal-2', AppealVoteChoice.OVERTURN, signature)).not.toBe(wallet.address);
  });
});
