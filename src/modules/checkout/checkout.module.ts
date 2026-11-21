import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OutboxEvent } from '../../common/outbox/outbox-event.entity';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { OutboxService } from '../../common/outbox/outbox.service';
import { KafkaModule } from '../kafka/kafka.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, OutboxEvent]),
    InventoryModule,
    KafkaModule,
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService, OutboxService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
