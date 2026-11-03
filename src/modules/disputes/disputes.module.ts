import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dispute } from './entities/dispute.entity';
import { DisputeEvidence } from './entities/dispute-evidence.entity';
import { DisputeAppeal, DisputeAppealVote } from './entities/dispute-appeal.entity';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { DisputeEvidenceController } from './dispute-evidence.controller';
import { DisputeEvidenceService } from './dispute-evidence.service';
import { DisputeAppealsController } from './dispute-appeals.controller';
import { DisputeAppealsService } from './dispute-appeals.service';
import { ValidatorsModule } from '../validators/validators.module';
import { VerdictsModule } from '../verdicts/verdicts.module';
import { SlashingModule } from '../slashing/slashing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dispute, DisputeEvidence, DisputeAppeal, DisputeAppealVote]),
    SlashingModule,
    ValidatorsModule,
    VerdictsModule,
  ],
  controllers: [DisputesController, DisputeEvidenceController, DisputeAppealsController],
  providers: [DisputesService, DisputeEvidenceService, DisputeAppealsService],
  exports: [DisputesService, DisputeEvidenceService, DisputeAppealsService],
})
export class DisputesModule {}
