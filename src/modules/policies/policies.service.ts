import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationPolicy } from './entities/verification-policy.entity';
import { CreatePolicyDto } from './dto/create-policy.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PoliciesService {
  constructor(
    @InjectRepository(VerificationPolicy)
    private readonly policyRepo: Repository<VerificationPolicy>,
  ) {}

  async create(dto: CreatePolicyDto): Promise<VerificationPolicy> {
    const policy = this.policyRepo.create({
      name: dto.name,
      verificationClass: dto.verificationClass,
      selectionRule: dto.selectionRule,
      verificationMethod: dto.verificationMethod,
      quorumThreshold: dto.quorumThreshold,
      price: dto.price,
      disputeEscalation: dto.disputeEscalation ?? {},
      evidenceRequirements: dto.evidenceRequirements ?? {},
      metadataUri: dto.metadataUri ?? null,
      metadataHash: dto.metadataHash ?? null,
      minReputationScore: (dto.minReputationScore ?? 0).toFixed(4),
    });
    return this.policyRepo.save(policy);
  }

  async findAll(): Promise<VerificationPolicy[]> {
    return this.policyRepo.find();
  }

  /** The policy, or null when there is none (or the id cannot be one). */
  async findById(id: string): Promise<VerificationPolicy | null> {
    if (!UUID.test(id)) return null;
    return this.policyRepo.findOneBy({ id });
  }

  async findOne(id: string): Promise<VerificationPolicy> {
    const policy = await this.policyRepo.findOneBy({ id });
    if (!policy) throw new NotFoundException(`Policy ${id} not found`);
    return policy;
  }
}
