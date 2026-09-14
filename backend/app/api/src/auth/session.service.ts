import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

import { RedisService } from '../redis/redis.service';

export interface SessionData {
  id: string;
  userId: number;
  email: string;
  role: string;
  csrfToken: string;
  createdAt: number;
  lastAccessedAt: number;
  ip?: string;
  userAgent?: string;
}

const SESSION_TTL_SECONDS = 86400; // 24 hours absolute maximum
const IDLE_TIMEOUT_SECONDS = 7200; // 2 hours idle timeout

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  // In-memory fallback for local dev without Redis and headless test runners
  private memorySessions = new Map<
    string,
    { data: SessionData; expiresAt: number }
  >();
  private memoryUserSessions = new Map<number, Set<string>>();

  constructor(private readonly redisService: RedisService) {
    // Periodic cleanup for expired in-memory sessions
    setInterval(() => this.cleanupMemorySessions(), 60000).unref();
  }

  private cleanupMemorySessions(): void {
    const now = Date.now();
    for (const [id, item] of this.memorySessions.entries()) {
      if (item.expiresAt < now) {
        this.memorySessions.delete(id);
        const userSet = this.memoryUserSessions.get(item.data.userId);
        if (userSet) {
          userSet.delete(id);
          if (userSet.size === 0) {
            this.memoryUserSessions.delete(item.data.userId);
          }
        }
      }
    }
  }

  /**
   * Generates a 256-bit cryptographically secure opaque session identifier.
   */
  generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generates a cryptographically random CSRF token tied to the session.
   */
  generateCsrfToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  /**
   * Creates and stores a new server-side session.
   */
  async createSession(
    user: { id: number; email: string; role: string },
    meta?: { ip?: string; userAgent?: string },
  ): Promise<SessionData> {
    const sessionId = this.generateSessionId();
    const csrfToken = this.generateCsrfToken();
    const now = Date.now();

    const session: SessionData = {
      id: sessionId,
      userId: user.id,
      email: user.email,
      role: user.role,
      csrfToken,
      createdAt: now,
      lastAccessedAt: now,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    };

    try {
      const client = this.redisService.getClient();
      if (client && typeof client.set === 'function') {
        const key = `sess:${sessionId}`;
        const userKey = `user_sess:${user.id}`;
        await client.set(key, JSON.stringify(session), {
          EX: SESSION_TTL_SECONDS,
        });
        if (typeof client.sAdd === 'function') {
          await client.sAdd(userKey, sessionId);
          await client.expire(userKey, SESSION_TTL_SECONDS);
        }
        return session;
      }
    } catch (err) {
      this.logger.warn(
        `Redis unavailable for createSession, falling back to memory: ${err}`,
      );
    }

    // Memory fallback
    this.memorySessions.set(sessionId, {
      data: session,
      expiresAt: now + SESSION_TTL_SECONDS * 1000,
    });
    if (!this.memoryUserSessions.has(user.id)) {
      this.memoryUserSessions.set(user.id, new Set());
    }
    this.memoryUserSessions.get(user.id)!.add(sessionId);

    return session;
  }

  /**
   * Retrieves and refreshes an active session by opaque session ID.
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    if (!sessionId || typeof sessionId !== 'string') return null;

    const now = Date.now();

    try {
      const client = this.redisService.getClient();
      if (client && typeof client.get === 'function') {
        const raw = await client.get(`sess:${sessionId}`);
        if (!raw) return null;

        const session = JSON.parse(raw) as SessionData;

        // Check idle timeout
        if (now - session.lastAccessedAt > IDLE_TIMEOUT_SECONDS * 1000) {
          await this.invalidateSession(sessionId);
          return null;
        }

        // Touch last accessed timestamp
        session.lastAccessedAt = now;
        await client.set(`sess:${sessionId}`, JSON.stringify(session), {
          EX: SESSION_TTL_SECONDS,
        });

        return session;
      }
    } catch (err) {
      this.logger.warn(
        `Redis unavailable for getSession, checking memory: ${err}`,
      );
    }

    // Memory fallback
    const item = this.memorySessions.get(sessionId);
    if (!item) return null;

    if (
      item.expiresAt < now ||
      now - item.data.lastAccessedAt > IDLE_TIMEOUT_SECONDS * 1000
    ) {
      this.memorySessions.delete(sessionId);
      return null;
    }

    item.data.lastAccessedAt = now;
    return item.data;
  }

  /**
   * Permanently invalidates a session on the server.
   */
  async invalidateSession(sessionId: string): Promise<void> {
    if (!sessionId) return;

    try {
      const client = this.redisService.getClient();
      if (client && typeof client.del === 'function') {
        const raw = await client.get(`sess:${sessionId}`);
        if (raw) {
          try {
            const session = JSON.parse(raw) as SessionData;
            if (typeof client.sRem === 'function') {
              await client.sRem(`user_sess:${session.userId}`, sessionId);
            }
          } catch {
            // Ignore parse error
          }
        }
        await client.del(`sess:${sessionId}`);
      }
    } catch (err) {
      this.logger.warn(`Redis unavailable for invalidateSession: ${err}`);
    }

    const item = this.memorySessions.get(sessionId);
    if (item) {
      this.memorySessions.delete(sessionId);
      const userSet = this.memoryUserSessions.get(item.data.userId);
      if (userSet) {
        userSet.delete(sessionId);
      }
    }
  }

  /**
   * Revokes all active sessions for a user (e.g. after password change or deactivation).
   */
  async revokeAllUserSessions(userId: number): Promise<void> {
    try {
      const client = this.redisService.getClient();
      if (client && typeof client.sMembers === 'function') {
        const sessionIds = await client.sMembers(`user_sess:${userId}`);
        if (Array.isArray(sessionIds) && sessionIds.length > 0) {
          const keys = sessionIds.map((id: string) => `sess:${id}`);
          await client.del(keys);
        }
        await client.del(`user_sess:${userId}`);
      }
    } catch (err) {
      this.logger.warn(`Redis unavailable for revokeAllUserSessions: ${err}`);
    }

    const userSet = this.memoryUserSessions.get(userId);
    if (userSet) {
      for (const id of userSet) {
        this.memorySessions.delete(id);
      }
      this.memoryUserSessions.delete(userId);
    }
  }
}
