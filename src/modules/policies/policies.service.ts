import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationPolicy } from './entities/verification-policy.entity';
import { CreatePolicyDto } from './dto/create-policy.dto';

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
    });
    return this.policyRepo.save(policy);
  }

  async findAll(): Promise<VerificationPolicy[]> {
    return this.policyRepo.find();
  }

  async findOne(id: string): Promise<VerificationPolicy> {
    const policy = await this.policyRepo.findOneBy({ id });
    if (!policy) throw new NotFoundException(`Policy ${id} not found`);
    return policy;
  }
}
