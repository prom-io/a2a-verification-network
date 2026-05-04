# a2a-verification-network — Onboarding

Read this **after** the top-level `HANDOFF.md` in `a2a-infra-compose`. This document is specific to the Verification Network service.

## 1. What this service does

A decentralised verification layer for the PROM A2A ecosystem:

- **Validators** stake tokens and register an HTTPS endpoint + capabilities.
- **Jobs** are submitted by clients (typically Agent Layer or Payment Rail) requesting verification of a specific request/result hash against a policy.
- **Coordinator** assigns jobs to validators based on stake and reputation.
- **Verdicts** are produced by validators, aggregated, and posted on-chain.
- **Disputes** can be opened against verdicts; if upheld, the offending validator is slashed.
- **Reputation** tracks validator behaviour over time.

Think of it as the "judge & jury" for agent interactions — a way to settle disputes between agents that don't trust each other.

## 2. How it fits in

```
payment-rail / agent-layer
        │
        │ POST /jobs (sessionId, requestHash, policyId)
        ▼
verification-network (3002)
   ├── coordinator selects validators
   ├── validators verify off-chain
   ├── verdicts aggregated
   ▼
on-chain VerdictRegistry  ──── consumed by ────▶ payment-rail (releases/refunds)
```

## 3. Tech stack (specifics)

- NestJS 10, TypeORM, PostgreSQL
- ethers.js v6, Solidity 0.8.24 (Foundry)
- `class-validator` + `class-transformer` for DTOs
- Jest + Supertest for tests
- Custom retry utility for transient blockchain errors
- TypeORM migrations (CLI configured)

## 4. Repository layout

```
a2a-verification-network/
├── src/
│   ├── main.ts                 # bootstrap: pipes, interceptors, filters
│   ├── app.module.ts
│   ├── config/
│   │   ├── database.config.ts  # tuned pool, statement timeout, slow query log
│   │   ├── blockchain.config.ts
│   │   └── data-source.ts      # TypeORM CLI data source
│   ├── migrations/
│   │   └── 1712000000000-InitSchema.ts
│   ├── common/
│   │   ├── base/
│   │   │   └── crud.service.ts # generic CRUD service base
│   │   ├── blockchain/
│   │   │   ├── blockchain.service.ts  # ethers wrapper, sendWithRetry
│   │   │   ├── retry.util.ts          # exponential backoff for transient tx errors
│   │   │   └── abis/
│   │   ├── filters/
│   │   │   ├── http-exception.filter.ts
│   │   │   └── database-error.filter.ts  # maps Postgres codes → HTTP
│   │   ├── interceptors/
│   │   ├── dto/
│   │   │   └── pagination.dto.ts
│   │   └── ...
│   └── modules/
│       ├── validators/         # POST /validators, register/stake/withdraw
│       ├── jobs/               # POST /jobs, GET /jobs/:id
│       ├── coordinator/        # validator selection logic
│       ├── verdicts/           # POST /verdicts, GET /verdicts/:jobId
│       ├── disputes/           # POST /disputes, POST /disputes/:id/resolve
│       ├── reputation/         # GET /reputation/:address
│       ├── policies/           # CRUD for verification policies
│       └── health/             # GET /health, GET /ready (DB probe)
├── contracts/
│   ├── src/
│   │   ├── ValidatorRegistry.sol
│   │   ├── PolicyRegistry.sol
│   │   ├── VerdictRegistry.sol
│   │   └── SlashingRewards.sol
│   ├── test/
│   └── script/Deploy.s.sol
├── docker/
│   ├── Dockerfile
│   └── Dockerfile.dev
├── docker-compose.dev.yml
├── test/
└── .env.example
```

## 5. Environment variables

Copy `.env.example` to `.env`. Key groups:

| Group | Variables | Notes |
|---|---|---|
| Node | `NODE_ENV` | `development` enables `synchronize`; `production` runs migrations |
| Database | `DATABASE_*` | host/port/user/password/name |
| DB pool | `DATABASE_POOL_MAX`, `DATABASE_POOL_MIN`, `DATABASE_IDLE_TIMEOUT_MS`, `DATABASE_CONNECT_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS`, `DATABASE_QUERY_TIMEOUT_MS`, `DATABASE_SLOW_QUERY_MS` | tune for prod load |
| Blockchain | `RPC_URL`, `PRIVATE_KEY`, `VERDICT_REGISTRY_ADDRESS`, `VALIDATOR_REGISTRY_ADDRESS` | |
| API | `PORT` (default 3002) | |

For local dev with `docker-compose.dev.yml`, the defaults work as-is.

## 6. Local development

### Full stack (preferred for E2E)

```bash
cd a2a-infra-compose
docker compose up --build -d
docker compose logs -f verification-network
```

