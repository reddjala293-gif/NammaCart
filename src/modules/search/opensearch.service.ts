import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { AivenConfigService } from '../../config/aiven.config';

@Injectable()
export class OpenSearchService implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchService.name);
  private client: Client;
  private readonly indexName = process.env.AIVEN_OPENSEARCH_INDEX || 'store_inventory';

  constructor(private readonly aivenConfig: AivenConfigService) {
    const config = this.aivenConfig.getOpenSearchConfig();
    this.client = new Client(config);
  }

  getClient(): Client {
    return this.client;
  }

  getIndexName(): string {
    return this.indexName;
  }

  async onModuleInit() {
    try {
      this.logger.log('Initializing Aiven OpenSearch client and index schema...');
      await this.ensureIndexSchema();
      this.logger.log(`Aiven OpenSearch index '${this.indexName}' verified successfully.`);
    } catch (err) {
      this.logger.warn(`Could not connect to OpenSearch cluster during boot: ${err.message}.`);
    }
  }

  /**
   * Ensures the store_inventory index exists with fuzzy text analyzers,
   * geo_point, store_id filtering, and status filtering.
   */
  async ensureIndexSchema() {
    const exists = await this.client.indices.exists({ index: this.indexName });
    if (!exists.body) {
      await this.client.indices.create({
        index: this.indexName,
        body: {
          settings: {
            number_of_shards: 3,
            number_of_replicas: 1,
            analysis: {
              analyzer: {
                product_search_analyzer: {
                  type: 'custom',
                  tokenizer: 'standard',
                  filter: ['lowercase', 'asciifolding'],
                },
              },
            },
          },
          mappings: {
            properties: {
              id: { type: 'keyword' },
              item_id: { type: 'keyword' },
              product_id: { type: 'keyword' },
              store_id: { type: 'keyword' },
              serial_number: { type: 'keyword' },
              title: {
                type: 'text',
                analyzer: 'product_search_analyzer',
                fields: {
                  raw: { type: 'keyword' },
                },
              },
              description: { type: 'text', analyzer: 'product_search_analyzer' },
              category: { type: 'keyword' },
              price: { type: 'double' },
              status: { type: 'keyword' },
              is_available: { type: 'boolean' },
              store_name: { type: 'text' },
              store_location: { type: 'geo_point' },
              updated_at: { type: 'date' },
            },
          },
        },
      });
      this.logger.log(`Created OpenSearch index '${this.indexName}' with smart fuzzy & store_id mappings.`);
    }
  }
}
