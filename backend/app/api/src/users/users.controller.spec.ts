import { Test, TestingModule } from '@nestjs/testing';

import { AuditService } from '../audit/audit.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            findAll: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            getUserWarehouses: jest.fn().mockResolvedValue([]),
            getUserProfile: jest.fn(),
            assignUserWarehouses: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: AuditService,
          useValue: { record: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
