import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PurchaseOrderItemDto } from './purchase-order-item.dto';

/** Currencies the PO document can be denominated in. */
export const PURCHASE_ORDER_CURRENCIES = ['USD', 'CAD'] as const;

export class CreatePurchaseOrderDto {
  @IsDateString()
  orderDate: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsIn(PURCHASE_ORDER_CURRENCIES)
  currency?: string;

  @IsString()
  @MinLength(1, { message: 'Supplier name is required' })
  @MaxLength(200)
  supplierName: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  supplierAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierProvince?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  supplierPostalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  supplierPhone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Supplier email must be a valid email address' })
  @MaxLength(200)
  supplierEmail?: string;

  @IsOptional()
  @IsObject()
  companyInfo?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  /** The "Date: ____________" signature line at the foot of the document. */
  @IsOptional()
  @IsDateString()
  footerDate?: string;

  @IsOptional()
  @IsIn(['draft', 'issued', 'closed', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /**
   * Business division. Optional on the wire — an admin holding exactly one
   * division does not restate it — but never defaulted for one holding
   * several; the service returns 400 in that case. Same rule as invoices.
   */
  @IsOptional()
  @IsIn(['greenwave', 'recycling', 'healthcare'])
  division?: string;

  /**
   * At least one line item: a purchase order with nothing on it is not a
   * document anyone can act on. The upper bound keeps a single request from
   * being used to build an unbounded document.
   */
  @IsArray()
  @ArrayMinSize(1, { message: 'A purchase order needs at least one line item' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];

  // NOTE: no `total`, `poNumber` or `sequenceNumber`. The total is recomputed
  // from the items and the number is allocated from a server-side sequence, so
  // none of the three can be influenced by the client.
}
