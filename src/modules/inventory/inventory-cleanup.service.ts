import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { UniqueItem } from './entities/unique-item.entity';
import { ItemStatus } from '../../common/enums/item-status.enum';
import { OutboxService } from '../../common/outbox/outbox.service';
import { KAFKA_TOPICS, KAFKA_EVENTS } from '../kafka/kafka.constants';

@Injectable()
export class InventoryCleanupService {
  private readonly logger = new Logger(InventoryCleanupService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Periodically scans for expired reservations and automatically returns physical items to stock.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async releaseExpiredReservations() {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const now = new Date();

      // Find expired reserved items with row-level lock
      const expiredItems = await queryRunner.manager
        .getRepository(UniqueItem)
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('item.status = :status', { status: ItemStatus.RESERVED })
        .andWhere('item.reservation_expires_at < :now', { now })
        .limit(100)
        .getMany();

      if (expiredItems.length > 0) {
        this.logger.log(`Found ${expiredItems.length} expired reservations to auto-release.`);

        for (const item of expiredItems) {
          const prevUser = item.reservedByUserId;
          item.status = ItemStatus.AVAILABLE;
          item.reservedByUserId = null;
          item.reservedAt = null;
          item.reservationExpiresAt = null;

          await queryRunner.manager.save(item);

          await this.outboxService.recordEvent(
            queryRunner.manager,
            KAFKA_TOPICS.INVENTORY_CHANGES,
            KAFKA_EVENTS.ITEM_RELEASED,
            item.storeId,
            {
              uniqueItemId: item.id,
              serialNumber: item.serialNumber,
              productId: item.productId,
              storeId: item.storeId,
              previousUserId: prevUser,
              reason: 'TTL_EXPIRED',
              releasedAt: new Date().toISOString(),
            },
          );
        }

        await queryRunner.commitTransaction();
        this.logger.log(`Successfully released ${expiredItems.length} expired reservations.`);
      } else {
        await queryRunner.commitTransaction();
      }
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Error during expired reservation cleanup: ${err.message}`);
    } finally {
      await queryRunner.release();
    }
  }
}
