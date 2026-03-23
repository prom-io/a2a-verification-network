import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationJob } from './entities/verification-job.entity';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { CoordinatorModule } from '../coordinator/coordinator.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerificationJob]),
    forwardRef(() => CoordinatorModule),
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
