#!/usr/bin/env bash
# Verifies the deployed verification-network contracts on the PROM testnet
# explorer. Safe to re-run: an already-verified contract is reported and skipped.
#
#   cp ../.env.testnet.example ../.env.testnet && $EDITOR ../.env.testnet
#   ./script/verify-testnet.sh
#
# Run from the contracts/ directory.

set -euo pipefail

ENV_FILE="${ENV_FILE:-../.env.testnet}"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a && . "$ENV_FILE" && set +a
fi

require() {
  if [ -z "${!1:-}" ]; then
    echo "error: $1 is not set (checked environment and $ENV_FILE)" >&2
    exit 1
  fi
}

require PROM_TESTNET_RPC_URL
require PROM_TESTNET_CHAIN_ID
require PROM_TESTNET_EXPLORER_API_URL
require PROM_TESTNET_EXPLORER_API_KEY
require VALIDATOR_REGISTRY_ADDRESS
require POLICY_REGISTRY_ADDRESS
require VERDICT_REGISTRY_ADDRESS
require SLASHING_REWARDS_ADDRESS

# Guard against verifying against the wrong network: the addresses below only
# mean anything on the chain they were deployed to.
ACTUAL_CHAIN_ID=$(cast chain-id --rpc-url "$PROM_TESTNET_RPC_URL")
if [ "$ACTUAL_CHAIN_ID" != "$PROM_TESTNET_CHAIN_ID" ]; then
  echo "error: RPC reports chain $ACTUAL_CHAIN_ID, expected $PROM_TESTNET_CHAIN_ID" >&2
  exit 1
fi

verify() {
  local address="$1" contract="$2" ctor_args="${3:-}"

  if [ "$(cast code "$address" --rpc-url "$PROM_TESTNET_RPC_URL")" = "0x" ]; then
    echo "error: no code at $address for $contract" >&2
    return 1
  fi

  echo "--- $contract at $address"

  local args=(
    --chain-id "$PROM_TESTNET_CHAIN_ID"
    --verifier-url "$PROM_TESTNET_EXPLORER_API_URL"
    --etherscan-api-key "$PROM_TESTNET_EXPLORER_API_KEY"
    --watch
    --compiler-version "0.8.24"
  )
  if [ -n "$ctor_args" ]; then
    args+=(--constructor-args "$ctor_args")
  fi

  if forge verify-contract "$address" "$contract" "${args[@]}"; then
    echo "    verified"
  else
    # Re-verification of an already-verified contract exits non-zero; that is
    # not a failure worth aborting the whole run for.
    echo "    already verified or verification rejected, continuing" >&2
  fi
}

verify "$VALIDATOR_REGISTRY_ADDRESS" "src/ValidatorRegistry.sol:ValidatorRegistry"
verify "$POLICY_REGISTRY_ADDRESS"    "src/PolicyRegistry.sol:PolicyRegistry"
verify "$VERDICT_REGISTRY_ADDRESS"   "src/VerdictRegistry.sol:VerdictRegistry"

# SlashingRewards takes the validator registry address in its constructor.
verify "$SLASHING_REWARDS_ADDRESS" "src/SlashingRewards.sol:SlashingRewards" \
  "$(cast abi-encode 'constructor(address)' "$VALIDATOR_REGISTRY_ADDRESS")"

echo
echo "Done. Explorer: ${PROM_TESTNET_EXPLORER_URL:-<PROM_TESTNET_EXPLORER_URL unset>}"
