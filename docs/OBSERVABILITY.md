# Observability — Verification Network

What the service emits (logs, metrics, traces), where the dashboards and alert
rules live, and what to do when an alert fires.

| Asset | Path |
|---|---|
| Metrics registry and HTTP series | `src/observability/metrics.service.ts` |
| Scrape endpoint | `src/observability/metrics.controller.ts` (`GET /metrics`) |
| HTTP instrumentation | `src/observability/http-metrics.interceptor.ts` |
| Domain gauges | `src/observability/domain-gauges.service.ts` |
| Tracing bootstrap | `src/observability/tracing.ts` |
| Blockchain spans | `src/observability/traced-blockchain.ts` |
| Structured logger | `src/common/logging/pino-logger.service.ts` |
| Request correlation | `src/common/logging/request-id.middleware.ts`, `request-context.ts` |
| Grafana dashboard | `grafana/verification-throughput.json` |
| Alert rules | `monitoring/alerts.yml` |
| Prometheus scrape example | `monitoring/prometheus.example.yml` |
| Load profile | `k6/verdict-load.js` |

## Logs

`PinoLoggerService` replaces the Nest logger in `main.ts` and writes one JSON
object per line (pretty-printed through `pino-pretty` outside production).

- Base fields on every line: `service=verification-network`, `env`, `context`
  (the Nest logger name) and `requestId`.
- `requestId` comes from `RequestIdMiddleware`: an incoming `x-request-id`
  header is reused, otherwise a UUID is generated. The id is echoed back in the
  response header and stored in async local storage, so lines written after the
  response is sent (verdict publication) still join back to the request.
- `LOG_LEVEL` sets the level (`info` by default in production, `debug`
  elsewhere).
- Redacted paths: `authorization` and `cookie` request headers, `x-api-key`,
  `privateKey` / `PRIVATE_KEY`, `password`.
- `LoggingInterceptor` (context `HTTP`) logs `METHOD url status duration - ip agent`
  per request; `AuditInterceptor` logs mutations.

To follow one request across services, search the log pipeline for its
`requestId`; the payment rail and the agent layer forward the same header.

## Metrics

`MetricsService` owns a dedicated `prom-client` registry; `GET /metrics` returns
it in the Prometheus text format (`text/plain; version=0.0.4`).

| Series | Type | Labels | Source |
|---|---|---|---|
| `http_requests_total` | counter | `method`, `route`, `status` | `HttpMetricsInterceptor` |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` | `HttpMetricsInterceptor` |
| `validators` | gauge | `status` | `DomainGaugesService.setValidators` |
| `jobs` | gauge | `status` | `DomainGaugesService.setJobs` |
| `disputes` | gauge | `status` | `DomainGaugesService.setDisputes` |
| `verification_*` | default process metrics (CPU, memory, event loop lag, GC) | — | `collectDefaultMetrics` with the `verification_` prefix |

Histogram buckets (seconds): `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5`.
The `route` label is the Express route pattern (`/jobs/:id`), not the raw URL, so
cardinality stays bounded by the number of handlers.

`src/observability/metrics.smoke.spec.ts` asserts that the HTTP series and the
prefixed process metrics are present in a scrape.

### Scraping

`monitoring/prometheus.example.yml` scrapes `verification-network:3002/metrics`
every 15 s with the labels `service=verification-network` and `env=testnet`.
Copy the job into the Prometheus config of the target environment and adjust the
target and the `env` label.

## Health endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | liveness plus a database round trip; `status` is `ok` or `degraded`, with `checks.database.latencyMs` |
| `GET /health/ready` | readiness probe, `{ ready: boolean }` |
| `GET /health/detail` | per-dependency `{ name, ok, latencyMs }` list (`src/observability/health.controller.ts`) |

Health routes are excluded from rate limiting so probes cannot be throttled.

## Tracing

`startTracing()` in `src/observability/tracing.ts` boots the OpenTelemetry Node
SDK with the OTLP/HTTP trace exporter and the Node auto-instrumentations.

| Variable | Effect |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | collector base URL; spans go to `<endpoint>/v1/traces`. Tracing stays off when unset. |
| `OTEL_SERVICE_NAME` | `service.name` resource attribute, default `verification-network` |

`tracedCall(name, attributes, fn)` in `traced-blockchain.ts` wraps an on-chain
call in a span of the `blockchain` tracer, marks it as an error when the call
throws, and keeps the span active for nested work. Use it around RPC calls so
chain latency is visible in the trace waterfall next to the HTTP span.

## Dashboard

`grafana/verification-throughput.json` (title *Verification Throughput*, uid
`verif-throughput`, 30 s refresh). Import it through *Dashboards → Import* and
select the Prometheus data source.

| Panel | Type | Query |
|---|---|---|
| HTTP req/s | time series | `sum(rate(http_requests_total[1m])) by (route)` |
| p95 latency | time series | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))` |
| Open disputes | stat | `sum(disputes{status="open"})` |
| Active validators | stat | `sum(validators{status="active"})` |

