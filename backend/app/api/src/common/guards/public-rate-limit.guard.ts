import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { RedisService } from '../../redis/redis.service';

export const RATE_LIMIT_KEY = 'publicRateLimit';

export interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

/** Per-client-IP fixed-window limit for unauthenticated endpoints. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Same Redis-with-memory-fallback approach as LoginRateLimitGuard. Uses
 * `request.ip`, which Express derives from X-Forwarded-For through exactly one
 * trusted proxy hop (`trust proxy` = 1 in main.ts), so a client cannot rotate
 * a spoofed header to escape the limit.
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(PublicRateLimitGuard.name);
  private readonly memory = new Map<string, { count: number; expiresAt: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.memory) if (v.expiresAt < now) this.memory.delete(k);
    }, 60_000).unref();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const key = `public-rl:${options.bucket}:${request.ip || 'unknown'}`;

    let count: number | null = null;
    try {
      const client = this.redisService.getClient();
      if (client && typeof client.incr === 'function') {
        count = await client.incr(key);
        if (count === 1) await client.expire(key, options.windowSeconds);
      }
    } catch {
      this.logger.warn('Redis unavailable for public rate limiting; using memory fallback');
    }

    if (count === null) {
      const now = Date.now();
      const item = this.memory.get(key);
      if (!item || item.expiresAt < now) {
        this.memory.set(key, { count: 1, expiresAt: now + options.windowSeconds * 1000 });
        count = 1;
      } else {
        count = ++item.count;
      }
    }

    if (count > options.limit) {
      throw new HttpException('Too many requests. Please wait a moment and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
