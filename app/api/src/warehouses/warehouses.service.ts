import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { Warehouse } from './entities/warehouse.entity';

@Injectable()
export class WarehousesService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
  ) {}

  create(dto: CreateWarehouseDto, actorId: number) {
    const warehouse = this.warehouseRepository.create({
      id: randomUUID(),
      ...dto,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return this.warehouseRepository.save(warehouse);
  }

  findAll(includeInactive = false) {
    if (includeInactive) return this.warehouseRepository.find();
    return this.warehouseRepository.find({ where: { active: true } });
  }

  async findOne(id: string) {
    const warehouse = await this.warehouseRepository.findOne({ where: { id } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  async update(id: string, dto: UpdateWarehouseDto, actorId: number) {
    await this.findOne(id);
    await this.warehouseRepository.update(id, { ...dto, updatedBy: actorId });
    return this.findOne(id);
  }
}
