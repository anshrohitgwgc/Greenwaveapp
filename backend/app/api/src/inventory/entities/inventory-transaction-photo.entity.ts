import { TIMESTAMP_COLUMN_TYPE } from '../../common/db-types';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'inventory_transaction_photos' })
@Index(['transactionId'])
@Index(['photoId'], { unique: true })
export class InventoryTransactionPhoto {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId: string;

  @Column({ name: 'photo_id', type: 'uuid' })
  photoId: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: TIMESTAMP_COLUMN_TYPE })
  createdAt: Date;
}
