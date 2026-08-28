import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StorageModule } from '../storage/storage.module';
import { PhotoAsset } from './entities/photo-asset.entity';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [TypeOrmModule.forFeature([PhotoAsset]), StorageModule],
  controllers: [PhotosController],
  providers: [PhotosService],
  exports: [PhotosService, TypeOrmModule],
})
export class PhotosModule {}
