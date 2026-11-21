import { Injectable, Logger } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { SearchQueryDto } from './dto/search-query.dto';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly openSearchService: OpenSearchService) {}

  /**
   * Queries Aiven OpenSearch (NOT PostgreSQL) with:
   * - Smart fuzzy text matching across title, description, and category
   * - Strict store_id filtering
   * - Strict status = AVAILABLE filtering
   * - Dynamic sorting and pagination
   */
  async search(queryDto: SearchQueryDto) {
    const client = this.openSearchService.getClient();
    const index = this.openSearchService.getIndexName();

    const mustClauses: any[] = [];
    const filterClauses: any[] = [];

    // 1. Fuzzy Text Query
    if (queryDto.q && queryDto.q.trim().length > 0) {
      mustClauses.push({
        multi_match: {
          query: queryDto.q.trim(),
          fields: ['title^3', 'description', 'category^1.5'],
          fuzziness: 'AUTO',
          prefix_length: 2,
        },
      });
    } else {
      mustClauses.push({ match_all: {} });
    }

    // 2. Strict Availability Filter: OpenSearch must ONLY return AVAILABLE items
    filterClauses.push({
      bool: {
        should: [
          { term: { status: 'AVAILABLE' } },
          { term: { is_available: true } },
        ],
        minimum_should_match: 1,
      },
    });

    // 3. Store ID filter (if shopper selected a specific mini-warehouse)
    if (queryDto.storeId) {
      filterClauses.push({
        bool: {
          should: [
            { term: { store_id: queryDto.storeId } },
            { term: { storeId: queryDto.storeId } },
          ],
          minimum_should_match: 1,
        },
      });
    }

    // 4. Category filter
    if (queryDto.category) {
      filterClauses.push({
        term: { category: queryDto.category },
      });
    }

    // 5. Geo-distance filter (if shopper GPS coordinates are provided)
    if (queryDto.lat !== undefined && queryDto.lon !== undefined) {
      const radiusKm = queryDto.radiusKm || 25;
      filterClauses.push({
        geo_distance: {
          distance: `${radiusKm}km`,
          store_location: {
            lat: queryDto.lat,
            lon: queryDto.lon,
          },
        },
      });
    }

    // Sorting clauses: by proximity if lat/lon provided, else by score / relevance
    const sortClauses: any[] = [];
    if (queryDto.lat !== undefined && queryDto.lon !== undefined) {
      sortClauses.push({
        _geo_distance: {
          store_location: {
            lat: queryDto.lat,
            lon: queryDto.lon,
          },
          order: 'asc',
          unit: 'km',
          mode: 'min',
          distance_type: 'arc',
        },
      });
    }
    sortClauses.push({ _score: { order: 'desc' } });

    const page = queryDto.page || 1;
    const limit = queryDto.limit || 20;
    const from = (page - 1) * limit;

    try {
      this.logger.debug(
        `Executing OpenSearch query on index '${index}': q="${queryDto.q || '*'}", storeId="${queryDto.storeId || 'ALL'}"`,
      );

      const result = await client.search({
        index,
        body: {
          from,
          size: limit,
          query: {
            bool: {
              must: mustClauses,
              filter: filterClauses,
            },
          },
          sort: sortClauses,
        },
      });

      const totalHits =
        typeof result.body.hits.total === 'number'
          ? result.body.hits.total
          : result.body.hits.total?.value || 0;

      const hits = result.body.hits.hits.map((hit: any) => {
        const source = hit._source;
        const sortValues = hit.sort;
        let distanceKm = null;
        if (queryDto.lat !== undefined && queryDto.lon !== undefined && sortValues?.length > 0) {
          distanceKm = Math.round(Number(sortValues[0]) * 100) / 100;
        }

        return {
          id: hit._id,
          itemId: source.item_id || source.id,
          productId: source.product_id || source.productId,
          storeId: source.store_id || source.storeId,
          serialNumber: source.serial_number || source.serialNumber,
          title: source.title,
          description: source.description,
          category: source.category,
          price: source.price,
          status: source.status,
          storeName: source.store_name || source.storeName,
          distanceKm,
        };
      });

      return {
        total: totalHits,
        page,
        limit,
        hits,
      };
    } catch (err) {
      this.logger.error(`OpenSearch search query failed: ${err.message}`, err.stack);
      throw err;
    }
  }
}
