import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

import { InvoiceItemDto } from './invoice-item.dto';

export class CreateInvoiceDto {
  @IsDateString()
  invoiceDate: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsObject()
  companyInfo?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  billTo?: string;

  @IsOptional()
  @IsString()
  shipTo?: string;

  @IsOptional()
  @IsString()
  poReference?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  shipVia?: string;

  @IsOptional()
  @IsDateString()
  shipDate?: string;

  @IsOptional()
  @IsString()
  taxLabel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  terms?: string;

  @IsOptional()
  @IsString()
  footer?: string;

  @IsOptional()
  @IsString()
  paymentInstructions?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /**
   * Business division. Optional on the wire — a user holding exactly one
   * division does not restate it — but never defaulted for a user holding
   * several; the service returns 400 in that case.
   */
  @IsOptional()
  @IsIn(['greenwave', 'recycling', 'healthcare'])
  division?: string;

  /**
   * Document status a client may request: draft, final (issued), or void.
   * 'paid' is accepted only as an unchanged echo of the current value — an
   * invoice becomes paid solely through a verified payment.
   */
  @IsOptional()
  @IsIn(['draft', 'final', 'paid', 'void'])
  status?: string;

  @IsOptional()
  @IsIn(['CAD', 'USD'])
  currency?: string;

  /**
   * Accepted for backward compatibility with existing clients that echo the
   * field, and IGNORED: payment status is server-owned (webhooks only).
   */
  @IsOptional()
  @IsIn(['unpaid', 'pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'disputed'])
  paymentStatus?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];
}
