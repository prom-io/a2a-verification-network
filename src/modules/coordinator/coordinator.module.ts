import { Module, forwardRef } from '@nestjs/common';
import { CoordinatorService } from './coordinator.service';
import { JobsModule } from '../jobs/jobs.module';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { VerdictsModule } from '../verdicts/verdicts.module';
import { ReputationModule } from '../reputation/reputation.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [
    forwardRef(() => JobsModule),
    EligibilityModule,
    forwardRef(() => VerdictsModule),
    ReputationModule,
    WebhooksModule,
  ],
  providers: [CoordinatorService],
  exports: [CoordinatorService],
})
export class CoordinatorModule {}
