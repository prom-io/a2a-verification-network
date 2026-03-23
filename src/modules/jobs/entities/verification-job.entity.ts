import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum JobStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('verification_jobs')
export class VerificationJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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
}