## Alerts

Rules are in `monitoring/alerts.yml` (group `verification-network`). Load the
file through `rule_files` in the Prometheus config.

| Alert | Expression | For | Severity |
|---|---|---|---|
| `VerdictBacklogHigh` | `sum(jobs{status="pending"}) > 100` | 10m | warning |
| `DisputeRateHigh` | `rate(disputes[15m]) > 0.2` | 15m | critical |

## Runbook

### VerdictBacklogHigh

Jobs are submitted faster than verdicts are produced.

1. Open the dashboard: is `HTTP req/s` on `/jobs` above the usual level (a
   submitter burst), or is `p95 latency` on `/jobs` up (the service is slow)?
2. Check `GET /health`: a `degraded` status or a high `checks.database.latencyMs`
   points at Postgres (pool exhaustion, slow queries — see `DATABASE_SLOW_QUERY_MS`
   in the logs).
3. Check `Active validators`. With no active validator the coordinator falls
   back to the service itself; a drop here means validators exited.
4. Search the logs for `On-chain verdict publish failed` and `Nonce ... rejected`.
   A stuck RPC endpoint or a nonce gap stalls publication; the verdict is stored
   but the job waits on finality (`BLOCKCHAIN_CONFIRMATIONS`).
5. If the chain is the bottleneck, switch `RPC_URL` to the standby endpoint and
   restart; the nonce manager re-reads the nonce from the node on start.

### DisputeRateHigh

Disputes are being opened unusually often, which holds escrows open on the
payment rail.

1. Compare `Open disputes` with the last deploy time. A jump right after a
   release suggests a verdict regression — roll the service back first, then
   investigate.
2. Group recent disputes by `sessionId` and `initiator` (table `disputes`). One
   initiator opening many disputes is abuse; many initiators against verdicts of
   the same policy is a policy or validator problem.
3. Check the policy the disputed jobs ran under (`verification_policies`) and
   the validators assigned to them (`verification_jobs.assignedValidators`).
4. Page the on-call for the payment rail when escrows stay locked for more than
   an hour; disputes resolve through `PATCH /disputes/:id/resolve`.

### Service down or `/metrics` not scraped

1. `GET /health/ready` from inside the network. `ready: false` means the
   database is unreachable.
2. Check the container logs for the bootstrap error; a missing contract address
   on a non-local chain is fatal by design (`src/config/deployments.config.ts`).
3. Confirm the Prometheus target matches the service port (`3002`).

## Load testing

`k6/verdict-load.js` ramps to 50 virtual users over three minutes against
`BASE_URL` (default `http://localhost:3002`), listing jobs and posting a verdict
each iteration, with the threshold `p(95) < 500 ms` on `http_req_duration`.

```bash
BASE_URL=http://localhost:3002 k6 run k6/verdict-load.js
```

Watch the dashboard during the run; the p95 panel and the k6 threshold should
agree.

## Known gaps

Tracked here so nobody relies on a signal that is not there yet.

- `MetricsModule`, `HttpMetricsInterceptor`, `DomainGaugesService` and
  `HealthDetailController` are not registered in `AppModule`, and `main.ts` does
  not call `startTracing()`. Until they are wired, `/metrics` and
  `/health/detail` return 404 and no spans are exported.
- Nothing calls the `DomainGaugesService` setters, so `validators`, `jobs` and
  `disputes` stay empty and both alerts are silent.
- `DisputeRateHigh` applies `rate()` to a gauge. Once the gauge is populated the
  rule should use `delta(disputes{status="open"}[15m])` or a dedicated counter.
- The `database` and `blockchain` checks behind `/health/detail` are
  placeholders that always report `ok`.
- `k6/verdict-load.js` posts to `POST /verdicts`, which the API does not expose
  (verdicts are produced by `POST /jobs`), so the `verdict accepted` check fails;
  the script also does not send the CSRF token that mutating routes require.
