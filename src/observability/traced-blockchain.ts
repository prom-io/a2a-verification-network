import { trace, context, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('blockchain');

// Wraps a blockchain call in a span so on-chain latency shows up in the trace waterfall.
export async function tracedCall<T>(name: string, attrs: Record<string, string | number>, fn: () => Promise<T>): Promise<T> {
  const span = tracer.startSpan(name, { attributes: attrs });
  try {
    return await context.with(trace.setSpan(context.active(), span), fn);
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
    throw err;
  } finally {
    span.end();
  }
}
