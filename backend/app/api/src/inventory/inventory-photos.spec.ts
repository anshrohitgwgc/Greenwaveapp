import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { MAX_INVENTORY_PHOTOS } from '../common/photo-limits';
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
import { provideDivisionsService } from '../../test/fixtures/divisions-test.helper';

/**
 * Attaching a photo set to an inventory entry.
 *
 * Two things are under test: that all of the photos survive the trip (the
 * original defect dropped everything after the first), and that a caller
 * cannot attach a photo it is not entitled to — the transaction detail view
 * returns attached photos without re-checking each one, so the check has to
 * happen here.
 */
describe('InventoryService — photo attachment', () => {
  let service: InventoryService;
  let transactionRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let photoRepo: {
    createQueryBuilder: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let updateBuilder: Record<string, jest.Mock>;

  const staffActor: AuthenticatedUser = {
    id: 1,
    role: 'staff',
    email: 'staff@example.com',
    fullName: 'Staff',
    warehouseIds: ['w1'],
    divisions: ['greenwave', 'healthcare'],
  };

  const photoId = (n: number) =>
    `3f1f0b1a-0000-4000-8000-${String(n).padStart(12, '0')}`;

  /* Photos owned by the acting user, in this warehouse. */
  const ownedPhotos = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: photoId(i + 1),
      takenBy: staffActor.id,
      warehouseId: 'w1',
      jobReference: null,
    })) as PhotoAsset[];

  const baseDto = {
    warehouseId: 'w1',
    materialId: 'm1',
    type: 'inbound' as const,
    division: 'greenwave' as const,
    unitType: 'pallet' as const,
    orderNumber: 'ORD-100',
    xl: 3,
  };

  beforeEach(async () => {
    updateBuilder = {
      update: jest.fn(),
      set: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    updateBuilder.update.mockReturnValue(updateBuilder);
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);
    updateBuilder.andWhere.mockReturnValue(updateBuilder);

    transactionRepo = {
      create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
      save: jest.fn((d: Record<string, unknown>) =>
        Promise.resolve({ ...d, id: 'tx-1' }),
      ),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    photoRepo = {
      createQueryBuilder: jest.fn(() => updateBuilder),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getRepositoryToken(Container),
          useValue: {
            create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
            save: jest.fn((d: Record<string, unknown>) => Promise.resolve(d)),
            findOne: jest.fn().mockResolvedValue(null),
            createQueryBuilder: jest.fn(() => ({
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            })),
          },
        },
        {
          provide: getRepositoryToken(InventoryTransaction),
          useValue: transactionRepo,
        },
        {
          provide: getRepositoryToken(InventoryBalance),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: getRepositoryToken(Material),
          useValue: { findOne: jest.fn().mockResolvedValue({ id: 'm1' }) },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: getRepositoryToken(Warehouse),
          useValue: { findOne: jest.fn().mockResolvedValue({ id: 'w1' }) },
        },
        { provide: getRepositoryToken(PhotoAsset), useValue: photoRepo },
        { provide: StorageService, useValue: { presignedGetUrl: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
        {
          provide: WarehousesService,
          useValue: {
            assertWarehouseAccess: jest.fn().mockResolvedValue(undefined),
            getUserAuthorizedWarehouseIds: jest.fn().mockResolvedValue(['w1']),
          },
        },
        ...provideDivisionsService({ 1: ['greenwave', 'healthcare'] })
          .providers,
      ],
    }).compile();

    service = module.get(InventoryService);
  });

  const savedTx = () => {
    const calls = transactionRepo.create.mock.calls as Array<
      [Record<string, unknown>]
    >;
    return calls[0][0];
  };

  /* The `In([...])` operator TypeORM builds keeps the id list on `_value`. */
  const photoIdsLookedUp = (): string[] => {
    const calls = photoRepo.find.mock.calls as Array<
      [{ where: { id: { _value: string[] } } }]
    >;
    return calls[0][0].where.id._value;
  };

  it('saves an entry with no photos', async () => {
    await service.createTransaction(baseDto, staffActor);
    expect(savedTx().photoId).toBeNull();
    expect(photoRepo.find).not.toHaveBeenCalled();
  });

  it('keeps all 15 photos and uses the first as the cover', async () => {
    const photos = ownedPhotos(MAX_INVENTORY_PHOTOS);
    photoRepo.find.mockResolvedValue(photos);

    await service.createTransaction(
      { ...baseDto, photoIds: photos.map((p) => p.id) },
      staffActor,
    );

    expect(savedTx().photoId).toBe(photoId(1));
    // All fifteen were looked up — none were discarded before validation.
    expect(photoIdsLookedUp()).toHaveLength(MAX_INVENTORY_PHOTOS);
  });

  it('keeps 2 photos without overwriting the first', async () => {
    const photos = ownedPhotos(2);
    photoRepo.find.mockResolvedValue(photos);

    await service.createTransaction(
      { ...baseDto, photoIds: [photoId(1), photoId(2)] },
      staffActor,
    );

    expect(savedTx().photoId).toBe(photoId(1));
  });

  it('rejects more than the limit instead of truncating', async () => {
    const photos = ownedPhotos(MAX_INVENTORY_PHOTOS + 1);
    photoRepo.find.mockResolvedValue(photos);

    await expect(
      service.createTransaction(
        { ...baseDto, photoIds: photos.map((p) => p.id) },
        staffActor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('de-duplicates a repeated selection', async () => {
    photoRepo.find.mockResolvedValue(ownedPhotos(1));

    await service.createTransaction(
      { ...baseDto, photoIds: [photoId(1), photoId(1), photoId(1)] },
      staffActor,
    );

    expect(photoIdsLookedUp()).toEqual([photoId(1)]);
  });

  it('rejects a photo id that does not exist', async () => {
    photoRepo.find.mockResolvedValue([]);

    await expect(
      service.createTransaction(
        { ...baseDto, photoIds: [photoId(99)] },
        staffActor,
      ),
    ).rejects.toThrow(/Photo not found/);
  });

  it("refuses to attach another user's photo", async () => {
    photoRepo.find.mockResolvedValue([
      { id: photoId(1), takenBy: 999, warehouseId: 'w1' },
    ] as PhotoAsset[]);

    await expect(
      service.createTransaction(
        { ...baseDto, photoIds: [photoId(1)] },
        staffActor,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses to attach a photo from a different warehouse', async () => {
    photoRepo.find.mockResolvedValue([
      { id: photoId(1), takenBy: staffActor.id, warehouseId: 'w2' },
    ] as PhotoAsset[]);

    await expect(
      service.createTransaction(
        { ...baseDto, photoIds: [photoId(1)] },
        staffActor,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('still accepts the legacy single photoId field', async () => {
    photoRepo.find.mockResolvedValue(ownedPhotos(1));

    await service.createTransaction(
      { ...baseDto, photoId: photoId(1) },
      staffActor,
    );

    expect(savedTx().photoId).toBe(photoId(1));
  });

  it('stamps the transaction id on photos that carry no reference of their own', async () => {
    photoRepo.find.mockResolvedValue(ownedPhotos(2));

    await service.createTransaction(
      { ...baseDto, photoIds: [photoId(1), photoId(2)] },
      staffActor,
    );

    expect(updateBuilder.set).toHaveBeenCalledWith({ jobReference: 'tx-1' });
    expect(updateBuilder.where).toHaveBeenCalledWith('id IN (:...photoIds)', {
      photoIds: [photoId(1), photoId(2)],
    });
  });
});
