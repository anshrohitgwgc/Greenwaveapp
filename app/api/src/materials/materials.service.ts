import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { Material } from './entities/material.entity';

@Injectable()
export class MaterialsService {
  constructor(
    @InjectRepository(Material)
    private readonly materialRepository: Repository<Material>,
  ) {}

  create(dto: CreateMaterialDto) {
    const material = this.materialRepository.create({
      id: randomUUID(),
      unit: 'kg',
      ...dto,
      defaultPrice: dto.defaultPrice != null ? String(dto.defaultPrice) : null,
    });
    return this.materialRepository.save(material);
  }

  findAll(includeInactive = false) {
    if (includeInactive) return this.materialRepository.find();
    return this.materialRepository.find({ where: { active: true } });
  }

  async findOne(id: string) {
    const material = await this.materialRepository.findOne({ where: { id } });
    if (!material) throw new NotFoundException('Material not found');
    return material;
  }

  async update(id: string, dto: UpdateMaterialDto) {
    await this.findOne(id);
    await this.materialRepository.update(id, {
      ...dto,
      defaultPrice: dto.defaultPrice != null ? String(dto.defaultPrice) : undefined,
    });
    return this.findOne(id);
  }
}
