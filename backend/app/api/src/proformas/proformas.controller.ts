import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RecyclingFinanceGuard } from '../common/guards/recycling-finance.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { UpdateProformaInvoiceDto } from './dto/update-proforma-invoice.dto';
import { ProformasService } from './proformas.service';
import type { ProformaStatus } from './entities/proforma-invoice.entity';

@Controller('proformas')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, RecyclingFinanceGuard)
@Roles('admin', 'manager', 'staff')
export class ProformasController {
  constructor(private readonly proformasService: ProformasService) {}

  @Get('peek-number')
  peekNumber() {
    return this.proformasService.peekNextNumber();
  }

  @Post()
  @Roles('admin', 'manager')
  create(
    @Body() dto: CreateProformaInvoiceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.proformasService.create(dto, actor);
  }

  @Get()
  findAll(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('status') status?: ProformaStatus,
    @Query('warehouseId') warehouseId?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
  ) {
    return this.proformasService.findAll(actor, {
      status,
      warehouseId,
      customerId,
      search,
    });
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.proformasService.findOne(id, actor);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProformaInvoiceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.proformasService.update(id, dto, actor);
  }

  @Post(':id/convert')
  @Roles('admin', 'manager')
  convert(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.proformasService.convert(id, actor);
  }

  @Get(':id/pdf')
  async renderPdf(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const proforma = await this.proformasService.findOne(id, actor);
    const pdfBuffer = await this.proformasService.renderPdf(id, actor);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${proforma.proformaNumber}.pdf"`,
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'manager')
  send(
    @Param('id') id: string,
    @Body('email') email: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.proformasService.sendEmail(id, email, actor);
  }
}
