import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { Customer } from './entities/customer.entity';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
  ) {}

  create(dto: CreateCustomerDto, actorId: number) {
    const customer = this.customerRepository.create({
      id: randomUUID(),
      ...dto,
      companyInfo: dto.companyInfo ?? null,
      billTo: dto.billTo ?? null,
      shipTo: dto.shipTo ?? null,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      warehouseId: dto.warehouseId ?? null,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return this.customerRepository.save(customer);
  }

  findAll(warehouseId?: string) {
    if (warehouseId)
      return this.customerRepository.find({ where: { warehouseId } });
    return this.customerRepository.find();
  }

  async findOne(id: string) {
    const customer = await this.customerRepository.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto, actorId: number) {
    await this.findOne(id);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- simple-json column, TypeORM's DeepPartial can't express it precisely
    await this.customerRepository.update(id, {
      ...dto,
      updatedBy: actorId,
    } as any);
    return this.findOne(id);
  }
}
