import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsOptional } from 'class-validator';

import { CreateProformaInvoiceDto } from './create-proforma-invoice.dto';
import type { ProformaStatus } from '../entities/proforma-invoice.entity';

export class UpdateProformaInvoiceDto extends PartialType(CreateProformaInvoiceDto) {
  @IsOptional()
  @IsIn(['draft', 'sent', 'accepted', 'expired', 'cancelled'], {
    message: 'status must be draft, sent, accepted, expired, or cancelled',
  })
  status?: ProformaStatus;
}
