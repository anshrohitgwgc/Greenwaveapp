import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { UserWarehouse } from './entities/user-warehouse.entity';
import { Warehouse } from './entities/warehouse.entity';
import { WarehousesService } from './warehouses.service';

describe('WarehousesService', () => {
  let service: WarehousesService;
  let warehouseRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let userWarehouseRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };

  const sampleWarehouses = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Calgary, AB',
      code: 'CGY',
      province: 'AB',
      active: true,
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Ontario',
      code: 'ON',
      province: 'ON',
      active: true,
    },
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Maple Ridge, BC',
      code: 'MR',
      province: 'BC',
      active: true,
    },
  ];

  beforeEach(async () => {
    warehouseRepo = {
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve({ ...data }),
      ),
      find: jest.fn().mockResolvedValue(sampleWarehouses),
      findOne: jest.fn(({ where: { id } }: { where: { id: string } }) => {
        const found = sampleWarehouses.find((w) => w.id === id);
        return Promise.resolve(found || null);
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    userWarehouseRepo = {
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve(Array.isArray(data) ? data : { ...data }),
      ),
      find: jest
        .fn()
        .mockResolvedValue([
          { userId: 3, warehouseId: '22222222-2222-4222-8222-222222222222' },
        ]),
      findOne: jest.fn(
        ({
          where: { userId, warehouseId },
        }: {
          where: { userId: number; warehouseId: string };
        }) => {
          if (
            userId === 3 &&
            warehouseId === '22222222-2222-4222-8222-222222222222'
          ) {
            return Promise.resolve({ userId: 3, warehouseId });
          }
          return Promise.resolve(null);
        },
      ),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehousesService,
        {
          provide: getRepositoryToken(Warehouse),
          useValue: warehouseRepo,
        },
        {
          provide: getRepositoryToken(UserWarehouse),
          useValue: userWarehouseRepo,
        },
      ],
    }).compile();

    service = module.get<WarehousesService>(WarehousesService);
  });

  it('lists all active warehouses including Calgary, Ontario, and Maple Ridge', async () => {
    const list = await service.findAll(false);
    expect(list).toHaveLength(3);
    expect(list.map((w) => w.name)).toEqual([
      'Calgary, AB',
      'Ontario',
      'Maple Ridge, BC',
    ]);
  });

  it('retrieves a single warehouse by ID', async () => {
    const wh = await service.findOne('22222222-2222-4222-8222-222222222222');
    expect(wh.name).toBe('Calgary, AB');
    expect(wh.province).toBe('AB');
  });

  it('throws NotFoundException for nonexistent warehouse', async () => {
    await expect(
      service.findOne('99999999-9999-9999-9999-999999999999'),
    ).rejects.toThrow(NotFoundException);
  });

  it('authorizes user for assigned warehouse', async () => {
    const isAuth = await service.isUserAuthorizedForWarehouse(
      3,
      'staff',
      '22222222-2222-4222-8222-222222222222',
      [],
    );
    expect(isAuth).toBe(true);
  });

  it('rejects user for unauthorized warehouse (403)', async () => {
    await expect(
      service.assertWarehouseAccess(
        { id: 3, role: 'staff', email: 'staff@test.local', fullName: 'Staff' },
        '33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
