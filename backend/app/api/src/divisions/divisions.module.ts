import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DivisionsController } from './divisions.controller';
import { DivisionsService } from './divisions.service';
import { UserDivision } from './entities/user-division.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserDivision])],
  controllers: [DivisionsController],
  providers: [DivisionsService],
  exports: [DivisionsService, TypeOrmModule],
})
export class DivisionsModule {}
