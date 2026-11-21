import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import { Order } from './order.entity';
import { UniqueItem } from '../../inventory/entities/unique-item.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'unique_item_id', type: 'uuid', unique: true })
  uniqueItemId: string;

  @OneToOne(() => UniqueItem)
  @JoinColumn({ name: 'unique_item_id' })
  uniqueItem: UniqueItem;

  @Column({ name: 'serial_number', type: 'varchar', length: 120 })
  serialNumber: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
