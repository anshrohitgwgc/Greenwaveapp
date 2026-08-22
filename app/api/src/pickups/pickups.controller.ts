import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { PickupsService } from './pickups.service';
import { CreatePickupDto } from './dto/create-pickup.dto';
import { UpdatePickupDto } from './dto/update-pickup.dto';

@Controller('pickups')
export class PickupsController {
  constructor(private readonly pickupsService: PickupsService) {}

  @Post()
  create(@Body() createPickupDto: CreatePickupDto) {
    return this.pickupsService.create(createPickupDto);
  }

  @Get()
  findAll() {
    return this.pickupsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pickupsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePickupDto: UpdatePickupDto) {
    return this.pickupsService.update(+id, updatePickupDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.pickupsService.remove(+id);
  }
}
