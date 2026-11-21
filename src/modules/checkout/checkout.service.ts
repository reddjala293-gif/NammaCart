import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ReserveItemDto } from './dto/reserve-item.dto';
import { ReleaseItemDto } from './dto/release-item.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { InventoryRepository } from '../inventory/inventory.repository';
import { OutboxService } from '../../common/outbox/outbox.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { KAFKA_TOPICS, KAFKA_EVENTS } from '../kafka/kafka.constants';
import {
  ItemUnavailableException,
  ReservationExpiredException,
  ReservationNotFoundException,
  PaymentFailedException,
} from '../../common/exceptions/retail.exceptions';
import { ItemStatus, OrderStatus } from '../../common/enums/item-status.enum';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly inventoryRepo: InventoryRepository,
    private readonly outboxService: OutboxService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  /**
   * Pessimistically locks and reserves a UniqueItem using PostgreSQL row-level locks,
   * then emits an event to the inventory.changes Kafka topic.
   */
  async reserveItem(dto: ReserveItemDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const ttlSeconds = dto.ttlSeconds || 600; // Default: 10 minutes (600s)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const reservationId = uuidv4();

    try {
      let targetItem = null;

      if (dto.uniqueItemId) {
        // Shopper targeting a specific unique serialized unit (e.g. from search hit)
        targetItem = await this.inventoryRepo.lockSpecificItemForReservation(
          queryRunner.manager,
          dto.uniqueItemId,
          dto.storeId,
        );

        if (!targetItem) {
          throw new NotFoundException(`Unique physical item '${dto.uniqueItemId}' was not found.`);
        }

        // Strict state checking under row lock
        if (targetItem.status === ItemStatus.SOLD) {
          throw new ItemUnavailableException(
            `Physical item #${targetItem.serialNumber} has already been SOLD.`,
          );
        }

        if (targetItem.status === ItemStatus.DAMAGED) {
          throw new ItemUnavailableException(
            `Physical item #${targetItem.serialNumber} is marked DAMAGED and unavailable for sale.`,
          );
        }

        if (
          targetItem.status === ItemStatus.RESERVED &&
          targetItem.reservationExpiresAt &&
          targetItem.reservationExpiresAt > now
        ) {
          throw new ItemUnavailableException(
            `Physical item #${targetItem.serialNumber} is currently RESERVED by another shopper.`,
          );
        }
      } else if (dto.productId) {
        // Dynamic Allocation: lock next available unit of SKU at this store using SKIP LOCKED
        targetItem = await this.inventoryRepo.lockNextAvailableItemForReservation(
          queryRunner.manager,
          dto.productId,
          dto.storeId,
        );

        if (!targetItem) {
          throw new ItemUnavailableException(
            `No available physical units of this product are in stock at store '${dto.storeId}'.`,
          );
        }
      } else {
        throw new ItemUnavailableException('Either uniqueItemId or productId must be provided.');
      }

      // Transition item to RESERVED
      targetItem.status = ItemStatus.RESERVED;
      targetItem.reservedByUserId = dto.userId;
      targetItem.reservedAt = now;
      targetItem.reservationExpiresAt = expiresAt;

      await queryRunner.manager.save(targetItem);

      // Event payload with item_id, product_id, store_id, and new status
      const eventPayload = {
        item_id: targetItem.id,
        product_id: targetItem.productId,
        store_id: targetItem.storeId,
        serial_number: targetItem.serialNumber,
        status: ItemStatus.RESERVED,
        reservation_id: reservationId,
        user_id: dto.userId,
        expires_at: expiresAt.toISOString(),
        // Also provide camelCase fields
        itemId: targetItem.id,
        productId: targetItem.productId,
        storeId: targetItem.storeId,
      };

      // Record outbox event within the SAME ACID transaction boundary
      await this.outboxService.recordEvent(
        queryRunner.manager,
        KAFKA_TOPICS.INVENTORY_CHANGES,
        KAFKA_EVENTS.ITEM_RESERVED,
        targetItem.storeId,
        eventPayload,
      );

      await queryRunner.commitTransaction();

      // Emit directly to Kafka topic inventory.changes
      try {
        await this.kafkaProducer.emit(
          KAFKA_TOPICS.INVENTORY_CHANGES,
          targetItem.storeId,
          KAFKA_EVENTS.ITEM_RESERVED,
          eventPayload,
        );
      } catch (kafkaErr) {
        this.logger.warn(`Immediate Kafka publish failed; outbox worker will retry: ${kafkaErr.message}`);
      }

      return {
        reservationId,
        uniqueItemId: targetItem.id,
        serialNumber: targetItem.serialNumber,
        productId: targetItem.productId,
        storeId: targetItem.storeId,
        status: ItemStatus.RESERVED,
        reservedAt: targetItem.reservedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();

      if (err.code === '55P03' || err instanceof ItemUnavailableException) {
        throw new ItemUnavailableException(
          `409 Conflict: Physical unit is currently locked or reserved by another shopper.`,
        );
      }
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Releases an active reservation back to AVAILABLE status and emits item.released.
   */
  async releaseItem(dto: ReleaseItemDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const item = await queryRunner.manager
        .getRepository('unique_items')
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .where('item.id = :id', { id: dto.uniqueItemId })
        .andWhere('item.status = :status', { status: ItemStatus.RESERVED })
        .andWhere('item.reserved_by_user_id = :userId', { userId: dto.userId })
        .getOne();

      if (!item) {
        throw new ReservationNotFoundException('Active reservation not found for this item and user.');
      }

      item.status = ItemStatus.AVAILABLE;
      item.reservedByUserId = null;
      item.reservedAt = null;
      item.reservationExpiresAt = null;

      await queryRunner.manager.save(item);

      const eventPayload = {
        item_id: item.id,
        product_id: item.productId,
        store_id: item.storeId,
        serial_number: item.serialNumber,
        status: ItemStatus.AVAILABLE,
        user_id: dto.userId,
        released_at: new Date().toISOString(),
        itemId: item.id,
        productId: item.productId,
        storeId: item.storeId,
      };

      await this.outboxService.recordEvent(
        queryRunner.manager,
        KAFKA_TOPICS.INVENTORY_CHANGES,
        KAFKA_EVENTS.ITEM_RELEASED,
        item.storeId,
        eventPayload,
      );

      await queryRunner.commitTransaction();

      // Emit to Kafka topic inventory.changes
      try {
        await this.kafkaProducer.emit(
          KAFKA_TOPICS.INVENTORY_CHANGES,
          item.storeId,
          KAFKA_EVENTS.ITEM_RELEASED,
          eventPayload,
        );
      } catch (kafkaErr) {
        this.logger.warn(`Immediate Kafka publish failed; outbox worker will retry: ${kafkaErr.message}`);
      }

      return {
        success: true,
        message: 'Item successfully returned to AVAILABLE inventory.',
        uniqueItemId: item.id,
        status: ItemStatus.AVAILABLE,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Completes checkout, verifies reservation ownership, charges payment,
   * transitions unit to SOLD, and emits item.sold to Kafka inventory.changes.
   */
  async checkout(dto: CheckoutDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const item = await this.inventoryRepo.lockReservedItemForCheckout(
        queryRunner.manager,
        dto.uniqueItemId,
        dto.userId,
      );

      if (!item) {
        throw new ReservationExpiredException(
          'Reservation for this physical item has expired or does not belong to the user.',
        );
      }

      if (dto.paymentToken.includes('fail')) {
        throw new PaymentFailedException('Payment transaction rejected by payment provider.');
      }

      item.status = ItemStatus.SOLD;
      item.soldAt = new Date();

      const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
      const order = queryRunner.manager.create(Order, {
        orderNumber,
        userId: dto.userId,
        storeId: item.storeId,
        status: OrderStatus.CONFIRMED,
        fulfillmentType: dto.fulfillmentType,
        totalAmount: dto.amount,
        currency: dto.currency || 'USD',
        paymentReference: dto.paymentToken,
      });

      const savedOrder = await queryRunner.manager.save(order);

      const orderItem = queryRunner.manager.create(OrderItem, {
        orderId: savedOrder.id,
        productId: item.productId,
        uniqueItemId: item.id,
        serialNumber: item.serialNumber,
        price: dto.amount,
      });

      await queryRunner.manager.save(orderItem);

      item.orderId = savedOrder.id;
      await queryRunner.manager.save(item);

      const eventPayload = {
        item_id: item.id,
        product_id: item.productId,
        store_id: item.storeId,
        serial_number: item.serialNumber,
        status: ItemStatus.SOLD,
        order_id: savedOrder.id,
        order_number: orderNumber,
        sold_at: item.soldAt.toISOString(),
        itemId: item.id,
        productId: item.productId,
        storeId: item.storeId,
      };

      await this.outboxService.recordEvent(
        queryRunner.manager,
        KAFKA_TOPICS.INVENTORY_CHANGES,
        KAFKA_EVENTS.ITEM_SOLD,
        item.storeId,
        eventPayload,
      );

      await queryRunner.commitTransaction();

      // Emit to Kafka topic inventory.changes
      try {
        await this.kafkaProducer.emit(
          KAFKA_TOPICS.INVENTORY_CHANGES,
          item.storeId,
          KAFKA_EVENTS.ITEM_SOLD,
          eventPayload,
        );
      } catch (kafkaErr) {
        this.logger.warn(`Immediate Kafka publish failed; outbox worker will retry: ${kafkaErr.message}`);
      }

      return {
        orderId: savedOrder.id,
        orderNumber,
        status: savedOrder.status,
        uniqueItemId: item.id,
        serialNumber: item.serialNumber,
        storeId: item.storeId,
        totalAmount: savedOrder.totalAmount,
        currency: savedOrder.currency,
        createdAt: savedOrder.createdAt?.toISOString() || new Date().toISOString(),
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
