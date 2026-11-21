import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Kafka, Producer, RecordMetadata } from 'kafkajs';
import { AivenConfigService } from '../../config/aiven.config';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private kafka: Kafka;
  private producer: Producer;
  private isConnected = false;

  constructor(private readonly aivenConfig: AivenConfigService) {
    const kafkaConfig = this.aivenConfig.getKafkaConfig();
    this.kafka = new Kafka(kafkaConfig);
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });
  }

  async onModuleInit() {
    try {
      this.logger.log('Connecting to Aiven Kafka cluster via mTLS/SSL...');
      await this.producer.connect();
      this.isConnected = true;
      this.logger.log('Successfully connected to Aiven Kafka producer.');
    } catch (err) {
      this.logger.error(`Failed to connect to Aiven Kafka: ${err.message}. Retrying via background worker.`);
    }
  }

  async onModuleDestroy() {
    if (this.isConnected) {
      await this.producer.disconnect();
      this.logger.log('Aiven Kafka producer disconnected.');
    }
  }

  /**
   * Publishes a message to an Aiven Kafka topic.
   * Guarantees partition ordering by key (e.g. store_id or product_id).
   */
  async emit(
    topic: string,
    key: string,
    eventName: string,
    payload: Record<string, any>,
  ): Promise<RecordMetadata[]> {
    if (!this.isConnected) {
      this.logger.warn(`Kafka producer not yet connected. Queued for Outbox poller.`);
      throw new Error('Kafka producer not connected');
    }

    const message = {
      key,
      value: JSON.stringify({
        eventName,
        data: payload,
        timestamp: new Date().toISOString(),
      }),
      headers: {
        'x-event-name': eventName,
        'x-source': 'retail-checkout-service',
      },
    };

    return this.producer.send({
      topic,
      messages: [message],
    });
  }
}
