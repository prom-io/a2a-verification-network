import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

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

  /** Set at assignment for commit-reveal jobs; commitments close after it. */
  @Column({ type: 'timestamp', nullable: true })
  commitDeadline!: Date | null;

  /** Reveals close after it and the round can be finalized. */
  @Column({ type: 'timestamp', nullable: true })
  revealDeadline!: Date | null;
}
