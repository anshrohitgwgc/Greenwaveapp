import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

  async upload(
    objectKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
  }

  /**
   * Never expose MinIO credentials to the browser — only short-lived signed
   * URLs. Must be returned absolute (scheme + MINIO_ENDPOINT host + port):
   * the signature MinIO validates on GET covers the `host` header
   * (X-Amz-SignedHeaders=host), so stripping or rewriting the host after
   * signing breaks the signature rather than just "hiding" it — the browser
   * would fetch from its own page origin instead of MinIO and get a 404 (or,
   * against a same-host reverse proxy, a 403 SignatureDoesNotMatch). The
   * configured MINIO_ENDPOINT must therefore be a host the browser can
   * actually reach, same as any other asset URL returned to the client.
   */
  async presignedGetUrl(
    objectKey: string,
    expirySeconds = 3600,
  ): Promise<string> {
    return this.client.presignedGetObject(
      this.bucket,
      objectKey,
      expirySeconds,
    );
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey);
  }
}
