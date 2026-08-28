import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'photos' })
export class PhotoAsset {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'object_key', type: 'varchar', length: 500 })
  objectKey: string;

  @Column({ name: 'bucket_name', type: 'varchar', length: 255 })
  bucketName: string;

  @Column({ name: 'original_filename', type: 'varchar', length: 255 })
  originalFilename: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes: number;

  @Index()
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({
    name: 'job_reference',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  jobReference: string | null;

  @Index()
  @Column({ name: 'photo_type', type: 'varchar', length: 50, nullable: true })
  photoType: string | null;

  @Index()
  @Column({ name: 'taken_by', type: 'int' })
  takenBy: number;

  @Column({ name: 'taken_at', type: 'timestamptz' })
  takenAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
