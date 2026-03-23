import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfigFactory } from './config/database.config';
import blockchainConfig from './config/blockchain.config';
import { BlockchainModule } from './common/blockchain/blockchain.module';
import { HealthModule } from './modules/health/health.module';
import { ValidatorsModule } from './modules/validators/validators.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { CoordinatorModule } from './modules/coordinator/coordinator.module';
import { VerdictsModule } from './modules/verdicts/verdicts.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { ReputationModule } from './modules/reputation/reputation.module';
import { PoliciesModule } from './modules/policies/policies.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [blockchainConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: databaseConfigFactory,
    }),
    BlockchainModule,
    HealthModule,
    ValidatorsModule,
    JobsModule,
    CoordinatorModule,
    VerdictsModule,
    DisputesModule,
    ReputationModule,
    PoliciesModule,
  ],
})
export class AppModule {}
