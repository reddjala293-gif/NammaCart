import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Store } from '../../stores/entities/store.entity';
import { OrderItem } from './order-item.entity';
import { OrderStatus, FulfillmentType } from '../../../common/enums/item-status.enum';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_number', type: 'varchar', length: 50, unique: true })
  orderNumber: string;

  @Column({ name: 'user_id', type: 'varchar', length: 100 })
  @Index()
  userId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.CONFIRMED,
  })
  status: OrderStatus;

  @Column({
    name: 'fulfillment_type',
    type: 'enum',
    enum: FulfillmentType,
    default: FulfillmentType.IN_STORE_PICKUP,
  })
  fulfillmentType: FulfillmentType;

  @Column({ name: 'total_amount', type: 'decimal', precision: 12, scale: 2 })
  totalAmount: number;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency: string;

  @Column({ name: 'payment_reference', type: 'varchar', length: 150, nullable: true })
  paymentReference?: string;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
