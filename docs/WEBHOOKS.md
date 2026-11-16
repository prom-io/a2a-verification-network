# Verdict webhooks

A job submitted with a `callbackUrl` gets a `POST` to that URL when it has a
verdict (`verdict.published`) or ends without one (`job.failed`).

## Request

| Header | Meaning |
| --- | --- |
| `x-prom-event` | `verdict.published` or `job.failed` |
| `x-prom-delivery` | Delivery id; the same on every retry of one notification |
| `x-prom-attempt` | 1 for the first try, 2 for the first retry, ... |
| `x-prom-timestamp` | Unix seconds when this attempt was signed |
| `x-prom-signature` | `t=<timestamp>,v1=<hex hmac>[,v1=<hex hmac>]` |

The body is JSON and always contains `event`, `jobId`, `sessionId`,
`occurredAt` and `deliveryId`. Use `deliveryId` to ignore a notification you
have already processed: a retry after a lost `2xx` sends it again.

## Verifying the signature

`v1` is HMAC-SHA256 over `<timestamp>.<raw body>` with the shared signing
secret, hex encoded. Verify against the raw bytes, before parsing the JSON.

```ts
import { createHmac, timingSafeEqual } from 'crypto';

function verify(secret: string, header: string, rawBody: string, toleranceSeconds = 300): boolean {
  const fields = header.split(',').map((part) => part.trim().split('='));
  const t = Number(fields.find(([key]) => key === 't')?.[1]);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const wanted = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return fields
    .filter(([key]) => key === 'v1')
    .some(([, hex]) => {
      const given = Buffer.from(hex, 'hex');
      return given.length === wanted.length && timingSafeEqual(given, wanted);
    });
}
```

`verifyWebhookRequest` in `src/modules/webhooks/webhook-signature.ts` does the
same and also says why a request was rejected.

Reject requests whose timestamp is more than five minutes away from your
clock: that is what makes a captured request useless later. Every retry is
signed again with its own time, so a retry is never stale on arrival.

## Rotating the secret

1. Set `WEBHOOK_SIGNING_SECRET_PREVIOUS` to the current secret and
   `WEBHOOK_SIGNING_SECRET` to the new one. Optionally set
   `WEBHOOK_SIGNING_SECRET_PREVIOUS_UNTIL` to an ISO time that ends the overlap.
2. Deliveries now carry two `v1` values, one per secret. Receivers can switch
   to the new secret at any time during the overlap.
3. After the deadline (or once `WEBHOOK_SIGNING_SECRET_PREVIOUS` is removed)
   only the new secret signs.

In production the service refuses to start with the development secret or a
secret shorter than 32 characters.
