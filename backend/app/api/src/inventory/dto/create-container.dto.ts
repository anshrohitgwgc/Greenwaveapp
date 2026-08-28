import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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
  @IsDateString()
  eta?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
