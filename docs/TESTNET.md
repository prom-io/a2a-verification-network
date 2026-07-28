# PROM Testnet — Verification Network

Everything needed to deploy, verify, point the service at, and roll back the
verification-network contracts on the PROM testnet.

## Network

| | |
|---|---|
| Chain id | `71234` |
| RPC | `PROM_TESTNET_RPC_URL` |
| Explorer | `PROM_TESTNET_EXPLORER_URL` |
| Confirmations before a verdict is final | 6 (`BLOCKCHAIN_CONFIRMATIONS`) |

Six confirmations is not arbitrary. The payment rail settles against published
verdicts, and a settlement made against a verdict that a reorg later removes
cannot be undone. See `src/common/blockchain/confirmation-policy.ts`.

## Contracts

| Contract | Env var | Purpose |
|---|---|---|
| `ValidatorRegistry` | `VALIDATOR_REGISTRY_ADDRESS` | validator set, stakes |
| `PolicyRegistry` | `POLICY_REGISTRY_ADDRESS` | verification policies |
| `VerdictRegistry` | `VERDICT_REGISTRY_ADDRESS` | published verdicts |
| `SlashingRewards` | `SLASHING_REWARDS_ADDRESS` | slashing and rewards, constructed with the validator registry address |

Deployed addresses are pinned in `deployments/prom-testnet.json`. Never hand-edit
that file — it is written from the deploy output.

## Deploy

```bash
cp .env.testnet.example .env.testnet
$EDITOR .env.testnet          # RPC, chain id, explorer key, deployer PRIVATE_KEY

cd contracts
forge script script/DeployTestnet.s.sol \
  --profile testnet \
  --rpc-url "$PROM_TESTNET_RPC_URL" \
  --broadcast
```

Use a throwaway deployer key. The script refuses to run when the connected
chain id does not match `PROM_TESTNET_CHAIN_ID`, which is the guard against
putting testnet contracts on the wrong network.

It prints one `KEY=0x...` line per contract. Copy those into `.env.testnet` and
into `deployments/prom-testnet.json`.

## Verify on the explorer

```bash
cd contracts
./script/verify-testnet.sh
```

Idempotent; re-running skips anything already verified.

## Point the service at it

```bash
NODE_ENV=production \
CHAIN_ID=71234 \
RPC_URL=$PROM_TESTNET_RPC_URL \
VALIDATOR_REGISTRY_ADDRESS=0x... \
POLICY_REGISTRY_ADDRESS=0x... \
VERDICT_REGISTRY_ADDRESS=0x... \
SLASHING_REWARDS_ADDRESS=0x... \
npm run start:prod
```

`deployments.config.ts` throws at boot on any non-local chain if an address is
missing, rather than starting and failing on the first verdict.

## Smoke check

```bash
anvil --fork-url "$PROM_TESTNET_RPC_URL" &
FORK_RPC_URL=http://127.0.0.1:8545 \
VERDICT_REGISTRY_ADDRESS=0x... \
npm run test:e2e -- testnet-fork
```

Runs the verdict flow against a fork of real deployed state, which catches a
verdict that encodes cleanly locally and reverts against the on-chain ABI.

## Rollback

Contracts are not upgradeable, so rollback means repointing at the previous
deployment, not undeploying.

1. Stop the service. Verdicts in flight will be retried, so do not leave it
   half-pointed at two deployments.
2. Restore the previous block of addresses from git history of
   `deployments/prom-testnet.json`.
3. Restart with those addresses and confirm `/health` reports the expected
   chain id.
4. Verdicts published to the abandoned deployment stay on chain. If the payment
   rail already settled against any of them, reconcile before repointing — the
   rail reads verdicts by session id and will not find them under the old
   registry.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `refusing to deploy, chain id does not match` | RPC points at a different network than `PROM_TESTNET_CHAIN_ID` |
| Boot fails with `missing contract addresses` | a `*_ADDRESS` var is unset on a non-local chain — intentional, see `deployments.config.ts` |
| `TransactionDroppedError` | submission was evicted from the mempool, usually gas priced too low |
| `ReorgError` | verdict was confirmed and then orphaned; it must be republished |
| Verification reports a compiler mismatch | the testnet profile has the optimizer on; verify with `--compiler-version 0.8.24` and the same profile used to build |
