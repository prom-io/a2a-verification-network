import { MigrationInterface, QueryRunner } from 'typeorm';

/** Minimum validator reputation per policy; existing policies stay ungated. */
export class AddPolicyReputationGate1771000000000 implements MigrationInterface {
  name = 'AddPolicyReputationGate1771000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_policies" ADD "minReputationScore" numeric(5,4) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_policies" ADD CONSTRAINT "CHK_verification_policies_min_reputation" ` +
        `CHECK ("minReputationScore" >= 0 AND "minReputationScore" <= 1)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "verification_policies" DROP CONSTRAINT "CHK_verification_policies_min_reputation"`,
    );
    await queryRunner.query(`ALTER TABLE "verification_policies" DROP COLUMN "minReputationScore"`);
  }
}
