import {
  IsDateString,
  IsIn,
  IsInt,
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
  @IsInt({ message: 'Quantity values must be whole numbers (no decimal fractions)' })
  @Min(0)
  xl?: number;

  @IsOptional()
  @IsInt({ message: 'Quantity values must be whole numbers (no decimal fractions)' })
  @Min(0)
  l?: number;

  @IsOptional()
  @IsInt({ message: 'Quantity values must be whole numbers (no decimal fractions)' })
  @Min(0)
  m?: number;

  @IsOptional()
  @IsInt({ message: 'Quantity values must be whole numbers (no decimal fractions)' })
  @Min(0)
  s?: number;

  @IsOptional()
  @IsInt({ message: 'Quantity values must be whole numbers (no decimal fractions)' })
  @Min(0)
  total?: number;

  @IsOptional()
  @IsIn(['pallet', 'box'], { message: 'unitType must be either pallet or box' })
  unitType?: 'pallet' | 'box';

  @IsOptional()
  @IsIn(['recycling', 'healthcare'], { message: 'division must be either recycling or healthcare' })
  division?: 'recycling' | 'healthcare';

  @IsOptional()
  @IsNumber({}, { message: 'weightValue must be a number' })
  @Min(0)
  weightValue?: number;

  @IsOptional()
  @IsIn(['kg', 'lb'], { message: 'weightUnit must be either kg or lb' })
  weightUnit?: 'kg' | 'lb';

  @IsOptional()
  @IsUUID()
  photoId?: string;

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
