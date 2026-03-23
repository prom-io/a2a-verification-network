# PROM AI Trust & Verification Network

Decentralised verification layer for the PROM A2A ecosystem. Validators stake tokens, verify agent interactions against configurable policies, and publish on-chain verdicts.

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
| `npm run test:e2e` | Run end-to-end tests |

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
