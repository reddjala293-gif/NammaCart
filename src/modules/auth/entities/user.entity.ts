import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  STORE_ASSOCIATE = 'STORE_ASSOCIATE',
  STORE_MANAGER = 'STORE_MANAGER',
  ADMIN = 'ADMIN',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  @Index()
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.CUSTOMER,
  })
  role: UserRole;

  @Column({ name: 'assigned_store_id', type: 'uuid', nullable: true })
  assignedStoreId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
