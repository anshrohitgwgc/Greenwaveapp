import {
  BadRequestException,
  Injectable,
  MessageEvent,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { LessThan, Repository } from 'typeorm';
import { Observable, Subject } from 'rxjs';

import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { ChatMessage } from './entities/chat-message.entity';

interface ChatActor {
  id: number;
  fullName: string;
  role: string;
  email: string;
}

interface ActiveUser {
  id: number;
  fullName: string;
  role: string;
  lastSeen: Date;
}

@Injectable()
export class ChatService {
  private readonly messageStream$ = new Subject<MessageEvent>();
  private readonly activeUsers = new Map<number, ActiveUser>();

  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatRepository: Repository<ChatMessage>,
    private readonly auditService: AuditService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  async createMessage(
    dto: CreateMessageDto,
    actor: ChatActor,
  ): Promise<ChatMessage> {
    const text = dto.message ? dto.message.trim() : '';
    if (!text) {
      throw new BadRequestException('Message cannot be empty');
    }

    const message = this.chatRepository.create({
      id: randomUUID(),
      senderId: actor.id,
      senderName: actor.fullName || actor.email,
      senderRole: actor.role,
      message: text,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    const saved = await this.chatRepository.save(message);

    // Record activity for presence
    this.recordActivity(actor);

    // Broadcast message via SSE
    const payload = {
      type: 'message',
      data: saved,
    };
    this.messageStream$.next({
      data: JSON.stringify(payload),
    });

    // Try Redis publish if available
    try {
      const client = this.redisService?.getClient();
      if (client && typeof client.publish === 'function') {
        await client.publish('greenwave:chat:messages', JSON.stringify(saved));
      }
    } catch {
      // Redis optional / fallback to memory broadcast
    }

    // Record audit event
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'chat.message_sent',
      entityType: 'chat_message',
      entityId: saved.id,
      summary: `${actor.fullName || actor.email} posted a chat message`,
      metadata: {
        messageLength: text.length,
      },
    });

    return saved;
  }

  async listMessages(params: {
    limit?: number;
    before?: string;
  }): Promise<ChatMessage[]> {
    const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 100);
    const where: Record<string, unknown> = {};

    if (params.before) {
      const beforeDate = new Date(params.before);
      if (!isNaN(beforeDate.getTime())) {
        where.createdAt = LessThan(beforeDate);
      }
    }

    // Fetch latest descending first to get recent slice
    const messages = await this.chatRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });

    // Return in chronological ascending order for display
    return messages.reverse();
  }

  getMessageStream(): Observable<MessageEvent> {
    return this.messageStream$.asObservable();
  }

  recordActivity(actor: { id: number; fullName: string; role: string }) {
    this.activeUsers.set(actor.id, {
      id: actor.id,
      fullName: actor.fullName,
      role: actor.role,
      lastSeen: new Date(),
    });
  }

  getOnlineStaff(): {
    count: number;
    users: { id: number; fullName: string; role: string }[];
  } {
    const cutoff = Date.now() - 5 * 60 * 1000; // active in last 5 minutes
    const online: { id: number; fullName: string; role: string }[] = [];

    for (const [id, user] of this.activeUsers.entries()) {
      if (user.lastSeen.getTime() >= cutoff) {
        online.push({ id, fullName: user.fullName, role: user.role });
      } else {
        this.activeUsers.delete(id);
      }
    }

    return {
      count: online.length,
      users: online,
    };
  }
}
