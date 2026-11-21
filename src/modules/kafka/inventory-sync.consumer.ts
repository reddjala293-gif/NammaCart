import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Kafka, Consumer } from 'kafkajs';
import { AivenConfigService } from '../../config/aiven.config';
import { OpenSearchSyncService } from '../search/opensearch-sync.service';
import { KAFKA_TOPICS } from './kafka.constants';

@Injectable()
export class InventorySyncConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventorySyncConsumer.name);
  private kafka: Kafka;
  private consumer: Consumer;
  private isRunning = false;

  constructor(
    private readonly aivenConfig: AivenConfigService,
    private readonly openSearchSync: OpenSearchSyncService,
  ) {
    const kafkaConfig = this.aivenConfig.getKafkaConfig();
    this.kafka = new Kafka(kafkaConfig);
    const groupId = process.env.AIVEN_KAFKA_GROUP_ID || 'retail-search-sync-group';
    this.consumer = this.kafka.consumer({ groupId });
  }

  async onModuleInit() {
    try {
      this.logger.log('Starting Aiven Kafka consumer for real-time inventory sync...');
      await this.consumer.connect();
      await this.consumer.subscribe({
        topic: KAFKA_TOPICS.INVENTORY_CHANGES,
        fromBeginning: false,
      });

      this.isRunning = true;
      await this.consumer.run({
        autoCommit: true,
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const rawValue = message.value?.toString();
            if (!rawValue) return;

            const parsed = JSON.parse(rawValue);
            const eventName = parsed.eventName || message.headers?.['x-event-name']?.toString();
            const data = parsed.data || parsed;

            this.logger.log(
              `[Kafka Consumer] Received on ${topic}[${partition}]: event=${eventName}, item=${data.item_id || data.uniqueItemId}, status=${data.status}`,
            );

            // Sync directly to OpenSearch
            await this.openSearchSync.processInventoryChange(data, eventName);
          } catch (err) {
            this.logger.error(`Error processing Kafka message: ${err.message}`, err.stack);
          }
        },
      });

      this.logger.log('Aiven Kafka inventory-sync consumer is active.');
    } catch (err) {
      this.logger.warn(`Could not start Kafka consumer on boot: ${err.message}.`);
    }
  }

  async onModuleDestroy() {
    if (this.isRunning) {
      await this.consumer.disconnect();
      this.logger.log('Kafka inventory consumer disconnected.');
    }
  }

  /**
   * Helper to process an event directly (used in tests or standalone processors)
   */
  async handleIncomingMessage(payload: any, eventName: string) {
    return this.openSearchSync.processInventoryChange(payload, eventName);
  }
}
