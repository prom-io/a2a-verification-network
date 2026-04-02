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
});
