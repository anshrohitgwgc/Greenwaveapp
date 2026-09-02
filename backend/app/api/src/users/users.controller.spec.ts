import { Test, TestingModule } from '@nestjs/testing';

import { AuditService } from '../audit/audit.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { provideDivisionsService } from '../../test/fixtures/divisions-test.helper';
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
            getUserDivisions: jest.fn().mockResolvedValue([]),
            assignUserDivisions: jest.fn().mockResolvedValue([]),
            getUserProfile: jest.fn(),
            assignUserWarehouses: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: AuditService,
          useValue: { record: jest.fn() },
        },
        {
          provide: WarehousesService,
          useValue: {
            assertWarehouseAccess: jest.fn().mockResolvedValue(undefined),
            getUserAuthorizedWarehouseIds: jest.fn().mockResolvedValue([]),
          },
        },
        ...provideDivisionsService().providers,
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
