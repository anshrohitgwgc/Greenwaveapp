import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UploadPhotoMetadataDto } from './dto/upload-photo-metadata.dto';
import { PhotosService } from './photos.service';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

@Controller('photos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PhotosController {
  constructor(private readonly photosService: PhotosService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: UploadPhotoMetadataDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.photosService.upload(file, meta, actor);
  }

  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('customerId') customerId?: string,
    @Query('jobReference') jobReference?: string,
    @Query('photoType') photoType?: string,
  ) {
    return this.photosService.list(actor, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      userId: userId ? Number(userId) : undefined,
      warehouseId,
      customerId,
      jobReference,
      photoType,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.photosService.findOneAuthorized(id, actor);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.photosService.remove(id, actor);
  }
}
