import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

import { RedisService } from '../redis/redis.service';

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS_PER_TARGET = 10;
const MAX_ATTEMPTS_PER_IP = 30;

interface MemoryCounter {
  count: number;
  expiresAt: number;
}

/**
 * Dual-tier rate limiter for authentication endpoints backed by Redis with
 * in-memory fallback:
 *   1. Per IP+email: protects specific accounts from rapid brute force (10/min).
 *   2. Per IP: protects against credential stuffing across multiple accounts (30/min).
 * Automatically resets attempts upon successful authentication.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(LoginRateLimitGuard.name);
  private memoryCounters = new Map<string, MemoryCounter>();

  constructor(private readonly redisService: RedisService) {
    setInterval(() => this.cleanupMemory(), 60000).unref();
  }

  private cleanupMemory() {
    const now = Date.now();
    for (const [key, val] of this.memoryCounters.entries()) {
      if (val.expiresAt < now) {
        this.memoryCounters.delete(key);
      }
    }
  }

  private getClientIp(request: Request): string {
    const xForwarded = request.headers['x-forwarded-for'];
    if (typeof xForwarded === 'string') {
      return xForwarded.split(',')[0].trim();
    }
    return request.ip || '127.0.0.1';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const email = String(
      (request.body as { email?: string } | undefined)?.email ?? 'unknown',
    )
      .toLowerCase()
      .trim();
    const ip = this.getClientIp(request);

    const targetKey = `login-rl:${ip}:${email}`;
    const ipKey = `login-rl-ip:${ip}`;

    try {
      const client = this.redisService.getClient();
      if (client && typeof client.incr === 'function') {
        const targetAttempts = await client.incr(targetKey);
        if (targetAttempts === 1) {
          await client.expire(targetKey, WINDOW_SECONDS);
        }

        const ipAttempts = await client.incr(ipKey);
        if (ipAttempts === 1) {
          await client.expire(ipKey, WINDOW_SECONDS);
        }

        if (
          targetAttempts > MAX_ATTEMPTS_PER_TARGET ||
          ipAttempts > MAX_ATTEMPTS_PER_IP
        ) {
          throw new HttpException(
            'Too many login attempts. Try again in a minute.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        return true;
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `Redis rate limiter unavailable, using memory fallback: ${err}`,
      );
    }

    // In-memory fallback
    const now = Date.now();
    const checkMemoryKey = (key: string, max: number) => {
      let item = this.memoryCounters.get(key);
      if (!item || item.expiresAt < now) {
        item = { count: 1, expiresAt: now + WINDOW_SECONDS * 1000 };
      } else {
        item.count++;
      }
      this.memoryCounters.set(key, item);
      return item.count <= max;
    };

    const targetOk = checkMemoryKey(targetKey, MAX_ATTEMPTS_PER_TARGET);
    const ipOk = checkMemoryKey(ipKey, MAX_ATTEMPTS_PER_IP);

    if (!targetOk || !ipOk) {
      throw new HttpException(
        'Too many login attempts. Try again in a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Resets rate limit counters after successful authentication.
   */
  async resetLimit(ip: string, email: string): Promise<void> {
    const targetKey = `login-rl:${ip}:${email.toLowerCase().trim()}`;
    try {
      const client = this.redisService.getClient();
      if (client && typeof client.del === 'function') {
        await client.del(targetKey);
      }
    } catch {
      // Ignore Redis errors on reset
    }

    this.memoryCounters.delete(targetKey);
  }
}
