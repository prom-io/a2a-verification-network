import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dispute appeals: the `appealed` status, the appeal with its panel, and one
 * row per panel vote.
 */
export class AddDisputeAppeals1764000000000 implements MigrationInterface {
  name = 'AddDisputeAppeals1764000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Safe inside the migration transaction on PostgreSQL 12+: the new label
    // is only added here, never used before the transaction commits.
    await queryRunner.query(`ALTER TYPE "disputes_status_enum" ADD VALUE IF NOT EXISTS 'appealed'`);

    await queryRunner.query(`
      CREATE TABLE "dispute_appeals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "disputeId" character varying NOT NULL,
        "appellant" character varying(256) NOT NULL,
        "reason" text NOT NULL,
        "originalOutcome" character varying(16) NOT NULL,
        "panel" jsonb NOT NULL DEFAULT '[]',
        "quorum" integer NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'open',
        "decision" character varying(16),
        "openedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "votingDeadline" TIMESTAMP NOT NULL,
        "decidedAt" TIMESTAMP,
        CONSTRAINT "PK_dispute_appeals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_dispute_appeals_disputeId" UNIQUE ("disputeId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "dispute_appeal_votes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "appealId" character varying NOT NULL,
        "validatorId" character varying NOT NULL,
        "vote" character varying(16) NOT NULL,
        "castAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dispute_appeal_votes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_dispute_appeal_votes_appeal_validator" UNIQUE ("appealId", "validatorId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_dispute_appeal_votes_appealId" ON "dispute_appeal_votes" ("appealId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_dispute_appeal_votes_appealId"`);
    await queryRunner.query(`DROP TABLE "dispute_appeal_votes"`);
    await queryRunner.query(`DROP TABLE "dispute_appeals"`);

    // PostgreSQL cannot drop an enum label, so the type is rebuilt without it.
    // A dispute still under appeal goes back to the resolution it had.
    await queryRunner.query(`ALTER TYPE "disputes_status_enum" RENAME TO "disputes_status_enum_old"`);
    await queryRunner.query(
      `CREATE TYPE "disputes_status_enum" AS ENUM ('open', 'escalated', 'resolved')`,
    );
    await queryRunner.query(`ALTER TABLE "disputes" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "disputes" ALTER COLUMN "status" TYPE "disputes_status_enum"
      USING (CASE WHEN "status"::text = 'appealed' THEN 'resolved' ELSE "status"::text END)::"disputes_status_enum"
    `);
    await queryRunner.query(`ALTER TABLE "disputes" ALTER COLUMN "status" SET DEFAULT 'open'`);
    await queryRunner.query(`DROP TYPE "disputes_status_enum_old"`);
  }
}
