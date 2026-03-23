import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum DisputeStatus {
  OPEN = 'open',
  ESCALATED = 'escalated',
  RESOLVED = 'resolved',
}

@Entity('disputes')
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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

  @CreateDateColumn()
  openedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt!: Date | null;
}
