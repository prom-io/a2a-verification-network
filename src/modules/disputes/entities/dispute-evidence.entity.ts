import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * A piece of evidence attached to a dispute. The service stores where the
 * content lives and what it hashes to, never the content itself: the hash is
 * what lets a reviewer check that the document they fetched is the one that
 * was submitted.
 */
@Entity('dispute_evidence')
@Unique('UQ_dispute_evidence_dispute_hash', ['disputeId', 'contentHash'])
export class DisputeEvidence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_dispute_evidence_disputeId')
  @Column({ type: 'varchar' })
  disputeId!: string;

  @Column({ type: 'varchar', length: 256 })
  submitter!: string;

  @Column({ type: 'varchar', length: 1024 })
  uri!: string;

  /** SHA-256 of the content, 0x-prefixed lowercase hex. */
  @Column({ type: 'varchar', length: 66 })
  contentHash!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  mimeType!: string | null;

  @Column({ type: 'int', nullable: true })
  sizeBytes!: number | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** True once the service itself has hashed the content and it matched. */
  @Column({ type: 'boolean', default: false })
  hashVerified!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
