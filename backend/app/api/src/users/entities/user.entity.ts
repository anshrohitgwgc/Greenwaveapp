import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  fullName: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  password: string;

  @Column({
    default: 'staff',
  })
  role: string;

  @Column({
    default: 'active',
  })
  status: string;

  @Column({
    name: 'last_login_at',
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz',
    nullable: true,
  })
  lastLoginAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
