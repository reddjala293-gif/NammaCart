import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { UniqueItem } from './entities/unique-item.entity';
import { ItemStatus } from '../../common/enums/item-status.enum';
import { ScanItemDto, ScanAction } from './dto/scan-item.dto';
import { OutboxService } from '../../common/outbox/outbox.service';
import { KAFKA_TOPICS, KAFKA_EVENTS } from '../kafka/kafka.constants';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(UniqueItem)
    private readonly uniqueItemRepo: Repository<UniqueItem>,
    private readonly dataSource: DataSource,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Retrieves real-time serialized inventory count and serial numbers for a store and product.
   */
  async getStoreProductInventory(storeId: string, productId: string) {
    const items = await this.uniqueItemRepo.find({
      where: { storeId, productId },
      select: ['id', 'serialNumber', 'status', 'reservationExpiresAt'],
    });

    const now = new Date();
    const availableItems: { uniqueItemId: string; serialNumber: string }[] = [];
    let reservedCount = 0;
    let soldCount = 0;

    for (const item of items) {
      if (item.status === ItemStatus.AVAILABLE) {
        availableItems.push({ uniqueItemId: item.id, serialNumber: item.serialNumber });
      } else if (item.status === ItemStatus.RESERVED) {
        if (item.reservationExpiresAt && item.reservationExpiresAt < now) {
          availableItems.push({ uniqueItemId: item.id, serialNumber: item.serialNumber });
        } else {
          reservedCount++;
        }
      } else if (item.status === ItemStatus.SOLD) {
        soldCount++;
      }
    }

    return {
      storeId,
      productId,
      totalCount: items.length,
      availableCount: availableItems.length,
      reservedCount,
      soldCount,
      availableItems,
    };
  }

  async addUniqueItem(data: {
    productId: string;
    storeId: string;
    serialNumber: string;
    status?: ItemStatus;
  }): Promise<UniqueItem> {
    const item = this.uniqueItemRepo.create({
      ...data,
      status: data.status || ItemStatus.AVAILABLE,
    });
    return this.uniqueItemRepo.save(item);
  }

  /**
   * Physical In-Store Barcode / RFID Scanner Handler.
   * Directly synchronizes physical shelf & register activity with the online inventory engine.
   */
  async processStoreScan(dto: ScanItemDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const item = await queryRunner.manager
        .getRepository(UniqueItem)
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .where('item.serial_number = :serialNumber', { serialNumber: dto.serialNumber })
        .getOne();

      if (!item) {
        throw new NotFoundException(`Item with serial number '${dto.serialNumber}' not found in registry.`);
      }

      const now = new Date();
      const isReservedOnline =
        item.status === ItemStatus.RESERVED &&
        item.reservationExpiresAt &&
        item.reservationExpiresAt >= now;

      if (dto.action === ScanAction.SOLD_IN_STORE) {
        if (isReservedOnline) {
          throw new ConflictException(
            `ALERT: This physical item (#${item.serialNumber}) is currently locked in an active online checkout cart (User: ${item.reservedByUserId}). Do not sell at register without manager override.`,
          );
        }
        item.status = ItemStatus.SOLD;
        item.soldAt = now;

        await queryRunner.manager.save(item);

        await this.outboxService.recordEvent(
          queryRunner.manager,
          KAFKA_TOPICS.INVENTORY_CHANGES,
          KAFKA_EVENTS.ITEM_SOLD,
          item.storeId,
          {
            uniqueItemId: item.id,
            serialNumber: item.serialNumber,
            productId: item.productId,
            storeId: item.storeId,
            status: ItemStatus.SOLD,
            channel: 'IN_STORE_POS',
            terminalId: dto.terminalId,
            soldAt: now.toISOString(),
          },
        );
      } else if (dto.action === ScanAction.MARK_DAMAGED) {
        item.status = ItemStatus.DAMAGED;
        await queryRunner.manager.save(item);

        await this.outboxService.recordEvent(
          queryRunner.manager,
          KAFKA_TOPICS.INVENTORY_CHANGES,
          KAFKA_EVENTS.ITEM_SOLD, // Removing from available stock in OpenSearch
          item.storeId,
          {
            uniqueItemId: item.id,
            serialNumber: item.serialNumber,
            productId: item.productId,
            storeId: item.storeId,
            status: ItemStatus.DAMAGED,
            reason: 'DAMAGED_ON_SHELF',
          },
        );
      } else if (dto.action === ScanAction.RESTOCK) {
        item.status = ItemStatus.AVAILABLE;
        item.reservedByUserId = null;
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
            status: ItemStatus.AVAILABLE,
            reason: 'RESTOCKED_BY_STAFF',
          },
        );
      }

      await queryRunner.commitTransaction();

      return {
        success: true,
        serialNumber: item.serialNumber,
        newStatus: item.status,
        action: dto.action,
        timestamp: now.toISOString(),
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
