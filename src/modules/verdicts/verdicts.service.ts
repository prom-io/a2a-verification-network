import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Verdict, VerdictOutcome } from './entities/verdict.entity';
import { BlockchainService } from '../../common/blockchain/blockchain.service';
import { VERDICT_REGISTRY_ABI } from '../../common/blockchain/abis/verdict-registry.abi';

@Injectable()
export class VerdictsService {
  private readonly logger = new Logger(VerdictsService.name);
  private readonly verdictRegistryAddress: string;

  constructor(
    @InjectRepository(Verdict)
    private readonly verdictRepo: Repository<Verdict>,
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
  ) {
    this.verdictRegistryAddress = this.configService.get<string>('VERDICT_REGISTRY_ADDRESS', '');
  }

  async findBySessionId(sessionId: string): Promise<Verdict> {
    const verdict = await this.verdictRepo.findOneBy({ sessionId });
    if (!verdict) throw new NotFoundException(`Verdict for session ${sessionId} not found`);
    return verdict;
  }

  async findAll(): Promise<Verdict[]> {
    return this.verdictRepo.find();
  }

  async createAndPublish(params: {
    sessionId: string;
    jobId: string;
    outcome: VerdictOutcome;
    payableAmount: string;
    metaHash: string;
    validatorIds: string[];
  }): Promise<Verdict & { txHash?: string }> {
    const verdict = this.verdictRepo.create({
      sessionId: params.sessionId,
      jobId: params.jobId,
      outcome: params.outcome,
      payableAmount: params.payableAmount,
      metaHash: params.metaHash,
      signatures: params.validatorIds,
    });
    const saved = await this.verdictRepo.save(verdict);

    let txHash: string | undefined;
    if (this.verdictRegistryAddress) {
      try {
        const contract = this.blockchainService.getContract(this.verdictRegistryAddress, VERDICT_REGISTRY_ABI);
        const sessionIdBytes = ethers.keccak256(ethers.toUtf8Bytes(params.sessionId));
        const outcomeEnum = params.outcome === VerdictOutcome.ACCEPT ? 0 : params.outcome === VerdictOutcome.PARTIAL ? 1 : 2;
        const metaHashBytes = ethers.keccak256(ethers.toUtf8Bytes(params.metaHash));
        const walletAddress = await this.blockchainService.getWalletAddress();
        const tx = await contract.postVerdict(
          sessionIdBytes,
          outcomeEnum,
          ethers.parseEther(params.payableAmount || '0'),
          metaHashBytes,
          [walletAddress],
        );
        const receipt = await tx.wait();
        txHash = receipt.hash;
        this.logger.log(`Verdict for session ${params.sessionId} published on-chain, tx: ${txHash}`);
      } catch (error: any) {
        this.logger.error(`On-chain verdict publish failed: ${error.message}`);
      }
    }

    return { ...saved, txHash };
  }
}
