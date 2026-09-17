import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import sharp from 'sharp';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  ALLOWED_IMAGE_MIME as ALLOWED_MIME,
  MAX_INVENTORY_PHOTOS,
  MAX_UPLOAD_BYTES,
} from '../common/photo-limits';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UploadPhotoMetadataDto } from './dto/upload-photo-metadata.dto';
import { PhotosService } from './photos.service';

@Controller('photos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PhotosController {
  constructor(private readonly photosService: PhotosService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: UploadPhotoMetadataDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException('file is required');
    // FileInterceptor enforces size but not content type — this endpoint
    // otherwise accepted any file (confirmed uploading a .txt during Gate 1
    // staging testing), which is a real stored-content risk (MinIO would
    // happily serve back whatever was uploaded, Content-Type and all).
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        'Only JPEG, PNG or WebP images are accepted',
      );
    }
    return this.photosService.upload(file, meta, actor);
  }

  /**
   * Batch upload — used by the inventory photo picker, which lets an operator
   * attach up to MAX_INVENTORY_PHOTOS images to one entry.
   *
   * `FilesInterceptor` is given the cap as its maxCount, so Multer rejects a
   * 16th part before any of it is buffered; the explicit length check below
   * still runs because maxCount alone would surface as a generic Multer error
   * rather than a message an operator can act on. Every file is validated for
   * content type individually — one bad image fails the whole batch rather
   * than being silently dropped, which is the behaviour the inventory flow
   * needs: a partially-saved photo set is worse than a clear error.
   */
  @Post('batch')
  @UseInterceptors(
    FilesInterceptor('files', MAX_INVENTORY_PHOTOS, {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_INVENTORY_PHOTOS },
    }),
  )
  uploadMany(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() meta: UploadPhotoMetadataDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }
    if (files.length > MAX_INVENTORY_PHOTOS) {
      throw new BadRequestException(
        `A maximum of ${MAX_INVENTORY_PHOTOS} photos can be uploaded at once`,
      );
    }
    const rejected = files.find((f) => !ALLOWED_MIME.has(f.mimetype));
    if (rejected) {
      throw new BadRequestException(
        `Only JPEG, PNG or WebP images are accepted (${rejected.originalname} is ${rejected.mimetype})`,
      );
    }
    return this.photosService.uploadMany(files, meta, actor);
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

  @Get(':id/view')
  async view(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { stream, photo } = await this.photosService.getPhotoStream(
      id,
      actor,
    );
    res.setHeader('Content-Type', photo.mimeType || 'image/jpeg');
    if (photo.sizeBytes) {
      res.setHeader('Content-Length', String(photo.sizeBytes));
    }
    res.setHeader(
      'Cache-Control',
      'private, no-cache, no-store, must-revalidate',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error streaming photo' });
      }
    });
    stream.pipe(res);
  }

  @Get(':id/thumbnail')
  async thumbnail(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { stream, photo } = await this.photosService.getPhotoStream(
      id,
      actor,
    );
    res.setHeader('Content-Type', photo.mimeType || 'image/jpeg');
    res.setHeader(
      'Cache-Control',
      'private, no-cache, no-store, must-revalidate',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    try {
      const transformer = sharp().resize(300, 300, {
        fit: 'inside',
        withoutEnlargement: true,
      });
      if (photo.mimeType === 'image/jpeg') {
        transformer.jpeg({ quality: 80 });
      } else if (photo.mimeType === 'image/webp') {
        transformer.webp({ quality: 80 });
      } else if (photo.mimeType === 'image/png') {
        transformer.png();
      }
      transformer.on('error', () => {
        if (!res.headersSent) {
          stream.pipe(res);
        }
      });
      stream.pipe(transformer).pipe(res);
    } catch {
      stream.pipe(res);
    }
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { stream, photo } = await this.photosService.getPhotoStream(
      id,
      actor,
    );
    const filename = photo.originalFilename || `photo-${photo.id}.jpg`;
    res.setHeader('Content-Type', photo.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    if (photo.sizeBytes) {
      res.setHeader('Content-Length', String(photo.sizeBytes));
    }
    res.setHeader(
      'Cache-Control',
      'private, no-cache, no-store, must-revalidate',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error downloading photo' });
      }
    });
    stream.pipe(res);
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
