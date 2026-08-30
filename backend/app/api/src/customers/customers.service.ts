import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, IsNull, Repository } from 'typeorm';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
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
  ) {}

  async create(dto: CreateCustomerDto, actor: AuthenticatedUser) {
    if (dto.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        dto.warehouseId,
      );
    }

    const customer = this.customerRepository.create({
      id: randomUUID(),
      ...dto,
    });
    return this.customerRepository.save(customer);
  }

  async findAll(actor: AuthenticatedUser, warehouseId?: string) {
    if (warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
      return this.customerRepository.find({ where: { warehouseId } });
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
          where: { warehouseId: IsNull() },
        });
      }
      return this.customerRepository.find({
        where: [{ warehouseId: In(authorizedIds) }, { warehouseId: IsNull() }],
      });
    }

    return this.customerRepository.find();
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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await this.customerRepository.update(id, {
      ...dto,
      updatedBy: actor.id,
    } as any);

    return this.findOne(id, actor);
  }
}
