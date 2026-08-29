import { IsArray, IsUUID } from 'class-validator';

export class AssignWarehousesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  warehouseIds: string[];
}
