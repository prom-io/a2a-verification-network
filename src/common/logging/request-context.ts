import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Carries the request id through the call stack without threading it through
 * every signature.
 *
 * Async local storage rather than a field on the request object: verdict
 * publication continues after the response is sent, and those log lines still
 * have to join back to the request that triggered them.
 */
export const requestContext = {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
