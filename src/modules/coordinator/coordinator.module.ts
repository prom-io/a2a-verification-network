import { Module, forwardRef } from '@nestjs/common';
import { CoordinatorService } from './coordinator.service';
import { JobsModule } from '../jobs/jobs.module';
import { ValidatorsModule } from '../validators/validators.module';
import { VerdictsModule } from '../verdicts/verdicts.module';
import { ReputationModule } from '../reputation/reputation.module';

@Module({
  imports: [
    forwardRef(() => JobsModule),
    ValidatorsModule,
    forwardRef(() => VerdictsModule),
    ReputationModule,
  ],
  providers: [CoordinatorService],
  exports: [CoordinatorService],
})
export class CoordinatorModule {}
