import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispute, DisputeOutcome, DisputeStatus } from './entities/dispute.entity';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { SlashingService } from '../slashing/slashing.service';

@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    private readonly slashingService: SlashingService,
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
    // A second resolution would overwrite the recorded outcome after the escrow
    // has already been released on the first one.
    if (dispute.status === DisputeStatus.RESOLVED) {
      throw new ConflictException(`Dispute ${id} is already resolved`);
    }
    dispute.status = DisputeStatus.RESOLVED;
    dispute.resolution = dto.resolution;
    dispute.outcome = dto.outcome ?? null;
    dispute.resolvedAt = new Date();
    const saved = await this.disputeRepo.save(dispute);

    if (saved.outcome === DisputeOutcome.OVERTURNED) {
      await this.slashingService.proposeForOverturnedVerdict({
        disputeId: saved.id,
        sessionId: saved.sessionId,
        reason: `Verdict overturned in dispute ${saved.id}: ${dto.resolution}`,
      });
    }
    return saved;
  }
}
