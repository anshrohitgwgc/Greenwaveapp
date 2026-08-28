import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Pickup } from './entities/pickup.entity';
import { PickupsController } from './pickups.controller';
import { PickupsService } from './pickups.service';

@Module({
  imports: [TypeOrmModule.forFeature([Pickup])],
  controllers: [PickupsController],
  providers: [PickupsService],
  exports: [TypeOrmModule],
})
export class PickupsModule {}
