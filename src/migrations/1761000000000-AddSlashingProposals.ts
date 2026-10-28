import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slashing proposals raised when a dispute overturns a verdict, and the
 * outcome column on disputes that triggers them. Disputes resolved before
 * this migration keep a NULL outcome: nobody recorded what they meant.
 */
export class AddSlashingProposals1761000000000 implements MigrationInterface {
  name = 'AddSlashingProposals1761000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "disputes" ADD "outcome" character varying(16)`);

    await queryRunner.query(`
      CREATE TABLE "slashing_proposals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "validatorId" character varying NOT NULL,
        "disputeId" character varying NOT NULL,
        "sessionId" character varying NOT NULL,
        "verdictId" character varying NOT NULL,
        "reason" text NOT NULL,
        "stakeAtProposal" numeric(78,0) NOT NULL,
        "amount" numeric(78,0) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'proposed',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "decidedAt" TIMESTAMP,
        "decidedBy" character varying,
        "decisionNote" text,
        CONSTRAINT "PK_slashing_proposals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_slashing_proposals_dispute_validator" UNIQUE ("disputeId", "validatorId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_slashing_proposals_validatorId" ON "slashing_proposals" ("validatorId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_slashing_proposals_disputeId" ON "slashing_proposals" ("disputeId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_slashing_proposals_disputeId"`);
    await queryRunner.query(`DROP INDEX "IDX_slashing_proposals_validatorId"`);
    await queryRunner.query(`DROP TABLE "slashing_proposals"`);
    await queryRunner.query(`ALTER TABLE "disputes" DROP COLUMN "outcome"`);
  }
}
