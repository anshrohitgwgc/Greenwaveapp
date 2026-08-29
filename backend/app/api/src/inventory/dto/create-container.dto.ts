import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateContainerDto {
  @IsUUID()
  warehouseId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  orderNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  blNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  shippingLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  containerNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sealNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  productName?: string;

  @IsOptional()
  @IsUUID()
  materialId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  xl?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  l?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  m?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  s?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  total?: number;

  @IsOptional()
  @IsDateString()
  eta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
