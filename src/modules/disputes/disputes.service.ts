import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispute, DisputeStatus } from './entities/dispute.entity';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
  ) {}

  async open(dto: OpenDisputeDto): Promise<Dispute> {
    const dispute = this.disputeRepo.create({
      sessionId: dto.sessionId,
      reason: dto.reason,
      initiator: dto.initiator,
      status: DisputeStatus.OPEN,
    });
    return this.disputeRepo.save(dispute);
  }

  async findOne(id: string): Promise<Dispute> {
    const dispute = await this.disputeRepo.findOneBy({ id });
    if (!dispute) throw new NotFoundException(`Dispute ${id} not found`);
    return dispute;
  }

  async resolve(id: string, dto: ResolveDisputeDto): Promise<Dispute> {
    const dispute = await this.findOne(id);
    dispute.status = DisputeStatus.RESOLVED;
    dispute.resolution = dto.resolution;
    dispute.resolvedAt = new Date();
    return this.disputeRepo.save(dispute);
  }
}
