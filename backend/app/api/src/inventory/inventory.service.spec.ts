import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from '../audit/audit.service';
import { Container } from './entities/container.entity';
import { InventoryBalance } from './entities/inventory-balance.entity';
import { InventoryTransaction } from './entities/inventory-transaction.entity';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let transactionRepo: { create: jest.Mock; save: jest.Mock };
  let auditService: { record: jest.Mock };

  const staffActor = { id: 1, role: 'staff', email: 'staff@example.com' };
  const managerActor = { id: 2, role: 'manager', email: 'manager@example.com' };

  beforeEach(async () => {
    transactionRepo = {
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve({ ...data }),
      ),
    };
    auditService = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: getRepositoryToken(Container), useValue: {} },
        {
          provide: getRepositoryToken(InventoryTransaction),
          useValue: transactionRepo,
        },
        { provide: getRepositoryToken(InventoryBalance), useValue: {} },
        { provide: AuditService, useValue: auditService },
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

  it('computes total as the sum of XL/L/M/S for inbound transactions', async () => {
    const result = await service.createTransaction(
      {
        warehouseId: 'w1',
        materialId: 'm1',
        type: 'inbound',
        xl: 1.5,
        l: 2,
        m: 0.5,
        s: 1,
      },
      staffActor,
    );

    expect(result.total).toBe('5');
  });

  it('allows staff to record inbound/outbound without a reason', async () => {
    await expect(
      service.createTransaction(
        { warehouseId: 'w1', materialId: 'm1', type: 'outbound', xl: 1 },
        staffActor,
      ),
    ).resolves.toBeDefined();
  });
});
