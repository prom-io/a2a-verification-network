import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Priority queue for deferred jobs: the fee that orders it, and an index on
 * the status the queue is selected by. Existing jobs carry no fee.
 */
export class AddJobPriorityQueue1765000000000 implements MigrationInterface {
  name = 'AddJobPriorityQueue1765000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_jobs" ADD "fee" numeric(78,0) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_jobs_status" ON "verification_jobs" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_verification_jobs_status"`);
    await queryRunner.query(`ALTER TABLE "verification_jobs" DROP COLUMN "fee"`);
  }
}
