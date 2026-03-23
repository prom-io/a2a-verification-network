import { Module, forwardRef } from '@nestjs/common';
import { CoordinatorService } from './coordinator.service';
import { JobsModule } from '../jobs/jobs.module';
import { ValidatorsModule } from '../validators/validators.module';
import { VerdictsModule } from '../verdicts/verdicts.module';

@Module({
  imports: [
    forwardRef(() => JobsModule),
    ValidatorsModule,
    forwardRef(() => VerdictsModule),
  ],
  providers: [CoordinatorService],
  exports: [CoordinatorService],
})
export class CoordinatorModule {}
