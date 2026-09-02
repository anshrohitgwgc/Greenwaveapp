import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateInventoryTransactionDto {
  @IsUUID()
  warehouseId: string;

  @IsUUID()
  materialId: string;

  @IsOptional()
  @IsUUID()
  containerId?: string;

  @IsIn(['inbound', 'outbound', 'adjustment'])
  type: 'inbound' | 'outbound' | 'adjustment';

  @IsOptional()
  @IsInt({
    message: 'Quantity values must be whole numbers (no decimal fractions)',
  })
  @Min(0)
  xl?: number;

  @IsOptional()
  @IsInt({
    message: 'Quantity values must be whole numbers (no decimal fractions)',
  })
  @Min(0)
  l?: number;

  @IsOptional()
  @IsInt({
    message: 'Quantity values must be whole numbers (no decimal fractions)',
  })
  @Min(0)
  m?: number;

  @IsOptional()
  @IsInt({
    message: 'Quantity values must be whole numbers (no decimal fractions)',
  })
  @Min(0)
  s?: number;

  @IsOptional()
  @IsIn(['pallet', 'box'], { message: 'unitType must be either pallet or box' })
  unitType?: 'pallet' | 'box';

  @IsOptional()
  @IsIn(['greenwave', 'recycling', 'healthcare'], {
    message: 'division must be either greenwave (recycling) or healthcare',
  })
  division?: 'greenwave' | 'recycling' | 'healthcare';

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

  // Required whenever type === 'adjustment' — enforced again in service/DB
  @ValidateIf((dto: CreateInventoryTransactionDto) => dto.type === 'adjustment')
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  orderNumber?: string;

  @IsOptional()
  @IsString()
  containerNumber?: string;

  @IsOptional()
  @IsString()
  sealNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
