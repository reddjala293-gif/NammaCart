import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UniqueItem } from './entities/unique-item.entity';
import { ItemStatus } from '../../common/enums/item-status.enum';

@Injectable()
export class InventoryRepository {
  private readonly logger = new Logger(InventoryRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Pessimistically locks a specific unique physical item row using:
   * SELECT ... FOR UPDATE NOWAIT
   * 
   * - If another transaction is in-flight on this row, PostgreSQL raises 55P03 (lock_not_available) immediately.
   * - Locks the exact row until transaction COMMIT or ROLLBACK.
   */
  async lockSpecificItemForReservation(
    manager: EntityManager,
    uniqueItemId: string,
    storeId?: string,
  ): Promise<UniqueItem | null> {
    const qb = manager
      .getRepository(UniqueItem)
      .createQueryBuilder('item')
      .setLock('pessimistic_write')
      .setOnLocked('nowait') // PostgreSQL: SELECT ... FOR UPDATE NOWAIT
      .where('item.id = :id', { id: uniqueItemId });

    if (storeId) {
      qb.andWhere('item.store_id = :storeId', { storeId });
    }

    return qb.getOne();
  }

  /**
   * Dynamic Allocation Alternative:
   * Locks the first available physical unit of a product at a store using:
   * SELECT ... FOR UPDATE SKIP LOCKED
   */
  async lockNextAvailableItemForReservation(
    manager: EntityManager,
    productId: string,
    storeId: string,
  ): Promise<UniqueItem | null> {
    const qb = manager
      .getRepository(UniqueItem)
      .createQueryBuilder('item')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked') // PostgreSQL: SELECT ... FOR UPDATE SKIP LOCKED
      .where('item.product_id = :productId', { productId })
      .andWhere('item.store_id = :storeId', { storeId })
      .andWhere(
        '(item.status = :availableStatus OR (item.status = :reservedStatus AND item.reservation_expires_at < :now))',
        {
          availableStatus: ItemStatus.AVAILABLE,
          reservedStatus: ItemStatus.RESERVED,
          now: new Date(),
        },
      )
      .limit(1);

    return qb.getOne();
  }

  /**
   * Locks an already RESERVED item during checkout to commit it to SOLD.
   * Enforces:
   * 1. Status must be RESERVED
   * 2. Must belong to the claiming userId
   * 3. TTL must not have expired
   */
  async lockReservedItemForCheckout(
    manager: EntityManager,
    uniqueItemId: string,
    userId: string,
  ): Promise<UniqueItem | null> {
    const qb = manager
      .getRepository(UniqueItem)
      .createQueryBuilder('item')
      .setLock('pessimistic_write') // SELECT ... FOR UPDATE
      .where('item.id = :id', { id: uniqueItemId })
      .andWhere('item.status = :status', { status: ItemStatus.RESERVED })
      .andWhere('item.reserved_by_user_id = :userId', { userId })
      .andWhere('item.reservation_expires_at >= :now', { now: new Date() });

    return qb.getOne();
  }
}
