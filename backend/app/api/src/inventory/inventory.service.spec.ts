import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Material } from '../materials/entities/material.entity';
import { PhotoAsset } from '../photos/entities/photo-asset.entity';
import { StorageService } from '../storage/storage.service';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
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
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let containerRepo: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
  };
  let balanceRepo: { find: jest.Mock; findOne: jest.Mock };
  let materialRepo: { findOne: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let warehouseRepo: { findOne: jest.Mock };
  let photoRepo: { createQueryBuilder: jest.Mock; find: jest.Mock; findOne: jest.Mock };
  let storageService: { presignedGetUrl: jest.Mock };
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
        Promise.resolve({ ...data, id: 'tx-1' }),
      ),
      findOne: jest.fn().mockResolvedValue({
        id: 'tx-1',
        warehouseId: 'w1',
        materialId: 'm1',
        type: 'inbound',
        unitType: 'pallet',
        division: 'recycling',
        weightValue: '3658.000',
        weightUnit: 'kg',
        photoId: 'photo-1',
        xl: '2',
        l: '2',
        m: '1',
        s: '1',
        total: '6',
        reason: null,
        reference: 'ORD-100',
        orderNumber: 'ORD-100',
        containerNumber: 'MSMU6896930',
        sealNumber: 'SEAL-99',
        notes: 'Clean pallet batch',
        createdBy: 1,
        createdAt: new Date(),
      }),
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
        Promise.resolve({ id: 'c1', containerNumber: 'MSMU6896930', blNumber: 'BL-123', shippingLine: 'Maersk', eta: '2026-09-01' }),
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
    materialRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'm1', name: 'OCC Cardboard', category: 'paper', unit: 'kg' }),
    };
    userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 1, fullName: 'Staff Member', email: 'staff@example.com', role: 'staff' }),
    };
    warehouseRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'w1', name: 'Maple Ridge', code: 'MR-BC', province: 'BC' }),
    };
    photoRepo = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'photo-1',
            objectKey: 'photos/w1/photo-1.jpg',
            originalFilename: 'inbound_pallet.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 102400,
            photoType: 'inventory_inbound',
            takenBy: 1,
            takenAt: new Date(),
          },
        ]),
      })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    storageService = {
      presignedGetUrl: jest.fn().mockResolvedValue('https://storage.gwgc.cloud/photos/w1/photo-1.jpg?signed=true'),
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
        { provide: getRepositoryToken(Material), useValue: materialRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Warehouse), useValue: warehouseRepo },
        { provide: getRepositoryToken(PhotoAsset), useValue: photoRepo },
        { provide: StorageService, useValue: storageService },
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
        division: 'healthcare',
        unitType: 'box',
        weightValue: 3581,
        weightUnit: 'kg',
        xl: 0,
        l: 0,
        m: 3581,
        s: 0,
      },
      staffActor,
    );

    expect(container.total).toBe('3581');
    expect(container.containerNumber).toBe('MSMU 6896930');
    expect(container.division).toBe('healthcare');
    expect(container.unitType).toBe('box');
  });

  describe('WHOLE NUMBER INVENTORY UNITS', () => {
    it('rejects decimal fraction quantities (e.g. 0.12)', async () => {
      await expect(
        service.createTransaction(
          {
            warehouseId: 'w1',
            materialId: 'm1',
            type: 'inbound',
            xl: 0.12 as any,
          },
          staffActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects decimal fraction quantities (e.g. 1.50)', async () => {
      await expect(
        service.createTransaction(
          {
            warehouseId: 'w1',
            materialId: 'm1',
            type: 'inbound',
            l: 1.5 as any,
          },
          staffActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts whole integer counts (e.g. 1, 2, 6)', async () => {
      const res = await service.createTransaction(
        {
          warehouseId: 'w1',
          materialId: 'm1',
          type: 'inbound',
          xl: 1,
          l: 2,
          m: 3,
          s: 0,
        },
        staffActor,
      );
      expect(res.total).toBe('6');
    });
  });

  describe('WEIGHT VALIDATION', () => {
    it('accepts valid weight in KG', async () => {
      const res = await service.createTransaction(
        {
          warehouseId: 'w1',
          materialId: 'm1',
          type: 'inbound',
          xl: 6,
          weightValue: 3658,
          weightUnit: 'kg',
        },
        staffActor,
      );
      expect(res.weightValue).toBe('3658');
      expect(res.weightUnit).toBe('kg');
    });

    it('accepts valid weight in LB', async () => {
      const res = await service.createTransaction(
        {
          warehouseId: 'w1',
          materialId: 'm1',
          type: 'inbound',
          xl: 10,
          weightValue: 8000,
          weightUnit: 'lb',
        },
        staffActor,
      );
      expect(res.weightValue).toBe('8000');
      expect(res.weightUnit).toBe('lb');
    });

    it('rejects invalid weight unit (e.g. tons)', async () => {
      await expect(
        service.createTransaction(
          {
            warehouseId: 'w1',
            materialId: 'm1',
            type: 'inbound',
            xl: 1,
            weightValue: 100,
            weightUnit: 'tons' as any,
          },
          staffActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('DIVISION RULES & VALIDATION', () => {
    it('accepts Recycling division with PALLET unit type', async () => {
      const res = await service.createTransaction(
        {
          warehouseId: 'w1',
          materialId: 'm1',
          type: 'inbound',
          division: 'recycling',
          unitType: 'pallet',
          xl: 4,
        },
        staffActor,
      );
      expect(res.division).toBe('recycling');
      expect(res.unitType).toBe('pallet');
    });

    it('rejects Recycling division with BOX unit type', async () => {
      await expect(
        service.createTransaction(
          {
            warehouseId: 'w1',
            materialId: 'm1',
            type: 'inbound',
            division: 'recycling',
            unitType: 'box',
            xl: 4,
          },
          staffActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts Healthcare division with BOX unit type', async () => {
      const res = await service.createTransaction(
        {
          warehouseId: 'w1',
          materialId: 'm1',
          type: 'inbound',
          division: 'healthcare',
          unitType: 'box',
          m: 50,
        },
        staffActor,
      );
      expect(res.division).toBe('healthcare');
      expect(res.unitType).toBe('box');
    });

    it('rejects Healthcare division with PALLET unit type', async () => {
      await expect(
        service.createTransaction(
          {
            warehouseId: 'w1',
            materialId: 'm1',
            type: 'inbound',
            division: 'healthcare',
            unitType: 'pallet',
            m: 50,
          },
          staffActor,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('TRANSACTION DETAILS & PHOTOS', () => {
    it('retrieves complete transaction details with associated photos and presigned URLs', async () => {
      const detail = await service.getTransactionById('tx-1', staffActor);

      expect(detail.id).toBe('tx-1');
      expect(detail.warehouseName).toBe('Maple Ridge');
      expect(detail.materialName).toBe('OCC Cardboard');
      expect(detail.division).toBe('recycling');
      expect(detail.unitType).toBe('pallet');
      expect(detail.weightValue).toBe(3658);
      expect(detail.weightUnit).toBe('kg');
      expect(detail.total).toBe(6);
      expect(detail.creatorName).toBe('Staff Member');
      expect(detail.photos).toHaveLength(1);
      expect(detail.photos[0].url).toContain('signed=true');
    });
  });
});
