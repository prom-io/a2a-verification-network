import { requestContext } from './request-context';

describe('requestContext', () => {
  it('is empty outside a request', () => {
    expect(requestContext.requestId()).toBeUndefined();
  });

  it('exposes the id inside the run callback', () => {
    requestContext.run({ requestId: 'req-1' }, () => {
      expect(requestContext.requestId()).toBe('req-1');
    });
  });

  it('survives an await boundary', async () => {
    // The reason for async local storage: verdict publication continues after
    // the response is sent, and those lines still need the correlation id.
    await requestContext.run({ requestId: 'req-2' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(requestContext.requestId()).toBe('req-2');
    });
  });

  it('keeps concurrent requests separate', async () => {
    const seen: string[] = [];

    const one = requestContext.run({ requestId: 'a' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      seen.push(requestContext.requestId() as string);
    });
    const two = requestContext.run({ requestId: 'b' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(requestContext.requestId() as string);
    });

    await Promise.all([one, two]);
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('does not leak the id after the callback returns', () => {
    requestContext.run({ requestId: 'req-3' }, () => undefined);
    expect(requestContext.requestId()).toBeUndefined();
  });
});
