import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Staking tiers.
 *
 * The stake is kept in wei, and decimal(36,18) leaves only 18 integer digits:
 * one whole token (1e18 wei) already overflowed it. numeric(78,0) holds any
 * uint256. The tier column is derived from the stake; existing rows are
 * backfilled with the default thresholds (1, 5, 20 and 100 times a minimum
 * stake of 1e18 wei) and corrected by the service on the next stake update if
 * VALIDATOR_MIN_STAKE_WEI is set to something else.
 */
export class AddValidatorStakingTiers1759000000000 implements MigrationInterface {
  name = 'AddValidatorStakingTiers1759000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "validators" ALTER COLUMN "stake" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "validators" ALTER COLUMN "stake" TYPE numeric(78,0) USING trunc("stake")`,
    );
    await queryRunner.query(`ALTER TABLE "validators" ALTER COLUMN "stake" SET DEFAULT '0'`);

    await queryRunner.query(
      `ALTER TABLE "validators" ADD "tier" character varying(16) NOT NULL DEFAULT 'none'`,
    );
    await queryRunner.query(`
      UPDATE "validators" SET "tier" = CASE
        WHEN "stake" >= 100000000000000000000 THEN 'platinum'
        WHEN "stake" >= 20000000000000000000 THEN 'gold'
        WHEN "stake" >= 5000000000000000000 THEN 'silver'
        WHEN "stake" >= 1000000000000000000 THEN 'bronze'
        ELSE 'none'
      END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "validators" DROP COLUMN "tier"`);

    // Stakes of a whole token or more do not fit the old column; clamp them to
    // its maximum instead of failing the revert.
    await queryRunner.query(`ALTER TABLE "validators" ALTER COLUMN "stake" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "validators" ALTER COLUMN "stake" TYPE numeric(36,18)
      USING LEAST("stake", 999999999999999999)
    `);
    await queryRunner.query(`ALTER TABLE "validators" ALTER COLUMN "stake" SET DEFAULT '0'`);
  }
}
