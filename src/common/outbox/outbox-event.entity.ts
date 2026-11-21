import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { OutboxStatus } from '../enums/item-status.enum';

@Entity('outbox_events')
@Index(['status', 'createdAt'])
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  topic: string;

  @Column({ name: 'event_name', type: 'varchar', length: 100 })
  eventName: string;

  @Column({ name: 'partition_key', type: 'varchar', length: 150 })
  partitionKey: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({
    type: 'enum',
    enum: OutboxStatus,
    default: OutboxStatus.PENDING,
  })
  status: OutboxStatus;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'published_at', type: 'timestamp with time zone', nullable: true })
  publishedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
