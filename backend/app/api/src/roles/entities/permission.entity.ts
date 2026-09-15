import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'permissions' })
export class Permission {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  key: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}
