import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { DivisionsService } from '../divisions/divisions.service';
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
    private readonly divisionsService: DivisionsService,
  ) {}

  async create(dto: CreateMaterialDto, actor: AuthenticatedUser) {
    await this.warehousesService.assertWarehouseAccess(actor, dto.warehouseId);

    // A product is created *into* a division, so the division must be stated
    // and the actor must hold it. There is no default: creating without a
    // division would otherwise silently mint a GreenWave product, which is
    // exactly the implicit-recycling behaviour this feature removes.
    const division = this.divisionsService.requireValidDivision(dto.division);
    await this.divisionsService.assertDivisionAccess(actor, division);

    const material = this.materialRepository.create({
      id: randomUUID(),
      unit: 'kg',
      ...dto,
      division: this.divisionsService.storageValueFor(division),
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

    // Division scope is resolved server-side from the actor's grants. A
    // caller asking for a division they do not hold gets a 403 from
    // scopeDivisionStorageValues; a caller asking for nothing gets exactly
    // the divisions they do hold — never the whole catalogue.
    const divisionValues =
      await this.divisionsService.scopeDivisionStorageValues(actor, division);
    if (divisionValues.length === 0) {
      return [];
    }
    qb.andWhere('m.division IN (:...divisionValues)', { divisionValues });

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
  // the actor must be authorized for the material's warehouse. Division is
  // now an authorization boundary too, checked against the *stored* row so
  // knowing a Healthcare product's UUID is not enough to read it.
  async findOne(id: string, actor: AuthenticatedUser) {
    const material = await this.findMaterialOrFail(id);
    await this.warehousesService.assertWarehouseAccess(
      actor,
      material.warehouseId,
    );
    await this.divisionsService.assertStoredDivisionAccess(
      actor,
      material.division,
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

    // Same two-sided check for division: the actor must hold the product's
    // current division *and* whatever division they are moving it into, so a
    // product cannot be walked across the boundary one edit at a time.
    await this.divisionsService.assertStoredDivisionAccess(
      actor,
      existing.division,
    );
    let divisionPatch: string | undefined;
    if (dto.division !== undefined) {
      const target = await this.divisionsService.assertDivisionAccess(
        actor,
        dto.division,
      );
      divisionPatch = target
        ? this.divisionsService.storageValueFor(target)
        : undefined;
    }

    await this.materialRepository.update(id, {
      ...dto,
      ...(divisionPatch !== undefined ? { division: divisionPatch } : {}),
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
    // the product's warehouse and its division, not just hold the admin role.
    await this.warehousesService.assertWarehouseAccess(
      actor,
      existing.warehouseId,
    );
    await this.divisionsService.assertStoredDivisionAccess(
      actor,
      existing.division,
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
