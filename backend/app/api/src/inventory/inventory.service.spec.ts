import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { WarehousesService } from '../warehouses/warehouses.service';
import { Container } from './entities/container.entity';
import { InventoryBalance } from './entities/inventory-balance.entity';
import { InventoryTransaction } from './entities/inventory-transaction.entity';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let transactionRepo: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let containerRepo: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
  };
  let balanceRepo: { find: jest.Mock; findOne: jest.Mock };
  let auditService: { record: jest.Mock };
  let warehousesService: {
    assertWarehouseAccess: jest.Mock;
    getUserAuthorizedWarehouseIds: jest.Mock;
  };

  const staffActor: AuthenticatedUser = {
    id: 1,
    role: 'staff',
    email: 'staff@example.com',
    fullName: 'Staff',
    warehouseIds: ['w1'],
  };
  const managerActor: AuthenticatedUser = {
    id: 2,
    role: 'manager',
    email: 'manager@example.com',
    fullName: 'Manager',
    warehouseIds: ['w1'],
  };

  beforeEach(async () => {
    transactionRepo = {
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve({ ...data }),
      ),
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    containerRepo = {
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve({ ...data }),
      ),
      findOne: jest.fn(() =>
        Promise.resolve({ id: 'c1', containerNumber: 'MSMU6896930' }),
      ),
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    balanceRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        warehouseId: 'w1',
        materialId: 'm1',
        balance: '500',
        xlBalance: '100',
        lBalance: '200',
        mBalance: '100',
        sBalance: '100',
      }),
    };
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    warehousesService = {
      assertWarehouseAccess: jest.fn().mockResolvedValue(undefined),
      getUserAuthorizedWarehouseIds: jest.fn().mockResolvedValue(['w1']),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: getRepositoryToken(Container), useValue: containerRepo },
        {
          provide: getRepositoryToken(InventoryTransaction),
          useValue: transactionRepo,
        },
        {
          provide: getRepositoryToken(InventoryBalance),
          useValue: balanceRepo,
        },
        { provide: AuditService, useValue: auditService },
        { provide: WarehousesService, useValue: warehousesService },
      ],
    }).compile();

    service = module.get(InventoryService);
  });

  it('rejects an adjustment with no reason', async () => {
    await expect(
      service.createTransaction(
        {
          warehouseId: 'w1',
          materialId: 'm1',
          type: 'adjustment',
          xl: 1,
        },
        managerActor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an adjustment from a staff member, even with a reason', async () => {
    await expect(
      service.createTransaction(
        {
          warehouseId: 'w1',
          materialId: 'm1',
          type: 'adjustment',
          reason: 'recount',
          xl: 1,
        },
        staffActor,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a manager to record an adjustment with a reason, and writes an audit event', async () => {
    const result = await service.createTransaction(
      {
        warehouseId: 'w1',
        materialId: 'm1',
        type: 'adjustment',
        reason: 'physical recount',
        xl: 2,
      },
      managerActor,
    );

    expect(result.total).toBe('2');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inventory.adjustment' }),
    );
  });

  it('computes total as the sum of XL/L/M/S for inbound transactions (100+200+300+400=1000)', async () => {
    const result = await service.createTransaction(
      {
        warehouseId: 'w1',
        materialId: 'm1',
        type: 'inbound',
        xl: 100,
        l: 200,
        m: 300,
        s: 400,
      },
      staffActor,
    );

    expect(result.total).toBe('1000');
  });

  it('allows staff to record inbound/outbound without a reason', async () => {
    await expect(
      service.createTransaction(
        { warehouseId: 'w1', materialId: 'm1', type: 'outbound', xl: 1 },
        staffActor,
      ),
    ).resolves.toBeDefined();
  });

  it('tracks container loading details and calculates total size breakdown', async () => {
    const container = await service.createContainer(
      {
        warehouseId: 'w1',
        orderNumber: 'Jul20-DIVESTPC-AB38A',
        containerNumber: 'MSMU 6896930',
        sealNumber: '0336695',
        productName: 'Synguard 100',
        xl: 0,
        l: 0,
        m: 3581,
        s: 0,
      },
      staffActor,
    );

    expect(container.total).toBe('3581');
    expect(container.containerNumber).toBe('MSMU 6896930');
    expect(container.status).toBe('in_transit');
  });
});
