import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import { Material } from './entities/material.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';

export const ONTARIO_WAREHOUSE_ID = '33333333-3333-4333-8333-333333333333';
export const CALGARY_WAREHOUSE_ID = '22222222-2222-4222-8222-222222222222';

export type CopyAction =
  | 'ALREADY PRESENT'
  | 'CREATE WAREHOUSE PRODUCT'
  | 'CREATE ASSOCIATION'
  | 'SKIP INACTIVE'
  | 'CONFLICT'
  | 'NOT VERIFIED';

export interface ProductCopyPreviewItem {
  productId: string;
  productName: string;
  category: string | null;
  unit: string;
  defaultPrice: string | null;
  active: boolean;
  ontarioState: string;
  calgaryState: string;
  actionNeeded: CopyAction;
  notes?: string;
}

export interface CopyPreviewResult {
  sourceWarehouse: { id: string; name: string };
  targetWarehouse: { id: string; name: string };
  items: ProductCopyPreviewItem[];
  summary: {
    totalEvaluated: number;
    alreadyPresent: number;
    toCreate: number;
    skippedInactive: number;
    conflicts: number;
  };
}

export interface CopyExecutionResult {
  preview: CopyPreviewResult;
  createdCount: number;
  createdProducts: Array<{ id: string; name: string; warehouseId: string }>;
  timestamp: string;
}

@Injectable()
export class HealthcareProductCopyService {
  private readonly logger = new Logger(HealthcareProductCopyService.name);

  constructor(
    @InjectRepository(Material)
    private readonly materialRepo: Repository<Material>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
  ) {}

  /**
   * Evaluates all Healthcare products associated with the source warehouse (Ontario)
   * against the target warehouse (Calgary) and produces an auditable preview.
   */
  async preview(
    sourceWarehouseId?: string,
    targetWarehouseId?: string,
  ): Promise<CopyPreviewResult> {
    const warehouses = await this.warehouseRepo.find();
    const resolve = (id: string | undefined, name: RegExp) => {
      const matches = warehouses.filter(w => id ? w.id === id : name.test(w.name));
      if (matches.length !== 1 || !matches[0].active || !name.test(matches[0].name)) {
        throw new BadRequestException('NOT_VERIFIED: select explicit verified Ontario and Calgary warehouse IDs');
      }
      return matches[0].id;
    };
    sourceWarehouseId = resolve(sourceWarehouseId, /ontario/i);
    targetWarehouseId = resolve(targetWarehouseId, /calgary/i);
    const [sourceWh, targetWh] = await Promise.all([
      this.warehouseRepo.findOne({ where: { id: sourceWarehouseId } }),
      this.warehouseRepo.findOne({ where: { id: targetWarehouseId } }),
    ]);

    const sourceName = sourceWh?.name ?? `Warehouse (${sourceWarehouseId})`;
    const targetName = targetWh?.name ?? `Warehouse (${targetWarehouseId})`;

    // All Healthcare products that are either pinned to source warehouse OR global (warehouse_id IS NULL)
    const sourceProducts = await this.materialRepo
      .createQueryBuilder('m')
      .where('m.division = :division', { division: 'healthcare' })
      .andWhere('(m.warehouseId = :sourceWarehouseId OR m.warehouseId IS NULL)', { sourceWarehouseId })
      .orderBy('m.name', 'ASC')
      .getMany();

    // All Healthcare products currently assigned to target warehouse or global
    const targetProducts = await this.materialRepo
      .createQueryBuilder('m')
      .where('m.division = :division', { division: 'healthcare' })
      .andWhere('(m.warehouseId = :targetWarehouseId OR m.warehouseId IS NULL)', { targetWarehouseId })
      .getMany();

    const targetByName = new Map<string, Material>();
    for (const p of targetProducts) {
      targetByName.set(p.name.trim().toLowerCase(), p);
    }

    const items: ProductCopyPreviewItem[] = [];
    let alreadyPresentCount = 0;
    let toCreateCount = 0;
    let skippedInactiveCount = 0;
    let conflictCount = 0;

    for (const sp of sourceProducts) {
      const key = sp.name.trim().toLowerCase();
      const existingInTarget = targetByName.get(key);

      let action: CopyAction;
      let calgaryState: string;
      let notes = '';

      if (!sp.active) {
        action = 'SKIP INACTIVE';
        calgaryState = existingInTarget ? 'Present in Calgary' : 'Not present';
        notes = 'Source product is inactive; will not be copied';
        skippedInactiveCount++;
      } else if (sp.warehouseId === null) {
        // Global product is already available in all warehouses
        action = 'ALREADY PRESENT';
        calgaryState = 'Available (Division-Global)';
        notes = 'Product is global to Healthcare division, already accessible in Calgary';
        alreadyPresentCount++;
      } else if (sourceProducts.filter(p => p.name.trim().toLowerCase() === key).length > 1 ||
        targetProducts.filter(p => p.name.trim().toLowerCase() === key).length > 1 ||
        (existingInTarget && (!existingInTarget.active || existingInTarget.unit !== sp.unit ||
          existingInTarget.category !== sp.category || existingInTarget.description !== sp.description ||
          Number(existingInTarget.defaultPrice) !== Number(sp.defaultPrice)))) {
        action = 'CONFLICT';
        calgaryState = existingInTarget ? `Conflicting target (${existingInTarget.id})` : 'Duplicate source names';
        notes = 'Catalog definitions differ or duplicate names require review';
        conflictCount++;
      } else if (existingInTarget) {
        action = 'ALREADY PRESENT';
        calgaryState = existingInTarget.warehouseId === null
          ? 'Available (Division-Global)'
          : `Present in Calgary (${existingInTarget.id})`;
        notes = 'Product already configured in target warehouse';
        alreadyPresentCount++;
      } else {
        action = 'CREATE WAREHOUSE PRODUCT';
        calgaryState = 'Not present';
        notes = 'Will create new Calgary warehouse-pinned product replicating Ontario specifications';
        toCreateCount++;
      }

      items.push({
        productId: sp.id,
        productName: sp.name,
        category: sp.category,
        unit: sp.unit,
        defaultPrice: sp.defaultPrice,
        active: sp.active,
        ontarioState: sp.warehouseId ? 'Pinned to Ontario' : 'Division-Global',
        calgaryState,
        actionNeeded: action,
        notes,
      });
    }

    return {
      sourceWarehouse: { id: sourceWarehouseId, name: sourceName },
      targetWarehouse: { id: targetWarehouseId, name: targetName },
      items,
      summary: {
        totalEvaluated: items.length,
        alreadyPresent: alreadyPresentCount,
        toCreate: toCreateCount,
        skippedInactive: skippedInactiveCount,
        conflicts: conflictCount,
      },
    };
  }

