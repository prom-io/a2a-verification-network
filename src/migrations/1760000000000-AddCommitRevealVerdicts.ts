import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Commit-reveal verdicts: the mode and phase deadlines on the job, and one row
 * per validator commitment. Existing jobs keep the instant mode.
 */
export class AddCommitRevealVerdicts1760000000000 implements MigrationInterface {
  name = 'AddCommitRevealVerdicts1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_jobs" ADD "verdictMode" character varying(16) NOT NULL DEFAULT 'instant'`,
    );
    await queryRunner.query(`ALTER TABLE "verification_jobs" ADD "commitDeadline" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "verification_jobs" ADD "revealDeadline" TIMESTAMP`);

    await queryRunner.query(`
      CREATE TABLE "verdict_commitments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "jobId" character varying NOT NULL,
        "validatorId" character varying NOT NULL,
        "commitHash" character varying(66) NOT NULL,
        "outcome" character varying(16),
        "salt" character varying(66),
        "committedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "revealedAt" TIMESTAMP,
        CONSTRAINT "PK_verdict_commitments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_verdict_commitments_job_validator" UNIQUE ("jobId", "validatorId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_verdict_commitments_jobId" ON "verdict_commitments" ("jobId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_verdict_commitments_jobId"`);
    await queryRunner.query(`DROP TABLE "verdict_commitments"`);
    await queryRunner.query(`ALTER TABLE "verification_jobs" DROP COLUMN "revealDeadline"`);
    await queryRunner.query(`ALTER TABLE "verification_jobs" DROP COLUMN "commitDeadline"`);
    await queryRunner.query(`ALTER TABLE "verification_jobs" DROP COLUMN "verdictMode"`);
  }
}
