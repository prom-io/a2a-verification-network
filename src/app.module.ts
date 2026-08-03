import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { CsrfMiddleware } from './common/middleware/csrf.middleware';
import { AuthModule } from './common/auth/auth.module';
import { databaseConfigFactory } from './config/database.config';
import { throttlerConfigFactory } from './config/throttler.config';
import blockchainConfig from './config/blockchain.config';
import securityConfig from './config/security.config';
import deploymentsConfig from './config/deployments.config';
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
      load: [blockchainConfig, securityConfig, deploymentsConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: databaseConfigFactory,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: throttlerConfigFactory,
    }),
    AuthModule,
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
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityHeadersMiddleware, CsrfMiddleware).forRoutes('*');
  }
}
