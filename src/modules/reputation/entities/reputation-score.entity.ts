import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

export enum EntityType {
  VALIDATOR = 'validator',
  AGENT = 'agent',
}

@Entity('reputation_scores')
export class ReputationScore {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  entityId!: string;

  @Column({ type: 'enum', enum: EntityType })
  entityType!: EntityType;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 1.0 })
  accuracy!: string;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 1.0 })
  uptime!: string;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0.0 })
  disputeLossRate!: string;

  @Column({ type: 'int', default: 0 })
  totalJobs!: number;

  /**
   * How much evidence the averages above rest on: one per observation,
   * discounted by the reputation half-life as it ages.
   */
  @Column({ type: 'numeric', precision: 14, scale: 6, default: 0 })
  evidenceWeight!: string;

  /** Last observation; the reference point for time decay. */
  @Column({ type: 'timestamp', nullable: true })
  lastActivityAt!: Date | null;

  @UpdateDateColumn()
  lastUpdated!: Date;
}
