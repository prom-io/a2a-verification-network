import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { StakingTier } from '../staking-tiers';

@Entity('validators')
export class Validator {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  address!: string;

  @Column({ type: 'varchar' })
  publicKey!: string;

  /** Stake in wei. uint256 needs 78 digits; values come back as strings. */
  @Column({ type: 'numeric', precision: 78, scale: 0, default: 0 })
  stake!: string;

  /** Derived from the stake on every write; see staking-tiers.ts. */
  @Column({ type: 'varchar', length: 16, default: StakingTier.NONE })
  tier!: StakingTier;

  @Column({ type: 'varchar' })
  endpoint!: string;

  @Column({ type: 'jsonb', default: [] })
  capabilities!: string[];

  /** False once the validator has exited or is suspended. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastHeartbeatAt!: Date | null;

  /** Set while the validator is suspended; cleared when it reports in again. */
  @Column({ type: 'timestamp', nullable: true })
  suspendedAt!: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  suspensionReason!: string | null;

  /** Set when the validator leaves for good; an exit is not undone by a heartbeat. */
  @Column({ type: 'timestamp', nullable: true })
  exitedAt!: Date | null;

  @CreateDateColumn()
  registeredAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
