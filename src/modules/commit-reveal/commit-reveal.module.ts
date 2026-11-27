import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { ValidatorsModule } from '../validators/validators.module';
import { VerdictsModule } from '../verdicts/verdicts.module';
import { ReputationModule } from '../reputation/reputation.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { VerdictCommitment } from './entities/verdict-commitment.entity';
import { CommitRevealController } from './commit-reveal.controller';
import { CommitRevealService } from './commit-reveal.service';
import { QuorumTimeoutService } from './quorum-timeout.service';
import { RoundsController } from './rounds.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerdictCommitment]),
    JobsModule,
    ValidatorsModule,
    VerdictsModule,
    ReputationModule,
    WebhooksModule,
    EligibilityModule,
  ],
  controllers: [CommitRevealController, RoundsController],
  providers: [CommitRevealService, QuorumTimeoutService],
  exports: [CommitRevealService],
})
export class CommitRevealModule {}
