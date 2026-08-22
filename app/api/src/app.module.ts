import { RedisModule } from './redis/redis.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { PickupsModule } from './pickups/pickups.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',

        host: config.get<string>('DATABASE_HOST'),
        port: Number(config.get<string>('DATABASE_PORT')),

        username: config.get<string>('DATABASE_USER'),
        password: config.get<string>('DATABASE_PASSWORD'),

        database: config.get<string>('DATABASE_NAME'),

        autoLoadEntities: true,
        synchronize: true,
      }),
    }),

    UsersModule,

    AuthModule,
    
    RedisModule,
    
    StorageModule,
    
    PickupsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
