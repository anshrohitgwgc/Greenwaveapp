import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';

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
      await this.warehousesService.assertWarehouseAccess(actor, dto.warehouseId);
    }

    const customer = this.customerRepository.create({
      id: randomUUID(),
      ...dto,
      companyInfo: dto.companyInfo ?? null,
      billTo: dto.billTo ?? null,
      shipTo: dto.shipTo ?? null,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      warehouseId: dto.warehouseId ?? null,
      createdBy: actor.id,
      updatedBy: actor.id,
    });
    return this.customerRepository.save(customer);
  }

  async findAll(actor: AuthenticatedUser, warehouseId?: string) {
    if (warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
      return this.customerRepository.find({ where: { warehouseId } });
    }

    if (!actor.hasGlobalAccess && (!actor.permissions || !actor.permissions.includes('warehouses:global_access'))) {
      const authorizedIds = await this.warehousesService.getUserAuthorizedWarehouseIds(
        actor.id,
        actor.role,
        actor.permissions,
      );
      if (authorizedIds.length === 0) {
        return this.customerRepository.find({ where: { warehouseId: null as any } });
      }
      return this.customerRepository.find({
        where: [
          { warehouseId: In(authorizedIds) },
          { warehouseId: null as any },
        ],
      });
    }

    return this.customerRepository.find();
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const customer = await this.customerRepository.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');

    if (customer.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, customer.warehouseId);
    }

    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto, actor: AuthenticatedUser) {
    const customer = await this.findOne(id, actor);

    if (dto.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, dto.warehouseId);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await this.customerRepository.update(id, {
      ...dto,
      updatedBy: actor.id,
    } as any);

    return this.findOne(id, actor);
  }
}
