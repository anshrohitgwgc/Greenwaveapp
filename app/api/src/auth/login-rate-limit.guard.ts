import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 10;

/**
 * Fixed-window limiter per IP+email on the login endpoint, backed by Redis.
 * Fails OPEN (allows the request) if Redis is unreachable — a rate limiter
 * outage should not become a full login outage. Documented as a known
 * trade-off in docs/V2_ARCHITECTURE.md.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(LoginRateLimitGuard.name);

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const email = String(request.body?.email ?? 'unknown').toLowerCase().trim();
    const ip = request.ip ?? 'unknown';
    const key = `login-rl:${ip}:${email}`;

    try {
      const client = this.redisService.getClient();
      const attempts = await client.incr(key);
      if (attempts === 1) {
        await client.expire(key, WINDOW_SECONDS);
      }
      if (attempts > MAX_ATTEMPTS) {
        throw new HttpException(
          'Too many login attempts. Try again in a minute.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Rate limiter unavailable, failing open: ${err}`);
    }

    return true;
  }
}
