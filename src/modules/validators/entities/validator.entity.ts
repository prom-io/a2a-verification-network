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

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  registeredAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
