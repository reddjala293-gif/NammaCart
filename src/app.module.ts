import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module';
import { AivenConfigService } from './config/aiven.config';
import { AuthModule } from './modules/auth/auth.module';
import { StoresModule } from './modules/stores/stores.module';
import { ProductsModule } from './modules/products/products.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { KafkaModule } from './modules/kafka/kafka.module';
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [AivenConfigService],
      useFactory: (aivenConfig: AivenConfigService) => aivenConfig.getTypeOrmConfig(),
    }),
    AuthModule,
    StoresModule,
    ProductsModule,
    InventoryModule,
    CheckoutModule,
    KafkaModule,
    SearchModule,
  ],
})
export class AppModule {}
