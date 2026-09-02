import {
  ConflictException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { DIVISION_LABELS, Division } from '../divisions/divisions.constants';
import { DivisionsService } from '../divisions/divisions.service';
import { RolesService } from '../roles/roles.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { User } from './entities/user.entity';
import { AuditService } from '../audit/audit.service';

const BCRYPT_ROUNDS = 12;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @Inject(forwardRef(() => RolesService))
    private rolesService: RolesService,
    @Inject(forwardRef(() => WarehousesService))
    private warehousesService: WarehousesService,
    private readonly divisionsService: DivisionsService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    userData: {
      fullName: string;
      email: string;
      password: string;
      role?: string;
      status?: string;
      warehouseIds?: string[];
      divisions?: string[];
    },
    creatorId?: number,
  ): Promise<User> {
    const email = normalizeEmail(userData.email);
    const existing = await this.usersRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const isAlreadyHashed = userData.password.startsWith('$2');
    const password = isAlreadyHashed
      ? userData.password
      : await bcrypt.hash(userData.password, BCRYPT_ROUNDS);

    const user = this.usersRepository.create({
      fullName: userData.fullName,
      email,
      password,
      role: userData.role ?? 'staff',
      status: userData.status ?? 'active',
    });

    const saved = await this.usersRepository.save(user);

    if (userData.warehouseIds && userData.warehouseIds.length > 0) {
      await this.warehousesService.assignUserWarehouses(
        saved.id,
        userData.warehouseIds,
        creatorId,
      );
    }

    // Division access is only ever created from an explicit list. Omitting
    // `divisions` leaves the account with none, which is the point: a new
    // staff member sees no division-scoped data until an admin grants one.
    if (userData.divisions && userData.divisions.length > 0) {
      await this.divisionsService.assignUserDivisions(
        saved.id,
        userData.divisions,
        creatorId ?? null,
      );
    }

    return saved;
  }

  async recordLogin(userId: number): Promise<void> {
    await this.usersRepository.update(userId, {
      lastLoginAt: new Date(),
    });
  }

  async count(): Promise<number> {
    return this.usersRepository.count();
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({ order: { id: 'ASC' } });
  }

  async findByWarehouse(warehouseId: string): Promise<User[]> {
    const allUsers = await this.findAll();
    const matchingUsers: User[] = [];

    for (const u of allUsers) {
      const perms = await this.rolesService.getPermissionsForRole(u.role);
      const isAuth = await this.warehousesService.isUserAuthorizedForWarehouse(
        u.id,
        u.role,
        warehouseId,
        perms,
      );
      if (isAuth) {
        matchingUsers.push(u);
      }
    }

    return matchingUsers;
  }

  async findOne(id: number): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email: normalizeEmail(email) })
      .getOne();
  }

  async update(
    id: number,
    updates: Partial<Pick<User, 'fullName' | 'email' | 'role' | 'status'>> & {
      warehouseIds?: string[];
      divisions?: string[];
    },
    actorId?: number,
    allowedDivisionsForActor?: Division[],
  ): Promise<User | null> {
    const patch: Partial<User> = {};
    if (updates.fullName !== undefined) patch.fullName = updates.fullName;
    if (updates.email !== undefined)
      patch.email = normalizeEmail(updates.email);
    if (updates.role !== undefined) patch.role = updates.role;
    if (updates.status !== undefined) patch.status = updates.status;

    if (Object.keys(patch).length > 0) {
      await this.usersRepository.update(id, patch);
    }

    if (updates.warehouseIds !== undefined) {
      await this.warehousesService.assignUserWarehouses(
        id,
        updates.warehouseIds,
        actorId,
      );
      // Record audit event for warehouse access update
      await this.auditService.record({
        actorUserId: actorId ?? null,
        actorRole: null,
        action: 'user.warehouse_access_updated',
        entityType: 'user',
        entityId: id.toString(),
        warehouseId: null,
        summary: `Warehouse access updated for user #${id}`,
      });
    }

    if (updates.divisions !== undefined) {
      await this.divisionsService.assignUserDivisions(
        id,
        updates.divisions,
        actorId ?? null,
        allowedDivisionsForActor,
      );
      await this.auditService.record({
        actorUserId: actorId ?? null,
        actorRole: null,
        action: 'user.division_access_updated',
        entityType: 'user',
        entityId: id.toString(),
        warehouseId: null,
        summary: `Division access updated for user #${id} -> [${updates.divisions.join(', ') || 'none'}]`,
      });
    }

    return this.findOne(id);
  }

  async getUserProfile(id: number) {
    const user = await this.findOne(id);
    if (!user) return null;

    const permissions = await this.rolesService.getPermissionsForRole(
      user.role,
    );
    const hasGlobalAccess = permissions.includes('warehouses:global_access');
    const warehouses = await this.warehousesService.getUserAuthorizedWarehouses(
      user.id,
      user.role,
      permissions,
    );
    const divisions = await this.divisionsService.getUserDivisions(user.id);

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status ?? 'active',
      permissions,
      warehouses,
      divisions: divisions.map((key) => ({
        key,
        label: DIVISION_LABELS[key],
      })),
      hasGlobalAccess,
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt,
    };
  }

  async getUserWarehouses(userId: number) {
    return this.warehousesService.getUserWarehouseAccess(userId);
  }

  async getUserDivisions(userId: number) {
    return this.divisionsService.getUserDivisions(userId);
  }

  async assignUserDivisions(
    userId: number,
    divisions: string[],
    actorId: number | null,
    allowedForActor?: Division[],
  ) {
    return this.divisionsService.assignUserDivisions(
      userId,
      divisions,
      actorId,
      allowedForActor,
    );
  }

  async assignUserWarehouses(
    userId: number,
    warehouseIds: string[],
    actorId?: number,
  ) {
    return this.warehousesService.assignUserWarehouses(
      userId,
      warehouseIds,
      actorId,
    );
  }
}
