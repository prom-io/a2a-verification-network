import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dispute } from './entities/dispute.entity';
import { DisputeEvidence } from './entities/dispute-evidence.entity';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { DisputeEvidenceController } from './dispute-evidence.controller';
import { DisputeEvidenceService } from './dispute-evidence.service';
import { SlashingModule } from '../slashing/slashing.module';

@Module({
  imports: [TypeOrmModule.forFeature([Dispute, DisputeEvidence]), SlashingModule],
  controllers: [DisputesController, DisputeEvidenceController],
  providers: [DisputesService, DisputeEvidenceService],
  exports: [DisputesService, DisputeEvidenceService],
})
export class DisputesModule {}
