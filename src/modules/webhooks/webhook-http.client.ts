import { Injectable } from '@nestjs/common';

export interface WebhookResponse {
  status: number;
}

/**
 * The outbound HTTP call, kept behind a class so delivery logic can be tested
 * without a network.
 */
@Injectable()
export class WebhookHttpClient {
  async post(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<WebhookResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        // A redirect could point the request at an internal address after the
        // URL itself passed the target check, so it is treated as a failure.
        redirect: 'manual',
      });
      // The body is of no interest; release the connection.
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status };
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`timed out after ${timeoutMs}ms`);
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      throw new Error(cause?.code ?? cause?.message ?? (error as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}
