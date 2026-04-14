import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const databaseConfigFactory = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DATABASE_HOST', 'localhost'),
  port: configService.get<number>('DATABASE_PORT', 5432),
  username: configService.get<string>('DATABASE_USER', 'postgres'),
  password: configService.get<string>('DATABASE_PASSWORD', 'postgres'),
  database: configService.get<string>('DATABASE_NAME', 'verification_db'),
  autoLoadEntities: true,
  synchronize: configService.get<string>('NODE_ENV', 'development') === 'development',
  migrationsRun: configService.get<string>('NODE_ENV') === 'production',
  migrations: ['dist/migrations/*.js'],
  migrationsTableName: 'typeorm_migrations',
  poolSize: configService.get<number>('DATABASE_POOL_SIZE', 20),
  extra: {
    max: configService.get<number>('DATABASE_POOL_MAX', 20),
    min: configService.get<number>('DATABASE_POOL_MIN', 2),
    idleTimeoutMillis: configService.get<number>('DATABASE_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: configService.get<number>('DATABASE_CONNECT_TIMEOUT_MS', 5_000),
    statement_timeout: configService.get<number>('DATABASE_STATEMENT_TIMEOUT_MS', 15_000),
    query_timeout: configService.get<number>('DATABASE_QUERY_TIMEOUT_MS', 15_000),
  },
  connectTimeoutMS: configService.get<number>('DATABASE_CONNECT_TIMEOUT_MS', 5_000),
  logging: configService.get<string>('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
  maxQueryExecutionTime: configService.get<number>('DATABASE_SLOW_QUERY_MS', 1_000),
});
