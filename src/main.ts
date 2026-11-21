import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // OpenAPI / Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('Omnichannel Mini-Warehouse Retail API')
    .setDescription(
      'High-concurrency retail backend guaranteeing that no individual physical unit is ever sold twice. Integrated with Aiven PostgreSQL, Kafka, and OpenSearch.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT bearer token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Auth & Identity', 'User registration, login, and JWT session issuance')
    .addTag('Search', 'Fuzzy search with real-time store availability and geo-distance')
    .addTag('Cart & Reservation', 'Pessimistic row-level locking with strict TTL')
    .addTag('Checkout & Orders', 'Atomic order commitment & fulfillment')
    .addTag('Stores & Inventory', 'Physical mini-warehouses and serialized items')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Retail Backend running on: http://localhost:${port}/api/v1`);
  logger.log(`Swagger UI live at: http://localhost:${port}/docs`);
}

bootstrap();
