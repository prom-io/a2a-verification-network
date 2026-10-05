/* eslint-disable @typescript-eslint/no-var-requires -- the OpenTelemetry SDK is
   loaded lazily: it is only needed when an OTLP endpoint is configured, and the
   service must still start when the SDK packages are not installed. */
import { Logger } from '@nestjs/common';

const logger = new Logger('Tracing');

let sdk: { start: () => void; shutdown: () => Promise<void> } | undefined;

export function startTracing(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const { Resource } = require('@opentelemetry/resources');
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]:
          process.env.OTEL_SERVICE_NAME ?? 'verification-network',
      }),
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk?.start();
    process.once('SIGTERM', () => sdk?.shutdown());
  } catch (error) {
    // A missing optional package must not take the service down with it.
    logger.warn(`Tracing bootstrap skipped: ${(error as Error).message}`);
  }
}
