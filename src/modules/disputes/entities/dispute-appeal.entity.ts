import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { AppealDecision, AppealVoteChoice } from '../appeal-quorum';
import { DisputeOutcome } from './dispute.entity';

export enum AppealStatus {
  OPEN = 'open',
  DECIDED = 'decided',
}

/** The single appeal round a resolved dispute can go through. */
@Entity('dispute_appeals')
@Unique('UQ_dispute_appeals_disputeId', ['disputeId'])
export class DisputeAppeal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  disputeId!: string;

  @Column({ type: 'varchar', length: 256 })
  appellant!: string;

  @Column({ type: 'text' })
  reason!: string;

  /** Outcome of the resolution under appeal. */
  @Column({ type: 'varchar', length: 16 })
  originalOutcome!: DisputeOutcome;

  /** Validators drawn to decide the appeal; none of them signed the verdict. */
  @Column({ type: 'jsonb', default: [] })
  panel!: string[];

  /** Overturn votes needed to reverse the resolution. */
  @Column({ type: 'int' })
  quorum!: number;

  @Column({ type: 'varchar', length: 16, default: AppealStatus.OPEN })
  status!: AppealStatus;

  @Column({ type: 'varchar', length: 16, nullable: true })
  decision!: AppealDecision | null;

  @CreateDateColumn()
  openedAt!: Date;

  @Column({ type: 'timestamp' })
  votingDeadline!: Date;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt!: Date | null;
}

@Entity('dispute_appeal_votes')
@Unique('UQ_dispute_appeal_votes_appeal_validator', ['appealId', 'validatorId'])
export class DisputeAppealVote {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_dispute_appeal_votes_appealId')
  @Column({ type: 'varchar' })
  appealId!: string;

  @Column({ type: 'varchar' })
  validatorId!: string;

  @Column({ type: 'varchar', length: 16 })
  vote!: AppealVoteChoice;

  @CreateDateColumn()
  castAt!: Date;
}
