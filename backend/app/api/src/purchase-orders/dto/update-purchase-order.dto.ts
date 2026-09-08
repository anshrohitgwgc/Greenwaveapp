import { PartialType } from '@nestjs/mapped-types';

import { CreatePurchaseOrderDto } from './create-purchase-order.dto';

/**
 * Every create field is editable on update *except* the document number,
 * which CreatePurchaseOrderDto does not carry in the first place — so a PATCH
 * can never renumber a saved purchase order.
 */
export class UpdatePurchaseOrderDto extends PartialType(
  CreatePurchaseOrderDto,
) {}
