import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UniqueItem } from '../../inventory/entities/unique-item.entity';

@Entity('stores')
export class Store {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  address: string;

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  longitude: number;

  @OneToMany(() => UniqueItem, (item) => item.store)
  inventory: UniqueItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
