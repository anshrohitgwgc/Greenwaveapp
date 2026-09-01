import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Container } from '../inventory/entities/container.entity';
import { InventoryTransaction } from '../inventory/entities/inventory-transaction.entity';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { Material } from './entities/material.entity';

export interface FindMaterialsOptions {
  includeInactive?: boolean;
  warehouseId?: string;
  division?: string;
}

@Injectable()
export class MaterialsService {
  constructor(
    @InjectRepository(Material)
    private readonly materialRepository: Repository<Material>,
    @InjectRepository(InventoryTransaction)
    private readonly inventoryTransactionRepository: Repository<InventoryTransaction>,
    @InjectRepository(Container)
    private readonly containerRepository: Repository<Container>,
    private readonly warehousesService: WarehousesService,
  ) {}

  async create(dto: CreateMaterialDto, actor: AuthenticatedUser) {
    await this.warehousesService.assertWarehouseAccess(actor, dto.warehouseId);

    const material = this.materialRepository.create({
      id: randomUUID(),
      unit: 'kg',
      ...dto,
      defaultPrice: dto.defaultPrice != null ? String(dto.defaultPrice) : null,
    });
    return this.materialRepository.save(material);
  }

  async findAll(actor: AuthenticatedUser, options: FindMaterialsOptions = {}) {
    const { includeInactive = false, warehouseId, division } = options;

    // A caller must be authorized for the warehouse they're asking about -
    // this throws 403 rather than trusting whatever warehouseId was passed.
    await this.warehousesService.assertWarehouseAccess(actor, warehouseId);

    const qb = this.materialRepository.createQueryBuilder('m');

    if (!includeInactive) {
      qb.andWhere('m.active = true');
    }

    if (division) {
      qb.andWhere('m.division = :division', {
        division: division.toLowerCase(),
      });
    }

    if (warehouseId) {
      const resolvedWarehouseId =
        await this.warehousesService.resolveWarehouseId(warehouseId);
      qb.andWhere('(m.warehouseId IS NULL OR m.warehouseId = :warehouseId)', {
        warehouseId: resolvedWarehouseId,
      });
    } else if (
      !actor.hasGlobalAccess &&
      (!actor.permissions ||
        !actor.permissions.includes('warehouses:global_access'))
    ) {
      // No explicit warehouseId was requested - don't fall back to the full
      // catalog, since that would leak warehouse-pinned products from
      // facilities this user has no access to. Scope to global (shared)
      // products plus whatever facilities they're actually authorized for.
      const authorizedIds =
        await this.warehousesService.getUserAuthorizedWarehouseIds(
          actor.id,
          actor.role,
          actor.permissions,
        );
      if (authorizedIds.length === 0) {
        qb.andWhere('m.warehouseId IS NULL');
      } else {
        qb.andWhere(
          '(m.warehouseId IS NULL OR m.warehouseId IN (:...authorizedIds))',
          { authorizedIds },
        );
      }
    }

    qb.orderBy('m.name', 'ASC');
    return qb.getMany();
  }

  private async findMaterialOrFail(id: string) {
    const material = await this.materialRepository.findOne({ where: { id } });
    if (!material) throw new NotFoundException('Material not found');
    return material;
  }

  // Single-record lookup - same warehouse-scoping rule as findAll: a material
  // with no warehouseId is global (shared) and readable by anyone, otherwise
  // the actor must be authorized for the material's warehouse. There is no
  // separate division-level permission in this app; division is a data
  // attribute, not an authorization boundary.
  async findOne(id: string, actor: AuthenticatedUser) {
    const material = await this.findMaterialOrFail(id);
    await this.warehousesService.assertWarehouseAccess(
      actor,
      material.warehouseId,
    );
    return material;
  }

  async update(id: string, dto: UpdateMaterialDto, actor: AuthenticatedUser) {
    const existing = await this.findMaterialOrFail(id);

    // Check access against both the material's current warehouse and the
    // warehouse it's being moved to, so a user can't reassign a product they
    // can see into a warehouse they aren't authorized for (or vice versa).
    await this.warehousesService.assertWarehouseAccess(
      actor,
      existing.warehouseId,
    );
    if (dto.warehouseId !== undefined) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        dto.warehouseId,
      );
    }

    await this.materialRepository.update(id, {
      ...dto,
      defaultPrice:
        dto.defaultPrice != null ? String(dto.defaultPrice) : undefined,
    });
    return this.findMaterialOrFail(id);
  }

  // Safe delete: a product is only removed when nothing depends on it.
  // Referential integrity is checked at the application layer (not just left
  // to the DB's ON DELETE RESTRICT on inventory_transactions) so every
  // reference type gets the same clear 409 rather than a raw DB error, and
  // so containers.material_id (ON DELETE SET NULL) doesn't silently get
  // orphaned by a delete that should have been rejected.
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.findMaterialOrFail(id);

    // Same IDOR guard as findOne/update — a caller must be authorized for
    // the product's warehouse, not just hold the admin role.
    await this.warehousesService.assertWarehouseAccess(
      actor,
      existing.warehouseId,
    );

    const [inventoryReferenceCount, containerReferenceCount] =
      await Promise.all([
        this.inventoryTransactionRepository.count({
          where: { materialId: id },
        }),
        this.containerRepository.count({ where: { materialId: id } }),
      ]);

    if (inventoryReferenceCount > 0 || containerReferenceCount > 0) {
      throw new ConflictException(
        'This product cannot be deleted because it is referenced by existing business records.',
      );
    }

    await this.materialRepository.delete(id);
  }
}
