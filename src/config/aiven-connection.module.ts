import { Global, Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { Kafka } from 'kafkajs';
import { DataSource } from 'typeorm';
import { AivenConfigService } from './aiven.config';

export const AIVEN_KAFKA_PROVIDER = 'AIVEN_KAFKA_PROVIDER';
export const AIVEN_OPENSEARCH_PROVIDER = 'AIVEN_OPENSEARCH_PROVIDER';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),
  ],
  providers: [
    AivenConfigService,
    // Centralized Aiven Kafka Client Factory
    {
      provide: AIVEN_KAFKA_PROVIDER,
      useFactory: (aivenConfig: AivenConfigService) => {
        const config = aivenConfig.getKafkaConfig();
        return new Kafka(config);
      },
      inject: [AivenConfigService],
    },
    // Centralized Aiven OpenSearch Client Factory
    {
      provide: AIVEN_OPENSEARCH_PROVIDER,
      useFactory: (aivenConfig: AivenConfigService) => {
        const config = aivenConfig.getOpenSearchConfig();
        return new OpenSearchClient(config);
      },
      inject: [AivenConfigService],
    },
  ],
  exports: [
    AivenConfigService,
    AIVEN_KAFKA_PROVIDER,
    AIVEN_OPENSEARCH_PROVIDER,
    ConfigModule,
  ],
})
export class AivenConnectionModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AivenConnectionModule.name);

  constructor(
    private readonly aivenConfig: AivenConfigService,
    private readonly dataSource?: DataSource,
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Initializing Centralized Aiven Services Connection Module...');
    
    // Verify CA Certificate
    const caCert = this.aivenConfig.readCertFile();
    if (caCert) {
      this.logger.log(`Aiven CA Certificate loaded successfully (${caCert.length} bytes).`);
    } else {
      this.logger.warn('Aiven CA Certificate not found at configured path.');
    }

    // Diagnostic summary
    const pgUrl = process.env.AIVEN_PG_URL ? 'CONFIGURED' : 'MISSING';
    const kafkaBrokers = process.env.AIVEN_KAFKA_BROKERS ? 'CONFIGURED' : 'MISSING';
    const osUri = process.env.AIVEN_OPENSEARCH_URI ? 'CONFIGURED' : 'MISSING';

    this.logger.log(`Aiven Service Status: PostgreSQL=[${pgUrl}], Kafka=[${kafkaBrokers}], OpenSearch=[${osUri}]`);
  }
}
