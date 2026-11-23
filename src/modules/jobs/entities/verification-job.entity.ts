import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { QuorumWeighting } from '../../commit-reveal/weighted-quorum';

export enum JobStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/** How the committee arrives at the verdict for a job. */
export enum VerdictMode {
  /** The coordinator issues the verdict as soon as the job is assigned. */
  INSTANT = 'instant',
  /** Validators commit to a hashed vote, then reveal it; see commit-reveal. */
  COMMIT_REVEAL = 'commit_reveal',
}

@Entity('verification_jobs')
export class VerificationJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_verification_jobs_sessionId')
  @Column({ type: 'varchar' })
  sessionId!: string;

  @Column({ type: 'varchar' })
  requestHash!: string;

  @Column({ type: 'varchar', default: '' })
  resultHash!: string;

  @Column({ type: 'varchar' })
  policyId!: string;

  @Column({ type: 'varchar', nullable: true })
  artifactsRef!: string | null;

  @Index('IDX_verification_jobs_status')
  @Column({ type: 'enum', enum: JobStatus, default: JobStatus.PENDING })
  status!: JobStatus;

  @Column({ type: 'jsonb', default: [] })
  assignedValidators!: string[];

  @CreateDateColumn()
  submittedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, default: VerdictMode.INSTANT })
  verdictMode!: VerdictMode;

  /** Where the submitter wants to be told about the verdict, if anywhere. */
  @Column({ type: 'varchar', length: 1024, nullable: true })
  callbackUrl!: string | null;

  /** Fee offered by the submitter, in wei; orders the pending queue. */
  @Column({ type: 'numeric', precision: 78, scale: 0, default: 0 })
  fee!: string;

  /** Set at assignment for commit-reveal jobs; commitments close after it. */
  @Column({ type: 'timestamp', nullable: true })
  commitDeadline!: Date | null;

  /** Reveals close after it and the round can be finalized. */
  @Column({ type: 'timestamp', nullable: true })
  revealDeadline!: Date | null;

  /**
   * How committee votes are weighed; fixed when the committee is assigned.
   * Jobs from before stake-weighted voting keep one vote per validator.
   */
  @Column({ type: 'varchar', length: 8, default: QuorumWeighting.EQUAL })
  quorumWeighting!: QuorumWeighting;

  /**
   * Share of the committee's weight, in basis points, one outcome needs.
   * Set by the submitter or, at assignment, from QUORUM_THRESHOLD_BPS.
   */
  @Column({ type: 'int', nullable: true })
  quorumThresholdBps!: number | null;

  /** Stake in wei of every committee member at the time of assignment. */
  @Column({ type: 'jsonb', default: {} })
  committeeWeights!: Record<string, string>;

  /** How often the committee was widened because the round had no quorum. */
  @Column({ type: 'int', default: 0 })
  quorumExpansions!: number;

  /**
   * Committee size before the last expansion. Members before this index that
   * had not committed by then cannot commit any more: they could have seen
   * the votes revealed in the round that timed out.
   */
  @Column({ type: 'int', nullable: true })
  expandedFrom!: number | null;
}
