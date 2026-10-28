import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dispute } from './entities/dispute.entity';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { SlashingModule } from '../slashing/slashing.module';

@Module({
  imports: [TypeOrmModule.forFeature([Dispute]), SlashingModule],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
