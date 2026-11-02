import { MigrationInterface, QueryRunner } from 'typeorm';

/** Evidence attached to disputes: location, SHA-256 content hash, metadata. */
export class AddDisputeEvidence1763000000000 implements MigrationInterface {
  name = 'AddDisputeEvidence1763000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "dispute_evidence" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "disputeId" character varying NOT NULL,
        "submitter" character varying(256) NOT NULL,
        "uri" character varying(1024) NOT NULL,
        "contentHash" character varying(66) NOT NULL,
        "mimeType" character varying(128),
        "sizeBytes" integer,
        "description" text,
        "hashVerified" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dispute_evidence" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_dispute_evidence_dispute_hash" UNIQUE ("disputeId", "contentHash")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_dispute_evidence_disputeId" ON "dispute_evidence" ("disputeId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_dispute_evidence_disputeId"`);
    await queryRunner.query(`DROP TABLE "dispute_evidence"`);
  }
}
