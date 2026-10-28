import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum DisputeStatus {
  OPEN = 'open',
  ESCALATED = 'escalated',
  RESOLVED = 'resolved',
}

/** What a resolution means for the verdict the dispute was opened against. */
export enum DisputeOutcome {
  /** The verdict stands. */
  UPHELD = 'upheld',
  /** The verdict was wrong; its signers become subject to slashing. */
  OVERTURNED = 'overturned',
}

@Entity('disputes')
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_disputes_sessionId')
  @Column({ type: 'varchar' })
  sessionId!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'varchar' })
  initiator!: string;

  @Column({ type: 'enum', enum: DisputeStatus, default: DisputeStatus.OPEN })
  status!: DisputeStatus;

  @Column({ type: 'text', nullable: true })
  resolution!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  outcome!: DisputeOutcome | null;

  @CreateDateColumn()
  openedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt!: Date | null;
}
