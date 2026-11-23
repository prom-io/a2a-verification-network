import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quorum timeout fallback: how often a job's committee was widened after a
 * round ended without a quorum, and where the latest widening started.
 */
export class AddQuorumExpansion1770000000000 implements MigrationInterface {
  name = 'AddQuorumExpansion1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_jobs" ADD "quorumExpansions" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "verification_jobs" ADD "expandedFrom" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "verification_jobs" DROP COLUMN "expandedFrom"`);
    await queryRunner.query(`ALTER TABLE "verification_jobs" DROP COLUMN "quorumExpansions"`);
  }
}
