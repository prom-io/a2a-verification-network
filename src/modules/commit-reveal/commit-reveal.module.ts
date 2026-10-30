import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { ValidatorsModule } from '../validators/validators.module';
import { VerdictsModule } from '../verdicts/verdicts.module';
import { ReputationModule } from '../reputation/reputation.module';
import { VerdictCommitment } from './entities/verdict-commitment.entity';
import { CommitRevealController } from './commit-reveal.controller';
import { CommitRevealService } from './commit-reveal.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerdictCommitment]),
    JobsModule,
    ValidatorsModule,
    VerdictsModule,
    ReputationModule,
  ],
  controllers: [CommitRevealController],
  providers: [CommitRevealService],
  exports: [CommitRevealService],
})
export class CommitRevealModule {}
