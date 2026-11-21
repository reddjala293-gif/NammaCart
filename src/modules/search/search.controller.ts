import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Smart Search with Real-Time Store Availability & Geo-Distance Filter',
    description: 'Queries Aiven OpenSearch with fuzzy search, geo-distance filter, and strictly available inventory filter.',
  })
  @ApiResponse({ status: 200, description: 'Matched available catalog items at mini-warehouses.' })
  @ApiResponse({ status: 400, description: 'Invalid query filters.' })
  async searchCatalog(@Query() query: SearchQueryDto) {
    return this.searchService.search(query);
  }
}
