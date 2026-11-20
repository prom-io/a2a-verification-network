import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stake-weighted quorum: the rules a job's committee votes under and the
 * stakes recorded at assignment. Existing jobs keep one vote per validator.
 */
export class AddStakeWeightedQuorum1769000000000 implements MigrationInterface {
  name = 'AddStakeWeightedQuorum1769000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_jobs" ADD "quorumWeighting" character varying(8) NOT NULL DEFAULT 'equal'`,
    );
    await queryRunner.query(`ALTER TABLE "verification_jobs" ADD "quorumThresholdBps" integer`);
    await queryRunner.query(
      `ALTER TABLE "verification_jobs" ADD "committeeWeights" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_jobs" ADD CONSTRAINT "CHK_verification_jobs_quorum_threshold" ` +
        `CHECK ("quorumThresholdBps" IS NULL OR "quorumThresholdBps" BETWEEN 5001 AND 10000)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_jobs" DROP CONSTRAINT "CHK_verification_jobs_quorum_threshold"`,
    );
    await queryRunner.query(`ALTER TABLE "verification_jobs" DROP COLUMN "committeeWeights"`);
    await queryRunner.query(`ALTER TABLE "verification_jobs" DROP COLUMN "quorumThresholdBps"`);
    await queryRunner.query(`ALTER TABLE "verification_jobs" DROP COLUMN "quorumWeighting"`);
  }
}
