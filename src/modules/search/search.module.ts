import { Module } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service';
import { OpenSearchSyncService } from './opensearch-sync.service';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

@Module({
  controllers: [SearchController],
  providers: [OpenSearchService, OpenSearchSyncService, SearchService],
  exports: [OpenSearchService, OpenSearchSyncService, SearchService],
})
export class SearchModule {}
