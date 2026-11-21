import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { KafkaConfig, SASLOptions } from 'kafkajs';
import { ClientOptions as OpenSearchClientOptions } from '@opensearch-project/opensearch';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

@Injectable()
export class AivenConfigService {
  private readonly logger = new Logger(AivenConfigService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Reads certificate file contents safely, supporting AIVEN_CA_PEM_PATH or service-specific paths.
   */
  readCertFile(configKey?: string, fallbackPath?: string): Buffer | undefined {
    // Primary: check AIVEN_CA_PEM_PATH first, then the specific key or fallback
    const certPath =
      this.configService.get<string>('AIVEN_CA_PEM_PATH') ||
      (configKey ? this.configService.get<string>(configKey) : undefined) ||
      fallbackPath ||
      './certs/ca.pem';

    if (!certPath) {
      return undefined;
    }

    try {
      const resolvedPath = path.isAbsolute(certPath)
        ? certPath
        : path.resolve(process.cwd(), certPath);

      if (fs.existsSync(resolvedPath)) {
        return fs.readFileSync(resolvedPath);
      }
      this.logger.warn(`CA Certificate file not found at path: ${resolvedPath}`);
      return undefined;
    } catch (err) {
      this.logger.error(`Failed to read certificate: ${err.message}`);
      return undefined;
    }
  }

  /**
   * Generates TypeORM connection options for Aiven PostgreSQL with strict SSL/TLS.
   */
  getTypeOrmConfig(): TypeOrmModuleOptions {
    const databaseUrl = this.configService.get<string>('AIVEN_PG_URL');
    const caCert = this.readCertFile('AIVEN_PG_CA_CERT_PATH');
    const rejectUnauthorized =
      this.configService.get<string>('AIVEN_PG_SSL_REJECT_UNAUTHORIZED', 'true') === 'true';

    const sslConfig = caCert
      ? {
          rejectUnauthorized,
          ca: caCert.toString(),
        }
      : {
          rejectUnauthorized: false,
        };

    return {
      type: 'postgres',
      url: databaseUrl,
      ssl: sslConfig,
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production', // Use migrations in production
      extra: {
        max: parseInt(this.configService.get<string>('AIVEN_PG_POOL_SIZE', '30'), 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      },
      logging: process.env.NODE_ENV === 'development',
    };
  }

  /**
   * Generates KafkaJS options for Aiven Kafka with SASL/SSL or Mutual TLS (mTLS).
   * Reads ca.pem and configures secure TLS encryption and SASL credentials.
   */
  getKafkaConfig(): KafkaConfig {
    const brokers = (
      this.configService.get<string>('AIVEN_KAFKA_BROKERS', 'localhost:9092')
    )
      .split(',')
      .map((b) => b.trim());

    const clientId = this.configService.get<string>('AIVEN_KAFKA_CLIENT_ID', 'retail-backend');
    const caCert = this.readCertFile('AIVEN_KAFKA_CA_CERT_PATH');
    const accessCert = this.readCertFile('AIVEN_KAFKA_ACCESS_CERT_PATH', './certs/service.cert');
    const accessKey = this.readCertFile('AIVEN_KAFKA_ACCESS_KEY_PATH', './certs/service.key');

    const saslUsername =
      this.configService.get<string>('AIVEN_KAFKA_USER') ||
      this.configService.get<string>('AIVEN_KAFKA_SASL_USERNAME');

    const saslPassword =
      this.configService.get<string>('AIVEN_KAFKA_PASSWORD') ||
      this.configService.get<string>('AIVEN_KAFKA_SASL_PASSWORD');

    const saslMechanism = this.configService.get<string>('AIVEN_KAFKA_SASL_MECHANISM', 'plain');

    let sslConfig: any = false;
    if (caCert) {
      sslConfig = {
        rejectUnauthorized: true,
        ca: [caCert],
      };
      if (accessCert && accessKey) {
        sslConfig.cert = accessCert;
        sslConfig.key = accessKey;
      }
    } else if (process.env.NODE_ENV === 'production') {
      sslConfig = true;
    }

    let saslConfig: SASLOptions | undefined = undefined;
    if (saslUsername && saslPassword) {
      saslConfig = {
        mechanism: (saslMechanism.toLowerCase() === 'scram-sha-256' ? 'scram-sha-256' : 'plain') as any,
        username: saslUsername,
        password: saslPassword,
      };
    }

    return {
      clientId,
      brokers,
      ssl: sslConfig,
      sasl: saslConfig,
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
    };
  }

  /**
   * Generates OpenSearch Client options for Aiven OpenSearch with HTTPS and CA verification.
   */
  getOpenSearchConfig(): OpenSearchClientOptions {
    const node =
      this.configService.get<string>('AIVEN_OPENSEARCH_URI') ||
      this.configService.get<string>('AIVEN_OPENSEARCH_NODE', 'https://localhost:9200');

    const username =
      this.configService.get<string>('AIVEN_OPENSEARCH_USER') ||
      this.configService.get<string>('AIVEN_OPENSEARCH_USERNAME', 'avnadmin');

    const password =
      this.configService.get<string>('AIVEN_OPENSEARCH_PASSWORD') || '';

    const caCert = this.readCertFile('AIVEN_OPENSEARCH_CA_CERT_PATH');

    return {
      node,
      auth: {
        username,
        password,
      },
      ssl: {
        ca: caCert,
        rejectUnauthorized: Boolean(caCert),
      },
      maxRetries: 3,
      requestTimeout: 10000,
    };
  }
}
