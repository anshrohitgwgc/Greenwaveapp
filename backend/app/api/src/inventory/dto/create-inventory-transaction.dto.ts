import {
  IsIn,
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
