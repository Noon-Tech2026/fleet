import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Versement : retrait de tresorerie par les associes / la direction. Sort de la caisse. */
@Entity({ name: 'versements' })
export class Versement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Index()
  @Column({ type: 'datetime' })
  at: Date;

  /** Beneficiaire / motif. */
  @Column({ type: 'varchar', length: 160 })
  label: string;

  @Column({ name: 'created_by', length: 190 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
