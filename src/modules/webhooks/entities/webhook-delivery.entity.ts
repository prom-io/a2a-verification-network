import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum WebhookEvent {
  VERDICT_PUBLISHED = 'verdict.published',
  JOB_FAILED = 'job.failed',
}

export enum WebhookDeliveryStatus {
  /** Not delivered yet; retried at nextAttemptAt. */
  PENDING = 'pending',
  DELIVERED = 'delivered',
  /** Gave up after the maximum number of attempts. */
  FAILED = 'failed',
}

/** One notification owed to a job submitter, with its delivery history. */
@Entity('webhook_deliveries')
@Index('IDX_webhook_deliveries_due', ['status', 'nextAttemptAt'])
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_webhook_deliveries_jobId')
  @Column({ type: 'varchar' })
  jobId!: string;

  @Column({ type: 'varchar' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 1024 })
  url!: string;

  @Column({ type: 'varchar', length: 32 })
  event!: WebhookEvent;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16, default: WebhookDeliveryStatus.PENDING })
  status!: WebhookDeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'int', nullable: true })
  lastStatusCode!: number | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  nextAttemptAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt!: Date | null;
}
