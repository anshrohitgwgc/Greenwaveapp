import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { WarehousesService } from '../warehouses/warehouses.service';
import { Material } from './entities/material.entity';
import { MaterialsService } from './materials.service';

describe('MaterialsService — warehouse & division isolation', () => {
  let service: MaterialsService;
  let materialRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
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
      createQueryBuilder: jest.fn(() => ({
        andWhere: qbAndWhere,
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

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
        { provide: WarehousesService, useValue: warehousesService },
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

    expect(qbAndWhere).toHaveBeenCalledWith('m.division = :division', {
      division: 'healthcare',
    });
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
});
