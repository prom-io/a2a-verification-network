import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Verdict webhooks: the callback URL a submitter leaves on a job, and the
 * deliveries owed to it with their attempt history.
 */
export class AddVerdictWebhooks1767000000000 implements MigrationInterface {
  name = 'AddVerdictWebhooks1767000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_jobs" ADD "callbackUrl" character varying(1024)`,
    );

    await queryRunner.query(`
      CREATE TABLE "webhook_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "jobId" character varying NOT NULL,
        "sessionId" character varying NOT NULL,
        "url" character varying(1024) NOT NULL,
        "event" character varying(32) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "lastStatusCode" integer,
        "lastError" text,
        "nextAttemptAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deliveredAt" TIMESTAMP,
        CONSTRAINT "PK_webhook_deliveries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_deliveries_jobId" ON "webhook_deliveries" ("jobId")`,
    );
    // The retry run selects pending deliveries that are due.
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_deliveries_due" ON "webhook_deliveries" ("status", "nextAttemptAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_webhook_deliveries_due"`);
    await queryRunner.query(`DROP INDEX "IDX_webhook_deliveries_jobId"`);
    await queryRunner.query(`DROP TABLE "webhook_deliveries"`);
    await queryRunner.query(`ALTER TABLE "verification_jobs" DROP COLUMN "callbackUrl"`);
  }
}
