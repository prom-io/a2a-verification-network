import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1712000000000 implements MigrationInterface {
  name = 'InitSchema1712000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE dispute_status AS ENUM ('open', 'escalated', 'resolved');
    `);

    await queryRunner.query(`
      CREATE TABLE "validators" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "address" varchar NOT NULL UNIQUE,
        "publicKey" varchar NOT NULL,
        "stake" decimal(36,18) NOT NULL DEFAULT 0,
        "endpoint" varchar NOT NULL,
        "capabilities" jsonb NOT NULL DEFAULT '[]',
        "isActive" boolean NOT NULL DEFAULT true,
        "registeredAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_validators" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "verification_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionId" varchar NOT NULL,
        "policyId" varchar NOT NULL,
        "assignedValidators" jsonb NOT NULL DEFAULT '[]',
        "status" varchar NOT NULL DEFAULT 'pending',
        "result" jsonb,
        "submittedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "completedAt" TIMESTAMP,
        CONSTRAINT "PK_verification_jobs" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "verdicts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionId" varchar NOT NULL,
        "jobId" varchar NOT NULL,
        "outcome" varchar NOT NULL DEFAULT 'pending',
        "confidence" decimal(5,4) NOT NULL DEFAULT 0,
        "validatorSignatures" jsonb NOT NULL DEFAULT '[]',
        "onChainTxHash" varchar,
        "issuedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_verdicts" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "disputes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionId" varchar NOT NULL,
        "reason" text NOT NULL,
        "initiator" varchar NOT NULL,
        "status" dispute_status NOT NULL DEFAULT 'open',
        "resolution" text,
        "openedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "resolvedAt" TIMESTAMP,
        CONSTRAINT "PK_disputes" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "verification_policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "minValidators" int NOT NULL DEFAULT 3,
        "consensusThreshold" decimal(3,2) NOT NULL DEFAULT 0.67,
        "maxResponseTime" int NOT NULL DEFAULT 30,
        "rules" jsonb NOT NULL DEFAULT '{}',
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_verification_policies" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "reputation_scores" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "entityId" varchar NOT NULL UNIQUE,
        "entityType" varchar NOT NULL DEFAULT 'validator',
        "score" decimal(5,2) NOT NULL DEFAULT 100,
        "totalJobs" int NOT NULL DEFAULT 0,
        "successfulJobs" int NOT NULL DEFAULT 0,
        "failedJobs" int NOT NULL DEFAULT 0,
        "lastUpdated" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reputation_scores" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`CREATE INDEX "IDX_validators_address" ON "validators" ("address")`);
    await queryRunner.query(`CREATE INDEX "IDX_verification_jobs_sessionId" ON "verification_jobs" ("sessionId")`);
    await queryRunner.query(`CREATE INDEX "IDX_verdicts_sessionId" ON "verdicts" ("sessionId")`);
    await queryRunner.query(`CREATE INDEX "IDX_disputes_sessionId" ON "disputes" ("sessionId")`);
    await queryRunner.query(`CREATE INDEX "IDX_reputation_entityId" ON "reputation_scores" ("entityId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_reputation_entityId"`);
    await queryRunner.query(`DROP INDEX "IDX_disputes_sessionId"`);
    await queryRunner.query(`DROP INDEX "IDX_verdicts_sessionId"`);
    await queryRunner.query(`DROP INDEX "IDX_verification_jobs_sessionId"`);
    await queryRunner.query(`DROP INDEX "IDX_validators_address"`);
    await queryRunner.query(`DROP TABLE "reputation_scores"`);
    await queryRunner.query(`DROP TABLE "verification_policies"`);
    await queryRunner.query(`DROP TABLE "disputes"`);
    await queryRunner.query(`DROP TABLE "verdicts"`);
    await queryRunner.query(`DROP TABLE "verification_jobs"`);
    await queryRunner.query(`DROP TABLE "validators"`);
    await queryRunner.query(`DROP TYPE dispute_status`);
  }
}
