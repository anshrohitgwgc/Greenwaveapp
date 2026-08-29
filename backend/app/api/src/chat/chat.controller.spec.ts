import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';

import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: {
    createMessage: jest.Mock;
    listMessages: jest.Mock;
    getOnlineStaff: jest.Mock;
    getMessageStream: jest.Mock;
    recordActivity: jest.Mock;
  };

  const staffUser = {
    id: 1,
    fullName: 'Staff User',
    role: 'staff',
    email: 'staff@greenwave.test',
  };

  beforeEach(async () => {
    chatService = {
      createMessage: jest
        .fn()
        .mockResolvedValue({ id: 'msg-1', message: 'Hello team' }),
      listMessages: jest
        .fn()
        .mockResolvedValue([{ id: 'msg-1', message: 'Hello team' }]),
      getOnlineStaff: jest.fn().mockReturnValue({
        count: 1,
        users: [{ id: 1, fullName: 'Staff User', role: 'staff' }],
      }),
      getMessageStream: jest
        .fn()
        .mockReturnValue(of({ data: '{"type":"message"}' })),
      recordActivity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: chatService,
        },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('creates message with authenticated actor', async () => {
    const res = await controller.createMessage(
      { message: 'Hello team' },
      staffUser,
    );
    expect(chatService.createMessage).toHaveBeenCalledWith(
      { message: 'Hello team' },
      staffUser,
    );
    expect(res).toEqual({ id: 'msg-1', message: 'Hello team' });
  });

  it('lists messages and records activity', async () => {
    const res = await controller.listMessages('50', undefined, staffUser);
    expect(chatService.recordActivity).toHaveBeenCalledWith(staffUser);
    expect(chatService.listMessages).toHaveBeenCalledWith({
      limit: 50,
      before: undefined,
    });
    expect(res).toHaveLength(1);
  });

  it('returns online staff count and users', () => {
    const res = controller.getOnlineStaff(staffUser);
    expect(res.count).toBe(1);
    expect(res.users[0].fullName).toBe('Staff User');
  });
});
