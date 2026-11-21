import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxStatus } from '../enums/item-status.enum';
import { KafkaProducerService } from '../../modules/kafka/kafka-producer.service';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  /**
   * Appends an event to the transactional outbox table within the provided ACID transaction.
   */
  async recordEvent(
    manager: EntityManager,
    topic: string,
    eventName: string,
    partitionKey: string,
    payload: Record<string, any>,
  ): Promise<OutboxEvent> {
    const outboxRepo = manager.getRepository(OutboxEvent);
    const event = outboxRepo.create({
      topic,
      eventName,
      partitionKey,
      payload,
      status: OutboxStatus.PENDING,
    });
    return outboxRepo.save(event);
  }

  /**
   * Poller method to dispatch pending outbox events to Aiven Kafka.
   * Can be invoked immediately post-commit or run as a scheduled task.
   */
  async processPendingEvents(): Promise<number> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let processedCount = 0;
    try {
      // Lock pending events with SKIP LOCKED to allow horizontal worker scaling
      const pendingEvents = await queryRunner.manager
        .getRepository(OutboxEvent)
        .createQueryBuilder('event')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('event.status = :status', { status: OutboxStatus.PENDING })
        .andWhere('event.retry_count < 5')
        .orderBy('event.createdAt', 'ASC')
        .limit(50)
        .getMany();

      for (const event of pendingEvents) {
        try {
          await this.kafkaProducer.emit(
            event.topic,
            event.partitionKey,
            event.eventName,
            event.payload,
          );
          event.status = OutboxStatus.PUBLISHED;
          event.publishedAt = new Date();
          await queryRunner.manager.save(event);
          processedCount++;
        } catch (publishErr) {
          event.retryCount += 1;
          event.errorMessage = publishErr.message;
          if (event.retryCount >= 5) {
            event.status = OutboxStatus.FAILED;
          }
          await queryRunner.manager.save(event);
        }
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Outbox processor error: ${err.message}`);
    } finally {
      await queryRunner.release();
    }

    return processedCount;
  }
}