  /**
   * Idempotently copies active Healthcare products from source warehouse (Ontario)
   * to target warehouse (Calgary).
   *
   * Rules:
   * 1. Ontario products remain unchanged.
   * 2. Only product/material definitions are copied (name, unit, category, description, defaultPrice, active).
   * 3. NO inventory quantities, balances, transactions, or containers are copied.
   * 4. Idempotent: existing target products are skipped.
   */
  async execute(
    sourceWarehouseId?: string,
    targetWarehouseId?: string,
  ): Promise<CopyExecutionResult> {
    return this.materialRepo.manager.transaction(async manager => {
      if (manager.connection.options.type === 'postgres') {
        await manager.query('LOCK TABLE materials IN SHARE ROW EXCLUSIVE MODE');
      }
      const scoped = new HealthcareProductCopyService(manager.getRepository(Material), manager.getRepository(Warehouse));
      return scoped.executeLocked(sourceWarehouseId, targetWarehouseId);
    });
  }

  private async executeLocked(sourceWarehouseId?: string, targetWarehouseId?: string): Promise<CopyExecutionResult> {
    const previewResult = await this.preview(sourceWarehouseId, targetWarehouseId);
    targetWarehouseId = previewResult.targetWarehouse.id;
    if (previewResult.summary.conflicts) throw new BadRequestException('Resolve catalog conflicts before execution');
    const toCreate = previewResult.items.filter((i) => i.actionNeeded === 'CREATE WAREHOUSE PRODUCT');

    const createdProducts: Array<{ id: string; name: string; warehouseId: string }> = [];

    for (const item of toCreate) {
      const source = await this.materialRepo.findOne({ where: { id: item.productId } });
      if (!source) continue;

      // Double-check target existence for strict race/idempotency safety
      const existing = await this.materialRepo
        .createQueryBuilder('m')
        .where('m.division = :division', { division: 'healthcare' })
        .andWhere('LOWER(TRIM(m.name)) = LOWER(TRIM(:name))', { name: source.name })
        .andWhere('(m.warehouseId = :targetWarehouseId OR m.warehouseId IS NULL)', { targetWarehouseId })
        .getOne();

      if (existing) {
        this.logger.log(`Product "${source.name}" already present in target warehouse (${targetWarehouseId}), skipping.`);
        continue;
      }

      const newMaterial = this.materialRepo.create({
        id: randomUUID(),
        name: source.name,
        unit: source.unit,
        category: source.category,
        description: source.description,
        defaultPrice: source.defaultPrice,
        active: true,
        division: 'healthcare',
        warehouseId: targetWarehouseId,
      });

      const saved = await this.materialRepo.save(newMaterial);
      createdProducts.push({ id: saved.id, name: saved.name, warehouseId: targetWarehouseId });
      this.logger.log(`Created Calgary Healthcare product "${saved.name}" (${saved.id})`);
    }

    return {
      preview: previewResult,
      createdCount: createdProducts.length,
      createdProducts,
      timestamp: new Date().toISOString(),
    };
  }
}
