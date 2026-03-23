import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Validator } from './entities/validator.entity';
import { ValidatorsController } from './validators.controller';
import { ValidatorsService } from './validators.service';

@Module({
  imports: [TypeOrmModule.forFeature([Validator])],
  controllers: [ValidatorsController],
  providers: [ValidatorsService],
  exports: [ValidatorsService],
})
export class ValidatorsModule {}
