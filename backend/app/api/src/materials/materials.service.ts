import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
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

  async findOne(id: string) {
    const material = await this.materialRepository.findOne({ where: { id } });
    if (!material) throw new NotFoundException('Material not found');
    return material;
  }

  async update(id: string, dto: UpdateMaterialDto, actor: AuthenticatedUser) {
    const existing = await this.findOne(id);

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
    return this.findOne(id);
  }
}
