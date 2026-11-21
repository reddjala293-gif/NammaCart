import { Injectable, Logger } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';

export interface InventoryChangeEventPayload {
  item_id?: string;
  itemId?: string;
  product_id?: string;
  productId?: string;
  store_id?: string;
  storeId?: string;
  serial_number?: string;
  serialNumber?: string;
  status: string;
  title?: string;
  description?: string;
  category?: string;
  price?: number;
  store_name?: string;
  storeName?: string;
  lat?: number;
  lon?: number;
  updated_at?: string;
}

@Injectable()
export class OpenSearchSyncService {
  private readonly logger = new Logger(OpenSearchSyncService.name);

  constructor(private readonly openSearchService: OpenSearchService) {}

  /**
   * Dispatches incoming inventory.changes event to OpenSearch:
   * - If AVAILABLE: Indexes / upserts into OpenSearch store_inventory index.
   * - If RESERVED or SOLD: Removes from the search index (or marks hidden).
   */
  async processInventoryChange(payload: InventoryChangeEventPayload, eventName?: string) {
    const itemId = payload.item_id || payload.itemId;
    const productId = payload.product_id || payload.productId;
    const storeId = payload.store_id || payload.storeId;
    const serialNumber = payload.serial_number || payload.serialNumber;
    const status = payload.status;

    if (!itemId) {
      this.logger.warn(`Received inventory change event without valid item_id: ${JSON.stringify(payload)}`);
      return;
    }

    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getIndexName();

    if (status === 'AVAILABLE' || eventName === 'item.available' || eventName === 'item.released') {
      // 1. Index / Upsert document into OpenSearch
      const doc = {
        id: itemId,
        item_id: itemId,
        product_id: productId,
        store_id: storeId,
        serial_number: serialNumber,
        title: payload.title || 'Serialized Product',
        description: payload.description || '',
        category: payload.category || 'General',
        price: payload.price || 0,
        status: 'AVAILABLE',
        is_available: true,
        store_name: payload.store_name || payload.storeName || 'Store Mini-Warehouse',
        store_location:
          payload.lat !== undefined && payload.lon !== undefined
            ? { lat: payload.lat, lon: payload.lon }
            : undefined,
        updated_at: payload.updated_at || new Date().toISOString(),
      };

      try {
        await client.index({
          index,
          id: itemId,
          body: doc,
          refresh: true, // Immediate refresh for search consistency in testing/demo
        });
        this.logger.log(
          `[OpenSearch Synced] Item '${itemId}' (#${serialNumber}) indexed as AVAILABLE in store '${storeId}'.`,
        );
      } catch (err) {
        this.logger.error(`Failed to index item in OpenSearch: ${err.message}`, err.stack);
        throw err;
      }
    } else if (status === 'RESERVED' || status === 'SOLD' || status === 'DAMAGED' || eventName === 'item.reserved' || eventName === 'item.sold') {
      // 2. Remove from search index (or mark hidden)
      try {
        await client.delete({
          index,
          id: itemId,
          refresh: true,
        });
        this.logger.log(
          `[OpenSearch Synced] Item '${itemId}' (#${serialNumber}) status is ${status} -> REMOVED from search index.`,
        );
      } catch (err) {
        if (err.statusCode === 404 || err.meta?.statusCode === 404) {
          // Already not in index
          this.logger.debug(`Item '${itemId}' was already absent from OpenSearch index.`);
        } else {
          this.logger.error(`Failed to remove item from OpenSearch: ${err.message}`, err.stack);
        }
      }
    }
  }
}
