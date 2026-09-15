import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'roles' })
export class Role {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}
