import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, IsNull, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { DivisionsService } from '../divisions/divisions.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { Customer } from './entities/customer.entity';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly warehousesService: WarehousesService,
    private readonly divisionsService: DivisionsService,
  ) {}

  async create(dto: CreateCustomerDto, actor: AuthenticatedUser) {
    if (dto.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        dto.warehouseId,
      );
    }

    // A customer belongs to exactly one division. When the caller does not
    // say which, and they hold exactly one division, that one is used — an
    // unambiguous choice, not a silent default. A caller holding both must
    // state it, and a caller holding none cannot create customers at all.
    const division = await this.resolveCreateDivision(actor, dto.division);

    const customer = this.customerRepository.create({
      id: randomUUID(),
      ...dto,
      division: this.divisionsService.storageValueFor(division),
    });
    return this.customerRepository.save(customer);
  }

  async findAll(
    actor: AuthenticatedUser,
    warehouseId?: string,
    division?: string,
  ) {
    // Warehouse authorization first, so an unauthorized facility is a 403
    // rather than a silently empty list.
    if (warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
    }

    // Division scope is always applied, for every role. Unlike warehouses
    // there is no admin bypass here: an admin still only sees the divisions
    // they have been granted.
    const divisionValues =
      await this.divisionsService.scopeDivisionStorageValues(actor, division);
    if (divisionValues.length === 0) return [];
    const divisionWhere = { division: In(divisionValues) };

    if (warehouseId) {
      return this.customerRepository.find({
        where: { warehouseId, ...divisionWhere },
      });
    }

    // Non-admins only see customers matching their authorized warehouses (or global ones with null warehouseId)
    if (actor.role !== 'admin' && actor.role !== 'owner') {
      const authorizedIds =
        await this.warehousesService.getUserAuthorizedWarehouseIds(
          actor.id,
          actor.role,
          actor.permissions,
        );
      if (authorizedIds.length === 0) {
        return this.customerRepository.find({
          where: { warehouseId: IsNull(), ...divisionWhere },
        });
      }
      return this.customerRepository.find({
        where: [
          { warehouseId: In(authorizedIds), ...divisionWhere },
          { warehouseId: IsNull(), ...divisionWhere },
        ],
      });
    }

    return this.customerRepository.find({ where: divisionWhere });
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const customer = await this.customerRepository.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');

    if (customer.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        customer.warehouseId,
      );
    }
    // Direct-by-UUID access is checked against the stored division, so a
    // known Healthcare customer id is still a 403 for a GreenWave-only user.
    await this.divisionsService.assertStoredDivisionAccess(
      actor,
      customer.division,
    );

    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto, actor: AuthenticatedUser) {
    await this.findOne(id, actor);

    if (dto.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        dto.warehouseId,
      );
    }

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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await this.customerRepository.update(id, {
      ...dto,
      ...(divisionPatch !== undefined ? { division: divisionPatch } : {}),
      updatedBy: actor.id,
    } as any);

    return this.findOne(id, actor);
  }

  private async resolveCreateDivision(
    actor: AuthenticatedUser,
    requested?: string,
  ) {
    if (requested !== undefined && requested !== null && requested !== '') {
      const division = await this.divisionsService.assertDivisionAccess(
        actor,
        requested,
      );
      return division!;
    }

    const held = await this.divisionsService.scopeDivisions(actor);
    if (held.length === 1) return held[0];
    if (held.length === 0) {
      throw new ForbiddenException(
        'You are not authorized to access any business division',
      );
    }
    throw new BadRequestException(
      'division is required: your account has access to more than one business division',
    );
  }
}
