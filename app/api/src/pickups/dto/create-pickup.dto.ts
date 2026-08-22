export class CreatePickupDto {
  customerName: string;

  address: string;

  materialType: string;

  estimatedWeight?: number;

  notes?: string;
}
