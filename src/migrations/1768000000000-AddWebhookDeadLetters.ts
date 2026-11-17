import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dead-letter queue for verdict webhooks: deliveries that are not retried any
 * more keep the reason and time they were given up on, and can be replayed.
 * Deliveries that had already failed are moved into the queue.
 */
export class AddWebhookDeadLetters1768000000000 implements MigrationInterface {
  name = 'AddWebhookDeadLetters1768000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "webhook_deliveries" ADD "deadLetteredAt" TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "webhook_deliveries" ADD "deadLetterReason" character varying(32)`,
    );
    await queryRunner.query(`ALTER TABLE "webhook_deliveries" ADD "replayedAt" TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "webhook_deliveries" ADD "replays" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      UPDATE "webhook_deliveries"
      SET "status" = 'dead_letter',
          "deadLetteredAt" = COALESCE("deadLetteredAt", "createdAt"),
          "deadLetterReason" = CASE
            WHEN "lastError" LIKE 'target refused:%' THEN 'target_refused'
            ELSE 'exhausted'
          END
      WHERE "status" = 'failed'
    `);
    // The queue is listed newest first and is small next to the whole table.
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_deliveries_dead_letter" ON "webhook_deliveries" ("deadLetteredAt") ` +
        `WHERE "status" = 'dead_letter'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_webhook_deliveries_dead_letter"`);
    await queryRunner.query(
      `UPDATE "webhook_deliveries" SET "status" = 'failed' WHERE "status" = 'dead_letter'`,
    );
    await queryRunner.query(`ALTER TABLE "webhook_deliveries" DROP COLUMN "replays"`);
    await queryRunner.query(`ALTER TABLE "webhook_deliveries" DROP COLUMN "replayedAt"`);
    await queryRunner.query(`ALTER TABLE "webhook_deliveries" DROP COLUMN "deadLetterReason"`);
    await queryRunner.query(`ALTER TABLE "webhook_deliveries" DROP COLUMN "deadLetteredAt"`);
  }
}
