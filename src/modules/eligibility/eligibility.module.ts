import { Module } from '@nestjs/common';
import { PoliciesModule } from '../policies/policies.module';
import { ReputationModule } from '../reputation/reputation.module';
import { ValidatorsModule } from '../validators/validators.module';
import { EligibilityController } from './eligibility.controller';
import { EligibilityService } from './eligibility.service';

@Module({
  imports: [ValidatorsModule, ReputationModule, PoliciesModule],
  controllers: [EligibilityController],
  providers: [EligibilityService],
  exports: [EligibilityService],
})
export class EligibilityModule {}
