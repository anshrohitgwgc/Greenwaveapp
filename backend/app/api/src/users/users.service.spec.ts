import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from '../audit/audit.service';
import { RolesService } from '../roles/roles.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { provideDivisionsService } from '../../test/fixtures/divisions-test.helper';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            count: jest.fn().mockResolvedValue(1),
          },
        },
        {
          provide: RolesService,
          useValue: {
            getPermissionsForRole: jest
              .fn()
              .mockResolvedValue(['inventory:write']),
          },
        },
        {
          provide: WarehousesService,
          useValue: {
            getUserAuthorizedWarehouses: jest.fn().mockResolvedValue([]),
            getUserWarehouseAccess: jest.fn().mockResolvedValue([]),
            assignUserWarehouses: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: AuditService,
          useValue: {
            record: jest.fn().mockResolvedValue({}),
          },
        },
        ...provideDivisionsService().providers,
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
