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

  @Column({ type: 'varchar' })
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

  @UpdateDateColumn()
  lastUpdated!: Date;
}
