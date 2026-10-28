import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ValidatorsModule } from '../validators/validators.module';
import { VerdictsModule } from '../verdicts/verdicts.module';
import { SlashingProposal } from './entities/slashing-proposal.entity';
import { SlashingController } from './slashing.controller';
import { SlashingService } from './slashing.service';

@Module({
  imports: [TypeOrmModule.forFeature([SlashingProposal]), ValidatorsModule, VerdictsModule],
  controllers: [SlashingController],
  providers: [SlashingService],
  exports: [SlashingService],
})
export class SlashingModule {}
