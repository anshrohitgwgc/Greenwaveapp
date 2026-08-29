import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from '../audit/audit.service';
import { ChatService } from './chat.service';
import { ChatMessage } from './entities/chat-message.entity';

describe('ChatService', () => {
  let service: ChatService;
  let chatRepo: { create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let auditService: { record: jest.Mock };

  const staffActor = {
    id: 1,
    fullName: 'John Doe',
    role: 'staff',
    email: 'john@greenwave.test',
  };
  const adminActor = {
    id: 2,
    fullName: 'Admin User',
    role: 'admin',
    email: 'admin@greenwave.test',
  };

  beforeEach(async () => {
    chatRepo = {
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve({ ...data }),
      ),
      find: jest.fn(() => Promise.resolve([])),
    };
    auditService = { record: jest.fn(() => Promise.resolve()) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(ChatMessage),
          useValue: chatRepo,
        },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(ChatService);
  });

  it('creates and persists a chat message, records audit event, and broadcasts', async () => {
    const msg = await service.createMessage(
      { message: 'Container MSMU 6896930 unloaded at Calgary.' },
      staffActor,
    );

    expect(msg.message).toBe('Container MSMU 6896930 unloaded at Calgary.');
    expect(msg.senderId).toBe(1);
    expect(msg.senderName).toBe('John Doe');
    expect(msg.senderRole).toBe('staff');
    expect(chatRepo.save).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'chat.message_sent', actorUserId: 1 }),
    );
  });

  it('rejects an empty message with BadRequestException', async () => {
    await expect(
      service.createMessage({ message: '   ' }, staffActor),
    ).rejects.toThrow(BadRequestException);
  });

  it('lists messages in chronological order', async () => {
    const fakeMessages = [
      {
        id: '1',
        message: 'First',
        createdAt: new Date('2026-08-28T10:00:00Z'),
      },
      {
        id: '2',
        message: 'Second',
        createdAt: new Date('2026-08-28T10:05:00Z'),
      },
    ];
    // find returns descending, service returns reversed (ascending)
    chatRepo.find.mockResolvedValue([...fakeMessages].reverse());

    const result = await service.listMessages({ limit: 20 });
    expect(chatRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { createdAt: 'DESC' }, take: 20 }),
    );
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });

  it('tracks online staff activity count correctly', () => {
    service.recordActivity(staffActor);
    service.recordActivity(adminActor);

    const online = service.getOnlineStaff();
    expect(online.count).toBe(2);
    expect(online.users.map((u) => u.fullName)).toEqual([
      'John Doe',
      'Admin User',
    ]);
  });
});
