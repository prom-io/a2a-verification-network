import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('validators')
export class Validator {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  address!: string;

  @Column({ type: 'varchar' })
  publicKey!: string;

  @Column({ type: 'decimal', precision: 36, scale: 18, default: 0 })
  stake!: string;

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
