import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UniqueItem } from './entities/unique-item.entity';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';
import { InventoryCleanupService } from './inventory-cleanup.service';
import { InventoryController } from './inventory.controller';
import { OutboxEvent } from '../../common/outbox/outbox-event.entity';
import { OutboxService } from '../../common/outbox/outbox.service';
import { KafkaModule } from '../kafka/kafka.module';

@Module({
  imports: [TypeOrmModule.forFeature([UniqueItem, OutboxEvent]), KafkaModule],
  controllers: [InventoryController],
  providers: [
    InventoryRepository,
    InventoryService,
    InventoryCleanupService,
    OutboxService,
  ],
  exports: [InventoryRepository, InventoryService, TypeOrmModule],
})
export class InventoryModule {}
