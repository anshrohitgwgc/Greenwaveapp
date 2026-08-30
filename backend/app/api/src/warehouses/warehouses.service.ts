import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { UserWarehouse } from './entities/user-warehouse.entity';
import { Warehouse } from './entities/warehouse.entity';

@Injectable()
export class WarehousesService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
    @InjectRepository(UserWarehouse)
    private readonly userWarehouseRepository: Repository<UserWarehouse>,
  ) {}

  async create(dto: CreateWarehouseDto, actorId: number) {
    const warehouse = this.warehouseRepository.create({
      id: randomUUID(),
      ...dto,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return this.warehouseRepository.save(warehouse);
  }

  async findAll(includeInactive = false): Promise<Warehouse[]> {
    if (includeInactive) {
      return this.warehouseRepository.find({ order: { name: 'ASC' } });
    }
    return this.warehouseRepository.find({
      where: { active: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Warehouse> {
    const warehouse = await this.warehouseRepository.findOne({ where: { id } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  async update(id: string, dto: UpdateWarehouseDto, actorId: number) {
    await this.findOne(id);
    await this.warehouseRepository.update(id, { ...dto, updatedBy: actorId });
    return this.findOne(id);
  }

  async isUserAuthorizedForWarehouse(
    userId: number,
    role: string,
    warehouseId: string,
    permissions?: string[],
  ): Promise<boolean> {
    if (!warehouseId) return true;

    // Check if user has global warehouse access permission
    if (permissions && permissions.includes('warehouses:global_access')) {
      return true;
    }

    // Check membership in user_warehouses join table
    const membership = await this.userWarehouseRepository.findOne({
      where: { userId, warehouseId },
    });

    return !!membership;
  }

  async getUserAuthorizedWarehouseIds(
    userId: number,
    role: string,
    permissions?: string[],
  ): Promise<string[]> {
    if (permissions && permissions.includes('warehouses:global_access')) {
      const allActive = await this.findAll(false);
      return allActive.map((w) => w.id);
    }

    const memberships = await this.userWarehouseRepository.find({
      where: { userId },
    });

    return memberships.map((m) => m.warehouseId);
  }

  async getUserAuthorizedWarehouses(
    userId: number,
    role: string,
    permissions?: string[],
    includeInactive = false,
  ): Promise<Warehouse[]> {
    if (permissions && permissions.includes('warehouses:global_access')) {
      return this.findAll(includeInactive);
    }

    const memberships = await this.userWarehouseRepository.find({
      where: { userId },
    });

    if (memberships.length === 0) {
      return [];
    }

    const warehouseIds = memberships.map((m) => m.warehouseId);
    return this.warehouseRepository.find({
      where: {
        id: In(warehouseIds),
        ...(includeInactive ? {} : { active: true }),
      },
      order: { name: 'ASC' },
    });
  }

  async resolveWarehouseId(idOrCode: string): Promise<string> {
    if (!idOrCode) return idOrCode;
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(idOrCode)) {
      return idOrCode;
    }
    const found = await this.warehouseRepository
      .createQueryBuilder('w')
      .where('LOWER(w.code) = LOWER(:code)', { code: idOrCode })
      .orWhere('LOWER(w.name) LIKE LOWER(:name)', { name: `%${idOrCode}%` })
      .getOne();
    return found ? found.id : idOrCode;
  }

  async assertWarehouseAccess(
    actor: AuthenticatedUser,
    warehouseId?: string | null,
  ): Promise<void> {
    if (!warehouseId) {
      return;
    }

    const resolvedId = await this.resolveWarehouseId(warehouseId);
    const authorized = await this.isUserAuthorizedForWarehouse(
      actor.id,
      actor.role,
      resolvedId,
      actor.permissions,
    );

    if (!authorized) {
      throw new ForbiddenException(
        'You are not authorized to access this warehouse',
      );
    }
  }

  async getWarehouseUsers(warehouseId: string): Promise<any[]> {
    const resolvedId = await this.resolveWarehouseId(warehouseId);
    const memberships = await this.userWarehouseRepository.find({
      where: { warehouseId: resolvedId },
    });
    return memberships.map((m) => ({
      userId: m.userId,
      warehouseId: m.warehouseId,
    }));
  }

  async getUserWarehouseAccess(userId: number): Promise<Warehouse[]> {
    const memberships = await this.userWarehouseRepository.find({
      where: { userId },
    });

    if (memberships.length === 0) {
      return [];
    }

    const warehouseIds = memberships.map((m) => m.warehouseId);
    return this.warehouseRepository.find({
      where: { id: In(warehouseIds) },
      order: { name: 'ASC' },
    });
  }

  async assignUserWarehouses(
    userId: number,
    warehouseIds: string[],
    actorId?: number,
  ): Promise<Warehouse[]> {
    // Delete existing assignments
    await this.userWarehouseRepository.delete({ userId });

    if (warehouseIds && warehouseIds.length > 0) {
      // Deduplicate warehouse IDs
      const uniqueIds = Array.from(new Set(warehouseIds));
      const entities = uniqueIds.map((whId) =>
        this.userWarehouseRepository.create({
          id: randomUUID(),
          userId,
          warehouseId: whId,
          createdBy: actorId ?? null,
        }),
      );
      await this.userWarehouseRepository.save(entities);
    }

    return this.getUserWarehouseAccess(userId);
  }
}
