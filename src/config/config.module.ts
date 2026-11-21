import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AivenConfigService } from './aiven.config';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),
  ],
  providers: [AivenConfigService],
  exports: [AivenConfigService, NestConfigModule],
})
export class AppConfigModule {}
