import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Verdict } from './entities/verdict.entity';
import { VerdictsController } from './verdicts.controller';
import { VerdictsService } from './verdicts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Verdict])],
  controllers: [VerdictsController],
  providers: [VerdictsService],
  exports: [VerdictsService],
})
export class VerdictsModule {}
