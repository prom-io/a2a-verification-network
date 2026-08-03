import { Logger } from '@nestjs/common';
import { registerAs } from '@nestjs/config';

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

/**
 * Contract addresses are resolved per network from the environment rather than
 * hardcoded, so the same image runs against anvil, testnet and later mainnet.
 * Missing addresses are fatal on real networks and tolerated locally, where the
 * infra deploy script fills them in after anvil starts.
 */
export default registerAs('deployments', (): DeploymentRegistry => {
  const chainId = Number(process.env.CHAIN_ID ?? 31337);
  const isLocal = LOCAL_CHAIN_IDS.includes(chainId);

  const contracts: ContractDeployment = {
    validatorRegistry: process.env.VALIDATOR_REGISTRY_ADDRESS ?? '',
    policyRegistry: process.env.POLICY_REGISTRY_ADDRESS ?? '',
    verdictRegistry: process.env.VERDICT_REGISTRY_ADDRESS ?? '',
    slashingRewards: process.env.SLASHING_REWARDS_ADDRESS ?? '',
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
