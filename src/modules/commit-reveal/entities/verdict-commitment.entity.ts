import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { VerdictOutcome } from '../../verdicts/entities/verdict.entity';

@Entity('verdict_commitments')
@Unique('UQ_verdict_commitments_job_validator', ['jobId', 'validatorId'])
export class VerdictCommitment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_verdict_commitments_jobId')
  @Column({ type: 'varchar' })
  jobId!: string;

  @Column({ type: 'varchar' })
  validatorId!: string;

  @Column({ type: 'varchar', length: 66 })
  commitHash!: string;

  /** Empty until the validator reveals. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  outcome!: VerdictOutcome | null;

  @Column({ type: 'varchar', length: 66, nullable: true })
  salt!: string | null;

  @CreateDateColumn()
  committedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  revealedAt!: Date | null;
}
