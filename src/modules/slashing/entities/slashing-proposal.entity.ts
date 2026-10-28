import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum SlashingProposalStatus {
  PROPOSED = 'proposed',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * A proposed stake reduction for a validator that signed a verdict later
 * overturned in a dispute. Nothing is taken until an operator approves it.
 */
@Entity('slashing_proposals')
@Unique('UQ_slashing_proposals_dispute_validator', ['disputeId', 'validatorId'])
export class SlashingProposal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_slashing_proposals_validatorId')
  @Column({ type: 'varchar' })
  validatorId!: string;

  @Index('IDX_slashing_proposals_disputeId')
  @Column({ type: 'varchar' })
  disputeId!: string;

  @Column({ type: 'varchar' })
  sessionId!: string;

  @Column({ type: 'varchar' })
  verdictId!: string;

  @Column({ type: 'text' })
  reason!: string;

  /** Validator stake, in wei, when the proposal was raised. */
  @Column({ type: 'numeric', precision: 78, scale: 0 })
  stakeAtProposal!: string;

  /** Amount to slash, in wei. */
  @Column({ type: 'numeric', precision: 78, scale: 0 })
  amount!: string;

  @Column({ type: 'varchar', length: 16, default: SlashingProposalStatus.PROPOSED })
  status!: SlashingProposalStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  decidedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  decisionNote!: string | null;
}
