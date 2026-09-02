import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Container } from '../inventory/entities/container.entity';
import { InventoryTransaction } from '../inventory/entities/inventory-transaction.entity';
import { WarehousesService } from '../warehouses/warehouses.service';
import { provideDivisionsService } from '../../test/fixtures/divisions-test.helper';
import { Material } from './entities/material.entity';
import { MaterialsService } from './materials.service';

describe('MaterialsService — warehouse & division isolation', () => {
  let service: MaterialsService;
  let materialRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let inventoryTransactionRepo: { count: jest.Mock };
  let containerRepo: { count: jest.Mock };
  let warehousesService: {
    assertWarehouseAccess: jest.Mock;
    resolveWarehouseId: jest.Mock;
    getUserAuthorizedWarehouseIds: jest.Mock;
  };
  let qbAndWhere: jest.Mock;

  const staffActor: AuthenticatedUser = {
    id: 1,
    role: 'staff',
    email: 'staff@example.com',
    fullName: 'Staff',
    warehouseIds: ['maple-ridge'],
    // Holds both divisions: these cases isolate *warehouse* behaviour, so
    // division must not be the thing that fails them. Cross-division denial
    // has its own dedicated cases below.
    divisions: ['greenwave', 'healthcare'],
  };

  beforeEach(async () => {
    qbAndWhere = jest.fn().mockReturnThis();
    materialRepo = {
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve({ ...data, id: 'mat-1' }),
      ),
      findOne: jest.fn().mockResolvedValue({
        id: 'mat-1',
        name: 'Synguard 100',
        division: 'healthcare',
        warehouseId: 'maple-ridge',
        active: true,
      }),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => ({
        andWhere: qbAndWhere,
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    inventoryTransactionRepo = { count: jest.fn().mockResolvedValue(0) };
    containerRepo = { count: jest.fn().mockResolvedValue(0) };

    warehousesService = {
      assertWarehouseAccess: jest.fn().mockResolvedValue(undefined),
      resolveWarehouseId: jest.fn((id: string) => Promise.resolve(id)),
      getUserAuthorizedWarehouseIds: jest
        .fn()
        .mockResolvedValue(['maple-ridge']),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterialsService,
        { provide: getRepositoryToken(Material), useValue: materialRepo },
        {
          provide: getRepositoryToken(InventoryTransaction),
          useValue: inventoryTransactionRepo,
        },
        { provide: getRepositoryToken(Container), useValue: containerRepo },
        { provide: WarehousesService, useValue: warehousesService },
        ...provideDivisionsService({
          1: ['greenwave', 'healthcare'],
        }).providers,
      ],
    }).compile();

    service = module.get(MaterialsService);
  });

  it('checks warehouse authorization before querying (403 on unauthorized warehouse)', async () => {
    warehousesService.assertWarehouseAccess.mockRejectedValueOnce(
      new ForbiddenException('You are not authorized to access this warehouse'),
    );

    await expect(
      service.findAll(staffActor, {
        warehouseId: 'calgary',
        division: 'recycling',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('filters by division when listing materials', async () => {
    await service.findAll(staffActor, {
      warehouseId: 'maple-ridge',
      division: 'healthcare',
    });

    // Division is now matched as a set, so a query for `greenwave` also
    // matches the historical `recycling` storage value.
    expect(qbAndWhere).toHaveBeenCalledWith(
      'm.division IN (:...divisionValues)',
      { divisionValues: ['healthcare'] },
    );
  });

  it('restricts an unfiltered listing to the divisions the actor holds', async () => {
    const greenwaveOnly: AuthenticatedUser = {
      ...staffActor,
      divisions: ['greenwave'],
    };

    await service.findAll(greenwaveOnly, { warehouseId: 'maple-ridge' });

    expect(qbAndWhere).toHaveBeenCalledWith(
      'm.division IN (:...divisionValues)',
      { divisionValues: ['recycling', 'greenwave'] },
    );
  });

  it('returns nothing at all for an actor with no division access', async () => {
    const noDivisions: AuthenticatedUser = { ...staffActor, divisions: [] };

    await expect(
      service.findAll(noDivisions, { warehouseId: 'maple-ridge' }),
    ).resolves.toEqual([]);
  });

  it('rejects a request for a division the actor does not hold (403)', async () => {
    const greenwaveOnly: AuthenticatedUser = {
      ...staffActor,
      divisions: ['greenwave'],
    };

    await expect(
      service.findAll(greenwaveOnly, { division: 'healthcare' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('blocks direct-UUID read of a Healthcare product by a GreenWave-only actor (403)', async () => {
    const greenwaveOnly: AuthenticatedUser = {
      ...staffActor,
      divisions: ['greenwave'],
    };

    // materialRepo.findOne resolves a healthcare product; the warehouse check
    // passes, so only the division boundary can stop this read.
    await expect(service.findOne('mat-1', greenwaveOnly)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('scopes results to global (warehouse-agnostic) or the requested warehouse only', async () => {
    await service.findAll(staffActor, { warehouseId: 'maple-ridge' });

    expect(qbAndWhere).toHaveBeenCalledWith(
      '(m.warehouseId IS NULL OR m.warehouseId = :warehouseId)',
      { warehouseId: 'maple-ridge' },
    );
  });

  it('rejects creating a product in an unauthorized warehouse', async () => {
    warehousesService.assertWarehouseAccess.mockRejectedValueOnce(
      new ForbiddenException('You are not authorized to access this warehouse'),
    );

    await expect(
      service.create(
        {
          name: 'Cardboard',
          division: 'recycling',
          warehouseId: 'calgary',
        },
        staffActor,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('scopes to global + authorized-warehouse products when no warehouseId is requested (no full-catalog leak)', async () => {
    await service.findAll(staffActor, { division: 'recycling' });

    expect(
      warehousesService.getUserAuthorizedWarehouseIds,
    ).toHaveBeenCalledWith(
      staffActor.id,
      staffActor.role,
      staffActor.permissions,
    );
    expect(qbAndWhere).toHaveBeenCalledWith(
      '(m.warehouseId IS NULL OR m.warehouseId IN (:...authorizedIds))',
      { authorizedIds: ['maple-ridge'] },
    );
  });

  it('does not scope by authorized warehouses for a global-access actor with no warehouseId', async () => {
    const globalActor: AuthenticatedUser = {
      ...staffActor,
      hasGlobalAccess: true,
    };

    await service.findAll(globalActor, {});

    expect(
      warehousesService.getUserAuthorizedWarehouseIds,
    ).not.toHaveBeenCalled();
  });

  it('rejects reassigning a product into an unauthorized warehouse on update', async () => {
    warehousesService.assertWarehouseAccess
      .mockResolvedValueOnce(undefined) // access check on the existing warehouse
      .mockRejectedValueOnce(new ForbiddenException('nope')); // access check on the new warehouse

    await expect(
      service.update('mat-1', { warehouseId: 'ontario' }, staffActor),
    ).rejects.toThrow(ForbiddenException);
  });

  describe('findOne — single-record IDOR guard', () => {
    it('returns the material when the actor is authorized for its warehouse', async () => {
      const material = await service.findOne('mat-1', staffActor);

      expect(warehousesService.assertWarehouseAccess).toHaveBeenCalledWith(
        staffActor,
        'maple-ridge',
      );
      expect(material.id).toBe('mat-1');
    });

    it('rejects direct ID access to a material in an unauthorized warehouse (403)', async () => {
      warehousesService.assertWarehouseAccess.mockRejectedValueOnce(
        new ForbiddenException(
          'You are not authorized to access this warehouse',
        ),
      );

      await expect(service.findOne('mat-1', staffActor)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('does not leak material data when access is denied', async () => {
      warehousesService.assertWarehouseAccess.mockRejectedValueOnce(
        new ForbiddenException(
          'You are not authorized to access this warehouse',
        ),
      );

      await expect(service.findOne('mat-1', staffActor)).rejects.toMatchObject({
        response: {
          message: 'You are not authorized to access this warehouse',
        },
      });
    });

    it('allows access to global (warehouse-agnostic) materials regardless of warehouse assignment', async () => {
      materialRepo.findOne.mockResolvedValueOnce({
        id: 'mat-global',
        name: 'Universal Scrap',
        division: 'recycling',
        warehouseId: null,
        active: true,
      });

      const material = await service.findOne('mat-global', staffActor);

      expect(warehousesService.assertWarehouseAccess).toHaveBeenCalledWith(
        staffActor,
        null,
      );
      expect(material.id).toBe('mat-global');
    });

    it('throws NotFoundException before any warehouse check when the material does not exist', async () => {
      materialRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.findOne('missing', staffActor)).rejects.toThrow(
        'Material not found',
      );
      expect(warehousesService.assertWarehouseAccess).not.toHaveBeenCalled();
    });
  });

  describe('remove — safe delete', () => {
    it('deletes a product that has no inventory or container references', async () => {
      await service.remove('mat-1', staffActor);

      expect(inventoryTransactionRepo.count).toHaveBeenCalledWith({
        where: { materialId: 'mat-1' },
      });
      expect(containerRepo.count).toHaveBeenCalledWith({
        where: { materialId: 'mat-1' },
      });
      expect(materialRepo.delete).toHaveBeenCalledWith('mat-1');
    });

    it('checks warehouse authorization before deleting (403 on unauthorized warehouse)', async () => {
      warehousesService.assertWarehouseAccess.mockRejectedValueOnce(
        new ForbiddenException(
          'You are not authorized to access this warehouse',
        ),
      );

      await expect(service.remove('mat-1', staffActor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(materialRepo.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException before any other check when the product does not exist', async () => {
      materialRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.remove('missing', staffActor)).rejects.toThrow(
        'Material not found',
      );
      expect(warehousesService.assertWarehouseAccess).not.toHaveBeenCalled();
      expect(materialRepo.delete).not.toHaveBeenCalled();
    });

    it('rejects deletion with 409 when referenced by inventory_transactions', async () => {
      inventoryTransactionRepo.count.mockResolvedValueOnce(1);

      await expect(service.remove('mat-1', staffActor)).rejects.toThrow(
        ConflictException,
      );
      expect(materialRepo.delete).not.toHaveBeenCalled();
    });

    it('rejects deletion with 409 when referenced by containers', async () => {
      containerRepo.count.mockResolvedValueOnce(1);

      await expect(service.remove('mat-1', staffActor)).rejects.toThrow(
        ConflictException,
      );
      expect(materialRepo.delete).not.toHaveBeenCalled();
    });

    it('surfaces a clear, non-technical reason for the 409', async () => {
      inventoryTransactionRepo.count.mockResolvedValueOnce(1);

      await expect(service.remove('mat-1', staffActor)).rejects.toMatchObject({
        response: {
          message:
            'This product cannot be deleted because it is referenced by existing business records.',
        },
      });
    });
  });
});
