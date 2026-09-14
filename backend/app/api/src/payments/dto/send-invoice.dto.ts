import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class SendInvoiceDto {
  /** Defaults to the customer's email on file. */
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customMessage?: string;

  /**
   * The rendered invoice document (same HTML the authenticated manager's
   * browser already sends to POST /invoices/render-pdf), converted to the PDF
   * attachment server-side.
   */
  @IsString()
  @MaxLength(2_000_000)
  documentHtml: string;

  /** Client-generated per send action; a retried request does not email twice. */
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{8,128}$/)
  idempotencyKey?: string;
}
