import { IsOptional, IsUUID } from 'class-validator';

export class ClockInDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
