import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReputationScore } from './entities/reputation-score.entity';

@Injectable()
export class ReputationService {
  constructor(
    @InjectRepository(ReputationScore)
    private readonly reputationRepo: Repository<ReputationScore>,
  ) {}

  async findByEntityId(entityId: string): Promise<ReputationScore> {
    const score = await this.reputationRepo.findOneBy({ entityId });
    if (!score)
      throw new NotFoundException(
        `Reputation for entity ${entityId} not found`,
      );
    return score;
  }

  async upsert(data: Partial<ReputationScore>): Promise<ReputationScore> {
    const existing = await this.reputationRepo.findOneBy({
      entityId: data.entityId,
    });
    if (existing) {
      Object.assign(existing, data);
      return this.reputationRepo.save(existing);
    }
    const score = this.reputationRepo.create(data);
    return this.reputationRepo.save(score);
  }
}
