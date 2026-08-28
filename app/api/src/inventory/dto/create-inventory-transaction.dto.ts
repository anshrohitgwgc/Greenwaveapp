import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateIf } from 'class-validator';

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

  // Required whenever type === 'adjustment' — enforced again in the
  // service/DB layer, not just here, since a client could omit this check.
  @ValidateIf((dto) => dto.type === 'adjustment')
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  reference?: string;
}
