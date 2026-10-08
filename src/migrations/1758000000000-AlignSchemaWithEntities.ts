import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brings the schema created by InitSchema in line with the entities.
 *
 * The entities moved on after the initial migration was written (request and
 * result hashes on jobs, signed verdicts, versioned policies, the reputation
 * breakdown), and only `synchronize` in development kept the two together. A
 * database built from migrations alone rejected every insert into the four
 * tables rebuilt below, so they cannot hold rows worth preserving. Validators
 * and disputes did work and are altered in place.
 */
export class AlignSchemaWithEntities1758000000000 implements MigrationInterface {
  name = 'AlignSchemaWithEntities1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Covered by the unique constraints on the same columns.
    await queryRunner.query(`DROP INDEX "IDX_validators_address"`);
    await queryRunner.query(`DROP INDEX "IDX_verdicts_sessionId"`);
    await queryRunner.query(`DROP INDEX "IDX_reputation_entityId"`);
    await queryRunner.query(`DROP INDEX "IDX_verification_jobs_sessionId"`);

    await queryRunner.query(`DROP TABLE "verification_jobs"`);
    await queryRunner.query(`
      CREATE TYPE "verification_jobs_status_enum" AS ENUM ('pending', 'assigned', 'in_progress', 'completed', 'failed')
    `);
    await queryRunner.query(`
      CREATE TABLE "verification_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionId" varchar NOT NULL,
        "requestHash" varchar NOT NULL,
        "resultHash" varchar NOT NULL DEFAULT '',
        "policyId" varchar NOT NULL,
        "artifactsRef" varchar,
        "status" "verification_jobs_status_enum" NOT NULL DEFAULT 'pending',
        "assignedValidators" jsonb NOT NULL DEFAULT '[]',
        "submittedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "completedAt" TIMESTAMP,
        CONSTRAINT "PK_verification_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_jobs_sessionId" ON "verification_jobs" ("sessionId")`,
    );

    await queryRunner.query(`DROP TABLE "verdicts"`);
    await queryRunner.query(`CREATE TYPE "verdicts_outcome_enum" AS ENUM ('accept', 'partial', 'reject')`);
    await queryRunner.query(`
      CREATE TABLE "verdicts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionId" varchar NOT NULL,
        "jobId" varchar NOT NULL,
        "outcome" "verdicts_outcome_enum" NOT NULL,
        "payableAmount" decimal(36,18) NOT NULL DEFAULT 0,
        "metaHash" varchar NOT NULL,
        "signatures" jsonb NOT NULL DEFAULT '[]',
        "publishedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_verdicts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_verdicts_sessionId" UNIQUE ("sessionId")
      )
    `);

    await queryRunner.query(`DROP TABLE "verification_policies"`);
    await queryRunner.query(`
      CREATE TYPE "verification_policies_verificationclass_enum" AS ENUM ('class_0', 'class_1', 'class_2', 'class_3', 'class_4')
    `);
    await queryRunner.query(`
      CREATE TABLE "verification_policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "verificationClass" "verification_policies_verificationclass_enum" NOT NULL,
        "selectionRule" jsonb NOT NULL DEFAULT '{}',
        "verificationMethod" varchar NOT NULL,
        "quorumThreshold" int NOT NULL,
        "price" decimal(36,18) NOT NULL DEFAULT 0,
        "disputeEscalation" jsonb NOT NULL DEFAULT '{}',
        "evidenceRequirements" jsonb NOT NULL DEFAULT '{}',
        "metadataUri" varchar,
        "metadataHash" varchar,
        "version" int NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_verification_policies" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`DROP TABLE "reputation_scores"`);
    await queryRunner.query(`CREATE TYPE "reputation_scores_entitytype_enum" AS ENUM ('validator', 'agent')`);
    await queryRunner.query(`
      CREATE TABLE "reputation_scores" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "entityId" varchar NOT NULL,
        "entityType" "reputation_scores_entitytype_enum" NOT NULL,
        "accuracy" decimal(5,4) NOT NULL DEFAULT 1,
        "uptime" decimal(5,4) NOT NULL DEFAULT 1,
        "disputeLossRate" decimal(5,4) NOT NULL DEFAULT 0,
        "totalJobs" int NOT NULL DEFAULT 0,
        "lastUpdated" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reputation_scores" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reputation_scores_entityId" UNIQUE ("entityId")
      )
    `);

    // Same labels under the name the entity metadata expects, so the column
    // converts in place and open disputes keep their status.
    await queryRunner.query(`ALTER TYPE "dispute_status" RENAME TO "disputes_status_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "disputes_status_enum" RENAME TO "dispute_status"`);

    await queryRunner.query(`DROP TABLE "reputation_scores"`);
    await queryRunner.query(`DROP TYPE "reputation_scores_entitytype_enum"`);
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
      )
    `);

    await queryRunner.query(`DROP TABLE "verification_policies"`);
    await queryRunner.query(`DROP TYPE "verification_policies_verificationclass_enum"`);
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
      )
    `);

    await queryRunner.query(`DROP TABLE "verdicts"`);
    await queryRunner.query(`DROP TYPE "verdicts_outcome_enum"`);
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
      )
    `);

    await queryRunner.query(`DROP TABLE "verification_jobs"`);
    await queryRunner.query(`DROP TYPE "verification_jobs_status_enum"`);
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
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_validators_address" ON "validators" ("address")`);
    await queryRunner.query(`CREATE INDEX "IDX_verification_jobs_sessionId" ON "verification_jobs" ("sessionId")`);
    await queryRunner.query(`CREATE INDEX "IDX_verdicts_sessionId" ON "verdicts" ("sessionId")`);
    await queryRunner.query(`CREATE INDEX "IDX_reputation_entityId" ON "reputation_scores" ("entityId")`);
  }
}
