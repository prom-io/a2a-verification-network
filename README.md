# PROM AI Trust & Verification Network

Decentralised verification layer for the PROM A2A ecosystem. Validators stake tokens, verify agent interactions against configurable policies, and publish on-chain verdicts.

> **Status:** Phase 1 complete

## Tech Stack

- **Backend**: NestJS (TypeScript), TypeORM, PostgreSQL
- **Smart Contracts**: Solidity 0.8.24, Foundry
- **Blockchain**: Ethers.js v6

## Setup

```bash
# Install dependencies
npm install

# Copy env
cp .env.example .env

# Start in dev mode (requires running PostgreSQL)
npm run start:dev
```

Swagger docs available at `http://localhost:3002/api/docs`.

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript |
| `npm run start:dev` | Start with hot-reload |
| `npm run start:prod` | Start production build |
| `npm run lint` | Lint source files |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run integration tests (supertest) |

## Smart Contracts

Contracts live in `contracts/` and use Foundry.

```bash
cd contracts
forge build
forge test
```

### Contracts

- **ValidatorRegistry** — stake-based validator registration and slashing
- **PolicyRegistry** — publish and version verification policies
- **VerdictRegistry** — immutable on-chain verdict records
- **SlashingRewards** — slash misbehaving validators and distribute rewards

## Docker

```bash
docker build -f docker/Dockerfile -t a2a-verification-network .
docker run -p 3002:3002 --env-file .env a2a-verification-network
```

Or via the infra-compose stack (recommended):

```bash
# In a2a-infra-compose/
docker compose up --build -d
```

## Cross-Cutting Features

| Feature | File | Description |
|---|---|---|
| Graceful shutdown | `src/main.ts` | `enableShutdownHooks()` for clean SIGTERM handling |
| HTTP logging | `src/common/interceptors/logging.interceptor.ts` | Logs method, URL, status, duration, IP, user-agent |
| Unified errors | `src/common/filters/http-exception.filter.ts` | Consistent `{ statusCode, error, message, path, timestamp }` |
| Validation | `src/main.ts` | Global `ValidationPipe` with whitelist and transform |
| Blockchain | `src/common/blockchain/blockchain.service.ts` | ethers.js v6 provider + signer + contract ABI |

## Project Structure

```
src/
├── main.ts
├── app.module.ts
├── config/
│   ├── database.config.ts
│   └── blockchain.config.ts
├── common/
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── interceptors/
│   │   └── logging.interceptor.ts
│   └── blockchain/
│       ├── blockchain.module.ts
│       ├── blockchain.service.ts
│       └── abis/
│           └── verdict-registry.abi.ts
└── modules/
    ├── validators/     # Validator registration & staking
    ├── jobs/           # Verification job management
    ├── coordinator/    # Validator assignment
    ├── verdicts/       # Verdict posting & querying
    ├── disputes/       # Dispute resolution
    ├── reputation/     # Reputation scoring
    ├── policies/       # Verification policies
    └── health/         # Health check endpoint
contracts/
├── src/
│   ├── ValidatorRegistry.sol
│   ├── PolicyRegistry.sol
│   ├── VerdictRegistry.sol
│   └── SlashingRewards.sol
├── test/
└── script/
test/
├── jest-e2e.json
└── app.e2e-spec.ts
```
