import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum VerificationClass {
  CLASS_0 = 'class_0',
  CLASS_1 = 'class_1',
  CLASS_2 = 'class_2',
  CLASS_3 = 'class_3',
  CLASS_4 = 'class_4',
}

@Entity('verification_policies')
export class VerificationPolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({
    type: 'enum',
    enum: VerificationClass,
  })
  verificationClass!: VerificationClass;

  @Column({ type: 'jsonb', default: {} })
  selectionRule!: Record<string, unknown>;

  @Column({ type: 'varchar' })
  verificationMethod!: string;

  @Column({ type: 'int' })
  quorumThreshold!: number;

  @Column({ type: 'decimal', precision: 36, scale: 18, default: 0 })
  price!: string;

  @Column({ type: 'jsonb', default: {} })
  disputeEscalation!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  evidenceRequirements!: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true })
  metadataUri!: string | null;

  @Column({ type: 'varchar', nullable: true })
  metadataHash!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