### Service-only with hot-reload

```bash
cd a2a-verification-network
cp .env.example .env
docker compose -f docker-compose.dev.yml up
```

Postgres runs on host port `5433` (to avoid conflicts with payment-rail's `5432`). Anvil on `8546`.

### Bare metal

```bash
npm install
cp .env.example .env
npm run start:dev
```

Smoke check:

```bash
curl http://localhost:3002/health
curl http://localhost:3002/ready
```

## 7. Running tests

```bash
npm run test
npm run test:e2e
npm run test:cov
```

Notable specs:

- `src/common/blockchain/retry.util.spec.ts` — retry/backoff behaviour
- `src/common/filters/database-error.filter.spec.ts` — Postgres → HTTP code mapping

## 8. Database migrations

Configured with TypeORM CLI; data source: `src/config/data-source.ts`.

```bash
# Generate a migration from current entities vs DB
npm run migration:generate -- src/migrations/<Name>

# Run pending migrations
npm run migration:run

# Revert the last one
npm run migration:revert
```

In `production`, the app runs migrations automatically (`migrationsRun: true`). In `development`, `synchronize: true` keeps schema in sync from entity classes.

## 9. Smart contracts

```bash
cd contracts
forge install
forge build
forge test
```

`Deploy.s.sol` deploys all four contracts to anvil. The integrated `a2a-infra-compose/scripts/deploy-contracts.sh` captures addresses and writes them to `.env`.

## 10. Conventions specific to this repo

- **Validator addresses** — Ethereum addresses, validated via `@IsEthereumAddress()` and lowercased.
- **Stake amounts** — decimal-string wei (same as Payment Rail).
- **Hashes** — 0x-prefixed 32 bytes; validate with `Matches(/^0x[0-9a-fA-F]{64}$/)`.
- **UUIDs** — `@IsUUID('4')` for `policyId`, `jobId`, `disputeId`, `sessionId`.
- **Pagination** — accept `PaginationDto` (`page`, `limit`, defaults 1/20, max 100). Use the `CrudService` base where possible.
- **Blockchain calls** — wrap in `blockchainService.sendWithRetry(() => contract.method(...))` to survive transient RPC errors.
- **DB errors** — let them bubble. `DatabaseErrorFilter` maps Postgres codes (`23505`, `23503`, `40P01`, `57014`, ...) to the right HTTP status.
- **Logging** — `Logger` with class context. Avoid `console.log`.

## 11. Common tasks

### Add a new module

1. `nest g module modules/<name>`
2. `nest g controller modules/<name>` and `nest g service modules/<name>`
3. Add entity under `entities/`, register via `TypeOrmModule.forFeature([...])`.
4. Add DTOs under `dto/` with strict validation.
5. Add Swagger decorators on the controller.
6. Extend `CrudService<Entity>` if the operations are vanilla CRUD.

### Add a new policy type

1. Add a row in the `policies` table via the existing API or a seed.
2. Wire matcher logic in `coordinator.service` (`evaluatePolicy(...)`).
3. Cover with a unit test in `coordinator.spec.ts`.

### Add a new verdict source

1. Define the verdict's payload shape in a DTO.
2. Add an endpoint on `verdicts.controller` with `@Roles(Role.VALIDATOR)` (once RBAC is wired here too — see "next steps").
3. Persist + emit event for downstream consumers (Payment Rail listens).

## 12. What's done and what's next

Done:

- P0 Foundation — NestJS scaffold, modules, contracts (4), Docker, e2e basics.
- P1 Hardening — retry util, DB pool tuning, refined DTOs, DB error filter, base CRUD service, unit tests, health probe.

Likely next (confirm with owner):

- P2 Security — port the JWT/RBAC/CSRF stack from Payment Rail (we kept it pluggable for that reason).
- P2 Coordinator algorithm — reputation-weighted validator assignment with VRF-like seeding.
- P2 Slashing flow — wire `SlashingRewards` end-to-end with on-chain dispute resolution.
- P3 Observability — metrics, tracing, correlation IDs.

## 13. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `relation "validators" does not exist` | DB not migrated. In dev, just restart the app (synchronize will run). In prod, run `npm run migration:run`. |
| `invalid input syntax for type uuid` | A request sent a non-UUID where a UUID was expected. The `DatabaseErrorFilter` will return 400 — fix the client. |
| Tests hang on `await app.init()` | DB or anvil isn't reachable from the test runner. Make sure `docker-compose.dev.yml` is up before `npm run test:e2e`. |
| `nonce too low` after restart | anvil was reset. Restart this service so it refetches its nonce. |
| Slow queries warning | tune `DATABASE_SLOW_QUERY_MS` or add an index — see existing migrations for examples. |
