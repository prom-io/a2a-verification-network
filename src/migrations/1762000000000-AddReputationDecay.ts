import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reputation decay: the evidence weight behind the averages and the time of
 * the last observation. Existing rows start from their job count as weight
 * and their last update as last activity, so their history is neither
 * discarded nor treated as brand new.
 */
export class AddReputationDecay1762000000000 implements MigrationInterface {
  name = 'AddReputationDecay1762000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reputation_scores" ADD "evidenceWeight" numeric(14,6) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(`ALTER TABLE "reputation_scores" ADD "lastActivityAt" TIMESTAMP`);
    await queryRunner.query(
      `UPDATE "reputation_scores" SET "evidenceWeight" = "totalJobs", "lastActivityAt" = "lastUpdated"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "reputation_scores" DROP COLUMN "lastActivityAt"`);
    await queryRunner.query(`ALTER TABLE "reputation_scores" DROP COLUMN "evidenceWeight"`);
  }
}
