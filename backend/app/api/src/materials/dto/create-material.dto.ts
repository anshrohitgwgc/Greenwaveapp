import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMaterialDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(['recycling', 'healthcare'])
  division: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultPrice?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
