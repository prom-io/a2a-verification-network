import { Logger } from '@nestjs/common';
import { registerAs } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ContractDeployment {
  validatorRegistry: string;
  policyRegistry: string;
  verdictRegistry: string;
  slashingRewards: string;
}

export interface DeploymentRegistry {
  chainId: number;
  confirmations: number;
  explorerUrl: string;
  contracts: ContractDeployment;
}

const ZERO = '0x0000000000000000000000000000000000000000';
const LOCAL_CHAIN_IDS = [31337, 1337];

const logger = new Logger('DeploymentRegistry');

interface PinnedDeployment {
  chainId: number;
  contracts: Record<string, { address: string | null }>;
}

/**
 * Addresses pinned at release time, checked into deployments/.
 *
 * The environment still wins — an operator repointing at a previous deployment
 * during a rollback must not be overridden by a file. The pin is the default,
 * so a fresh checkout talks to the right contracts without anyone copying
 * addresses around by hand.
 */
function pinnedFor(chainId: number): Record<string, string> {
  const candidates = [
    join(process.cwd(), 'deployments'),
    join(__dirname, '..', '..', 'deployments'),
  ];

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    for (const name of ['prom-testnet.json']) {
      const file = join(dir, name);
      if (!existsSync(file)) continue;
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as PinnedDeployment;
        if (parsed.chainId !== chainId) continue;
        const out: Record<string, string> = {};
        for (const [contract, entry] of Object.entries(parsed.contracts)) {
          if (entry.address) out[contract] = entry.address;
        }
        return out;
      } catch (error) {
        logger.warn(`Ignoring unreadable deployment pin ${file}: ${(error as Error).message}`);
      }
    }
  }
  return {};
}

/**
 * Contract addresses are resolved per network from the environment rather than
 * hardcoded, so the same image runs against anvil, testnet and later mainnet.
 * Missing addresses are fatal on real networks and tolerated locally, where the
 * infra deploy script fills them in after anvil starts.
 */
export default registerAs('deployments', (): DeploymentRegistry => {
  const chainId = Number(process.env.CHAIN_ID ?? 31337);
  const isLocal = LOCAL_CHAIN_IDS.includes(chainId);

  const pinned = pinnedFor(chainId);

  const contracts: ContractDeployment = {
    validatorRegistry:
      process.env.VALIDATOR_REGISTRY_ADDRESS ?? pinned.ValidatorRegistry ?? '',
    policyRegistry: process.env.POLICY_REGISTRY_ADDRESS ?? pinned.PolicyRegistry ?? '',
    verdictRegistry: process.env.VERDICT_REGISTRY_ADDRESS ?? pinned.VerdictRegistry ?? '',
    slashingRewards: process.env.SLASHING_REWARDS_ADDRESS ?? pinned.SlashingRewards ?? '',
  };

  const unset = Object.entries(contracts)
    .filter(([, address]) => !address || address === ZERO)
    .map(([name]) => name);

  if (unset.length > 0) {
    if (isLocal) {
      logger.warn(
        `Chain ${chainId}: ${unset.join(', ')} not deployed yet — run the infra deploy script`,
      );
    } else {
      throw new Error(
        `Chain ${chainId}: missing contract addresses for ${unset.join(', ')}. ` +
          'Deploy with script/DeployTestnet.s.sol and fill them into the env.',
      );
    }
  }

  return {
    chainId,
    confirmations: Number(process.env.BLOCKCHAIN_CONFIRMATIONS ?? (isLocal ? 1 : 6)),
    explorerUrl: process.env.PROM_TESTNET_EXPLORER_URL ?? '',
    contracts,
  };
});
