import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Validator } from './entities/validator.entity';
import { ValidatorsController } from './validators.controller';
import { ValidatorsService } from './validators.service';
import { ValidatorAvailabilityService } from './validator-availability.service';

@Module({
  imports: [TypeOrmModule.forFeature([Validator])],
  controllers: [ValidatorsController],
  providers: [ValidatorsService, ValidatorAvailabilityService],
  exports: [ValidatorsService, ValidatorAvailabilityService],
})
export class ValidatorsModule {}
