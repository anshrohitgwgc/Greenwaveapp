import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post('render-pdf')
  async renderPdf(
    @Body() body: { html: string; invoiceNumber?: string },
    @Res() res: any,
  ) {
    if (!body || !body.html) {
      throw new BadRequestException('html is required for PDF rendering');
    }
    const pdfBuffer = await this.invoicesService.generatePdf(body.html);
    const safeNumber = body.invoiceNumber
      ? String(body.invoiceNumber).replace(/[^A-Za-z0-9._-]/g, '')
      : 'Invoice';
    const filename = `${safeNumber}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  }

  @Post()
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.invoicesService.create(dto, actor);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.invoicesService.duplicate(id, actor);
  }

  @Get()
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('customerId') customerId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
    @Query('division') division?: string,
  ) {
    return this.invoicesService.findAll(actor, {
      customerId,
      warehouseId,
      status,
      division,
    });
  }

  /**
   * Preview of the next invoice number for the editor's "(Assigned)" hint.
   * Declared before @Get(':id') so Nest does not route it as an invoice id.
   */
  @Get('next-number')
  nextNumber() {
    return this.invoicesService.peekNextInvoiceNumber();
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.invoicesService.findOne(id, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.invoicesService.update(id, dto, actor);
  }
}
