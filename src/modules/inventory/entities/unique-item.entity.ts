import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  VersionColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { Store } from '../../stores/entities/store.entity';
import { ItemStatus } from '../../../common/enums/item-status.enum';

@Entity('unique_items')
@Index(['productId', 'storeId', 'status'])
@Index(['status', 'reservationExpiresAt'])
export class UniqueItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, (product) => product.physicalUnits, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @ManyToOne(() => Store, (store) => store.inventory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ name: 'serial_number', type: 'varchar', length: 120, unique: true })
  serialNumber: string;

  @Column({
    type: 'enum',
    enum: ItemStatus,
    default: ItemStatus.AVAILABLE,
  })
  status: ItemStatus;

  @Column({ name: 'reserved_by_user_id', type: 'varchar', length: 100, nullable: true })
  reservedByUserId?: string;

  @Column({ name: 'reserved_at', type: 'timestamp with time zone', nullable: true })
  reservedAt?: Date;

  @Column({ name: 'reservation_expires_at', type: 'timestamp with time zone', nullable: true })
  reservationExpiresAt?: Date;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string;

  @Column({ name: 'sold_at', type: 'timestamp with time zone', nullable: true })
  soldAt?: Date;

  @VersionColumn({ default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
