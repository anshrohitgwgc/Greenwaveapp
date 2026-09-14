import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { CsrfGuard } from '../common/guards/csrf.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DivisionsModule } from '../divisions/divisions.module';
import { RedisModule } from '../redis/redis.module';
import { RolesModule } from '../roles/roles.module';
import { UsersModule } from '../users/users.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { SessionService } from './session.service';

@Global()
@Module({
  imports: [
    UsersModule,
    RolesModule,
    WarehousesModule,
    DivisionsModule,
    RedisModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'insecure-dev-only-secret',
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRATION') ??
            '24h') as unknown as number,
        },
      }),
    }),
  ],

  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    JwtStrategy,
    JwtAuthGuard,
    CsrfGuard,
    LoginRateLimitGuard,
  ],
  exports: [
    AuthService,
    SessionService,
    JwtAuthGuard,
    CsrfGuard,
    LoginRateLimitGuard,
    JwtModule,
  ],
})
export class AuthModule {}
