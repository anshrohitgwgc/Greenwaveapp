import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'chat_messages' })
export class ChatMessage {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'sender_id', type: 'int' })
  senderId: number;

  @Column({ name: 'sender_name', type: 'varchar', length: 255 })
  senderName: string;

  @Column({ name: 'sender_role', type: 'varchar', length: 32 })
  senderRole: string;

  @Column({ type: 'text' })
  message: string;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
