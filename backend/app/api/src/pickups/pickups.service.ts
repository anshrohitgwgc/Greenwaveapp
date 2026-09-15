import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Pickup } from './entities/pickup.entity';
import { CreatePickupDto } from './dto/create-pickup.dto';
import { UpdatePickupDto } from './dto/update-pickup.dto';

@Injectable()
export class PickupsService {
  constructor(
    @InjectRepository(Pickup)
    private pickupRepository: Repository<Pickup>,
  ) {}

  create(createPickupDto: CreatePickupDto) {
    const pickup = this.pickupRepository.create({
      ...createPickupDto,
      status: 'pending',
    });

    return this.pickupRepository.save(pickup);
  }

  findAll() {
    return this.pickupRepository.find();
  }

  findOne(id: number) {
    return this.pickupRepository.findOne({
      where: { id },
    });
  }

  update(id: number, updatePickupDto: UpdatePickupDto) {
    return this.pickupRepository.update(id, updatePickupDto);
  }

  remove(id: number) {
    return this.pickupRepository.delete(id);
  }
}
