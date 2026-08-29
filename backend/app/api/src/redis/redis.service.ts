import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit {
  private client: RedisClientType;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const password = this.configService.get<string>('REDIS_PASSWORD');
    this.client = createClient({
      password: password || undefined,
      socket: {
        host: this.configService.get<string>('REDIS_HOST'),
        port: Number(this.configService.get<string>('REDIS_PORT')),
      },
    });

    await this.client.connect();

    console.log('✅ Redis Connected');
  }

  getClient() {
    return this.client;
  }
}
