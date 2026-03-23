import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum VerdictOutcome {
  ACCEPT = 'accept',
  PARTIAL = 'partial',
  REJECT = 'reject',
}

@Entity('verdicts')
export class Verdict {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  sessionId!: string;

  @Column({ type: 'varchar' })
  jobId!: string;

  @Column({ type: 'enum', enum: VerdictOutcome })
  outcome!: VerdictOutcome;

  @Column({ type: 'decimal', precision: 36, scale: 18, default: 0 })
  payableAmount!: string;

  @Column({ type: 'varchar' })
  metaHash!: string;

  @Column({ type: 'jsonb', default: [] })
  signatures!: string[];

  @CreateDateColumn()
  publishedAt!: Date;
}
