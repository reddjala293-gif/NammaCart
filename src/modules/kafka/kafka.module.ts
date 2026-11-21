import { Module, forwardRef } from '@nestjs/common';
import { KafkaProducerService } from './kafka-producer.service';
import { InventorySyncConsumer } from './inventory-sync.consumer';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [forwardRef(() => SearchModule)],
  providers: [KafkaProducerService, InventorySyncConsumer],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
