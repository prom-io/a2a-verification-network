import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Validator liveness: last heartbeat, suspension state and the exit time.
 * Validators that were already inactive are recorded as exited, because until
 * now leaving was the only way to become inactive.
 */
export class AddValidatorHeartbeat1766000000000 implements MigrationInterface {
  name = 'AddValidatorHeartbeat1766000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "validators" ADD "lastHeartbeatAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "validators" ADD "suspendedAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "validators" ADD "suspensionReason" character varying(32)`);
    await queryRunner.query(`ALTER TABLE "validators" ADD "exitedAt" TIMESTAMP`);
    await queryRunner.query(
      `UPDATE "validators" SET "exitedAt" = "updatedAt" WHERE "isActive" = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Suspended validators would otherwise come back as plain inactive ones
    // with nothing saying they never left.
    await queryRunner.query(
      `UPDATE "validators" SET "isActive" = true WHERE "suspendedAt" IS NOT NULL AND "exitedAt" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "validators" DROP COLUMN "exitedAt"`);
    await queryRunner.query(`ALTER TABLE "validators" DROP COLUMN "suspensionReason"`);
    await queryRunner.query(`ALTER TABLE "validators" DROP COLUMN "suspendedAt"`);
    await queryRunner.query(`ALTER TABLE "validators" DROP COLUMN "lastHeartbeatAt"`);
  }
}
