import { ethers } from 'ethers';
import { NonceManager } from './nonce-manager';

function signerStub(startingNonce = 5) {
  const getNonce = jest.fn().mockResolvedValue(startingNonce);
  return { signer: { getNonce } as unknown as ethers.Signer, getNonce };
}

const nonceError = (message: string) => Object.assign(new Error(message), {});

describe('NonceManager', () => {
  it('assigns the pending nonce to the first submission', async () => {
    const { signer, getNonce } = signerStub(5);
    const manager = new NonceManager(signer);

    await expect(manager.submit(async (nonce) => nonce)).resolves.toBe(5);
    expect(getNonce).toHaveBeenCalledWith('pending');
  });

  it('increments locally instead of re-reading for every send', async () => {
    const { signer, getNonce } = signerStub(5);
    const manager = new NonceManager(signer);

    const used = [
      await manager.submit(async (n) => n),
      await manager.submit(async (n) => n),
      await manager.submit(async (n) => n),
    ];

    expect(used).toEqual([5, 6, 7]);
    expect(getNonce).toHaveBeenCalledTimes(1);
  });

  it('gives concurrent submissions distinct nonces', async () => {
    // The actual bug: without serialisation both reads see the same pending
    // nonce and one transaction silently replaces the other.
    const { signer } = signerStub(10);
    const manager = new NonceManager(signer);

    const used = await Promise.all([
      manager.submit(async (n) => n),
      manager.submit(async (n) => n),
      manager.submit(async (n) => n),
      manager.submit(async (n) => n),
    ]);

    expect(new Set(used).size).toBe(4);
    expect([...used].sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
  });

  it('resyncs and retries when the node reports the nonce as too low', async () => {
    const { signer, getNonce } = signerStub(5);
    getNonce.mockResolvedValueOnce(5).mockResolvedValue(9);
    const manager = new NonceManager(signer);

    const send = jest
      .fn()
      .mockRejectedValueOnce(nonceError('nonce too low'))
      .mockImplementation(async (n: number) => n);

    await expect(manager.submit(send)).resolves.toBe(9);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    'nonce has already been used',
    'replacement transaction underpriced',
    'already known',
  ])('treats "%s" as a nonce collision', async (message) => {
    const { signer, getNonce } = signerStub(1);
    getNonce.mockResolvedValueOnce(1).mockResolvedValue(2);
    const manager = new NonceManager(signer);

    const send = jest
      .fn()
      .mockRejectedValueOnce(nonceError(message))
      .mockImplementation(async (n: number) => n);

    await expect(manager.submit(send)).resolves.toBe(2);
  });

  it('gives up after the retry budget', async () => {
    const { signer } = signerStub(1);
    const manager = new NonceManager(signer);
    const send = jest.fn().mockRejectedValue(nonceError('nonce too low'));

    await expect(manager.submit(send, 1)).rejects.toThrow('nonce too low');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('propagates a non-nonce failure without retrying', async () => {
    const { signer } = signerStub(1);
    const manager = new NonceManager(signer);
    const send = jest.fn().mockRejectedValue(new Error('insufficient funds'));

    await expect(manager.submit(send)).rejects.toThrow('insufficient funds');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps serving later submissions after one fails', async () => {
    const { signer, getNonce } = signerStub(3);
    const manager = new NonceManager(signer);

    await expect(
      manager.submit(async () => {
        throw new Error('insufficient funds');
      }),
    ).rejects.toThrow('insufficient funds');

    getNonce.mockResolvedValue(3);
    await expect(manager.submit(async (n) => n)).resolves.toBe(3);
  });
});
