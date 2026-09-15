import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: Minio.Client;
  private bucket: string;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.bucket =
      this.configService.get<string>('MINIO_BUCKET_NAME') ?? 'greenwave-photos';

    this.client = new Minio.Client({
      endPoint: this.configService.get<string>('MINIO_ENDPOINT') ?? 'localhost',
      port: Number(this.configService.get<string>('MINIO_PORT') ?? 9000),
      useSSL: this.configService.get<string>('MINIO_USE_SSL') === 'true',
      accessKey:
        this.configService.get<string>('MINIO_ACCESS_KEY') ?? 'minioadmin',
      secretKey:
        this.configService.get<string>('MINIO_SECRET_KEY') ?? 'minioadmin123',
    });

    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
      }
      this.logger.log(`MinIO bucket "${this.bucket}" ready`);
    } catch (err) {
      // Don't crash the whole API if MinIO isn't reachable in this
      // environment (e.g. running the DB-only parts locally without the
      // full docker-compose stack) — photo upload endpoints will fail
      // individually with a clear error instead.
      this.logger.warn(`MinIO not reachable at startup: ${err}`);
    }
  }

  getBucketName(): string {
    return this.bucket;
  }

  validateObjectKey(objectKey: string): void {
    if (!objectKey || typeof objectKey !== 'string') {
      throw new BadRequestException('Storage object key is required');
    }
    if (
      objectKey.includes('\\') ||
      objectKey.includes('..') ||
      objectKey.startsWith('/') ||
      objectKey.endsWith('/') ||
      !/^[a-zA-Z0-9_./-]+$/.test(objectKey)
    ) {
      throw new BadRequestException('Invalid storage object key');
    }
  }

  async upload(
    objectKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    this.validateObjectKey(objectKey);
    await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
  }

  async getObject(objectKey: string): Promise<NodeJS.ReadableStream> {
    this.validateObjectKey(objectKey);
    try {
      return await this.client.getObject(this.bucket, objectKey);
    } catch (err: unknown) {
      const code = (err as Record<string, unknown>)?.code;
      if (code === 'NoSuchKey' || code === 'NotFound') {
        throw new NotFoundException('Object not found in storage');
      }
      throw err;
    }
  }

  async statObject(objectKey: string): Promise<Minio.BucketItemStat> {
    this.validateObjectKey(objectKey);
    try {
      return await this.client.statObject(this.bucket, objectKey);
    } catch (err: unknown) {
      const code = (err as Record<string, unknown>)?.code;
      if (code === 'NoSuchKey' || code === 'NotFound') {
        throw new NotFoundException('Object not found in storage');
      }
      throw err;
    }
  }

  async objectExists(objectKey: string): Promise<boolean> {
    try {
      this.validateObjectKey(objectKey);
      await this.client.statObject(this.bucket, objectKey);
      return true;
    } catch {
      return false;
    }
  }

  async presignedGetUrl(
    objectKey: string,
    expirySeconds = 3600,
  ): Promise<string> {
    this.validateObjectKey(objectKey);
    return this.client.presignedGetObject(
      this.bucket,
      objectKey,
      expirySeconds,
    );
  }

  async delete(objectKey: string): Promise<void> {
    this.validateObjectKey(objectKey);
    await this.client.removeObject(this.bucket, objectKey);
  }
}
