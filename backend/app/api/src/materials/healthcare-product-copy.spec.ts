import { DataSource, Repository } from 'typeorm';
import {
  HealthcareProductCopyService,
  ONTARIO_WAREHOUSE_ID,
  CALGARY_WAREHOUSE_ID,
} from './healthcare-product-copy.service';
import { Material } from './entities/material.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { InventoryTransaction } from '../inventory/entities/inventory-transaction.entity';
import { Container } from '../inventory/entities/container.entity';
import { User } from '../users/entities/user.entity';

describe('HealthcareProductCopyService (Workstream 2)', () => {
  let dataSource: DataSource;
  let materialRepo: Repository<Material>;
  let warehouseRepo: Repository<Warehouse>;
  let service: HealthcareProductCopyService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      dropSchema: true,
      entities: [Material, Warehouse, InventoryTransaction, Container, User],
      synchronize: true,
    });
    await dataSource.initialize();

    materialRepo = dataSource.getRepository(Material);
    warehouseRepo = dataSource.getRepository(Warehouse);
    service = new HealthcareProductCopyService(materialRepo, warehouseRepo);

    // Seed Warehouses
    await warehouseRepo.save([
      {
        id: CALGARY_WAREHOUSE_ID,
        name: 'Calgary',
        code: 'CGY',
        province: 'AB',
        active: true,
      },
      {
        id: ONTARIO_WAREHOUSE_ID,
        name: 'Ontario',
        code: 'ON',
        province: 'ON',
        active: true,
      },
    ]);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await materialRepo.clear();
  });

  it('produces an accurate preview classifying products correctly', async () => {
    // 1. Pinned to Ontario, active (needs copy to Calgary)
    await materialRepo.save({
      id: 'd1000000-0004-4000-8000-000000000004',
      name: 'Ontario Isolation Gowns',
      unit: 'box',
      category: 'healthcare',
      description: 'Level 2 disposable isolation gowns',
      defaultPrice: '41.0000',
      active: true,
      division: 'healthcare',
      warehouseId: ONTARIO_WAREHOUSE_ID,
    });

    // 2. Pinned to Ontario, inactive (should be skipped)
    await materialRepo.save({
      id: 'd1000000-0004-4000-8000-000000000005',
      name: 'Ontario Discontinued Gloves',
      unit: 'box',
      category: 'healthcare',
      description: 'Discontinued product',
      defaultPrice: '20.0000',
      active: false,
      division: 'healthcare',
      warehouseId: ONTARIO_WAREHOUSE_ID,
    });

    // 3. Division-global Healthcare product (already present in Calgary)
    await materialRepo.save({
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Synguard 100',
      unit: 'cases',
      category: 'healthcare',
      description: 'Nitrile exam gloves',
      defaultPrice: '45.0000',
      active: true,
      division: 'healthcare',
      warehouseId: null, // Global
    });

    // 4. Product already present in Calgary
    await materialRepo.save({
      id: 'd1000000-0002-4000-8000-000000000002',
      name: 'Calgary Nitrile Gloves',
      unit: 'box',
      category: 'healthcare',
      description: 'Pre-existing Calgary stock',
      defaultPrice: '28.5000',
      active: true,
      division: 'healthcare',
      warehouseId: CALGARY_WAREHOUSE_ID,
    });

    const preview = await service.preview();

    expect(preview.summary.totalEvaluated).toBe(3); // The 3 that are in Ontario (2 pinned + 1 global)
    expect(preview.summary.toCreate).toBe(1); // 'Ontario Isolation Gowns'
    expect(preview.summary.skippedInactive).toBe(1); // 'Ontario Discontinued Gloves'
    expect(preview.summary.alreadyPresent).toBe(1); // 'Synguard 100' (global)

    const gowns = preview.items.find((i) => i.productName === 'Ontario Isolation Gowns');
    expect(gowns).toBeDefined();
    expect(gowns?.actionNeeded).toBe('CREATE WAREHOUSE PRODUCT');
    expect(gowns?.calgaryState).toBe('Not present');

    const globalProd = preview.items.find((i) => i.productName === 'Synguard 100');
    expect(globalProd).toBeDefined();
    expect(globalProd?.actionNeeded).toBe('ALREADY PRESENT');
    expect(globalProd?.calgaryState).toBe('Available (Division-Global)');

    const inactiveProd = preview.items.find((i) => i.productName === 'Ontario Discontinued Gloves');
    expect(inactiveProd).toBeDefined();
    expect(inactiveProd?.actionNeeded).toBe('SKIP INACTIVE');
  });

  it('copies products to Calgary while leaving Ontario completely intact and unaffected', async () => {
    const ontarioGownsId = 'd1000000-0004-4000-8000-000000000004';
    await materialRepo.save({
      id: ontarioGownsId,
      name: 'Ontario Isolation Gowns',
      unit: 'box',
      category: 'healthcare',
      description: 'Level 2 disposable isolation gowns',
      defaultPrice: '41.0000',
      active: true,
      division: 'healthcare',
      warehouseId: ONTARIO_WAREHOUSE_ID,
    });

    const result = await service.execute();
    expect(result.createdCount).toBe(1);
    expect(result.createdProducts[0].name).toBe('Ontario Isolation Gowns');
    expect(result.createdProducts[0].warehouseId).toBe(CALGARY_WAREHOUSE_ID);

    // Verify Ontario product was NOT mutated or moved
    const ontarioProduct = await materialRepo.findOne({ where: { id: ontarioGownsId } });
    expect(ontarioProduct).toBeDefined();
    expect(ontarioProduct?.warehouseId).toBe(ONTARIO_WAREHOUSE_ID);
    expect(ontarioProduct?.active).toBe(true);
    expect(ontarioProduct?.name).toBe('Ontario Isolation Gowns');

    // Verify Calgary product was created with identical catalog spec
    const calgaryProduct = await materialRepo.findOne({
      where: {
        warehouseId: CALGARY_WAREHOUSE_ID,
        name: 'Ontario Isolation Gowns',
      },
    });
    expect(calgaryProduct).toBeDefined();
    expect(calgaryProduct?.id).not.toBe(ontarioGownsId);
    expect(calgaryProduct?.unit).toBe('box');
    expect(calgaryProduct?.category).toBe('healthcare');
    expect(calgaryProduct?.description).toBe('Level 2 disposable isolation gowns');
    expect(Number(calgaryProduct?.defaultPrice)).toBe(41);
    expect(calgaryProduct?.division).toBe('healthcare');
    expect(calgaryProduct?.active).toBe(true);
  });

  it('is completely idempotent when executed multiple times', async () => {
    await materialRepo.save({
      id: 'd1000000-0004-4000-8000-000000000004',
      name: 'Ontario Isolation Gowns',
      unit: 'box',
      category: 'healthcare',
      description: 'Level 2 disposable isolation gowns',
      defaultPrice: '41.0000',
      active: true,
      division: 'healthcare',
      warehouseId: ONTARIO_WAREHOUSE_ID,
    });

    // Run 1: Should create 1 product
    const run1 = await service.execute();
    expect(run1.createdCount).toBe(1);

    // Run 2: Should create 0 products (idempotent)
    const run2 = await service.execute();
    expect(run2.createdCount).toBe(0);

    // Total products in database should be exactly 2 (1 Ontario + 1 Calgary)
    const allGowns = await materialRepo.find({ where: { name: 'Ontario Isolation Gowns' } });
    expect(allGowns).toHaveLength(2);

    const ontarioCount = allGowns.filter((g) => g.warehouseId === ONTARIO_WAREHOUSE_ID).length;
    const calgaryCount = allGowns.filter((g) => g.warehouseId === CALGARY_WAREHOUSE_ID).length;
    expect(ontarioCount).toBe(1);
    expect(calgaryCount).toBe(1);
  });

  it('does NOT copy inventory transactions or balances', async () => {
    const ontarioGownsId = 'd1000000-0004-4000-8000-000000000004';
    await materialRepo.save({
      id: ontarioGownsId,
      name: 'Ontario Isolation Gowns',
      unit: 'box',
      category: 'healthcare',
      description: 'Level 2 disposable isolation gowns',
      defaultPrice: '41.0000',
      active: true,
      division: 'healthcare',
      warehouseId: ONTARIO_WAREHOUSE_ID,
    });

    const txRepo = dataSource.getRepository(InventoryTransaction);
    await txRepo.save({
      id: '99999999-0000-4000-8000-000000000001',
      warehouseId: ONTARIO_WAREHOUSE_ID,
      materialId: ontarioGownsId,
      type: 'inbound',
      total: '500.000',
      createdBy: 1,
    });

    await service.execute();

    // Verify no transactions were created for Calgary
    const calgaryTxs = await txRepo.find({ where: { warehouseId: CALGARY_WAREHOUSE_ID } });
    expect(calgaryTxs).toHaveLength(0);

    // Verify Ontario transactions untouched
    const ontarioTxs = await txRepo.find({ where: { warehouseId: ONTARIO_WAREHOUSE_ID } });
    expect(ontarioTxs).toHaveLength(1);
    expect(Number(ontarioTxs[0].total)).toBe(500);
  });
  it('blocks missing warehouse identities', async () => {
    await expect(service.preview('ffffffff-ffff-4fff-8fff-ffffffffffff', CALGARY_WAREHOUSE_ID)).rejects.toThrow('NOT_VERIFIED');
  });
  it('classifies differing target definitions as conflicts and refuses execution', async () => {
    await materialRepo.save([
      { id: 'd1000000-0004-4000-8000-000000000090', name: 'Conflict product', unit: 'box', division: 'healthcare', warehouseId: ONTARIO_WAREHOUSE_ID, active: true },
      { id: 'd1000000-0004-4000-8000-000000000091', name: 'Conflict product', unit: 'kg', division: 'healthcare', warehouseId: CALGARY_WAREHOUSE_ID, active: true },
    ]);
    expect((await service.preview()).items[0].actionNeeded).toBe('CONFLICT');
    await expect(service.execute()).rejects.toThrow('Resolve catalog conflicts');
    expect(await materialRepo.count()).toBe(2);
  });

});
