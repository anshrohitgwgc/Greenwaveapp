import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

import { ProformaItemDto } from './proforma-item.dto';

export const VALID_INCOTERMS = [
  'EXW',
  'FCA',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
] as const;

export class CreateProformaInvoiceDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'issueDate must be in YYYY-MM-DD format',
  })
  issueDate: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'validityDate must be in YYYY-MM-DD format',
  })
  validityDate?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  poReference?: string;

  @IsOptional()
  @IsString()
  billTo?: string;

  @IsOptional()
  @IsString()
  shipTo?: string;

  @IsOptional()
  @IsString()
  origin?: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsIn(VALID_INCOTERMS, {
    message: `incoterm must be one of: ${VALID_INCOTERMS.join(', ')}`,
  })
  incoterm?: string;

  @IsOptional()
  @IsString()
  incotermLocation?: string;

  @IsOptional()
  @IsString()
  shippingTerms?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  commercialTerms?: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;

  @IsOptional()
  @IsNumber()
  totalWeight?: number;

  @IsOptional()
  @IsString()
  weightUnit?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProformaItemDto)
  items: ProformaItemDto[];
}
