import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Ecriture manuelle du journal de caisse (debit = entree, credit = sortie). */
@Entity({ name: 'cash_entries' })
export class CashEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 8 })
  kind: 'debit' | 'credit';

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Index()
  @Column({ type: 'datetime' })
  at: Date;

  @Column({ type: 'varchar', length: 160 })
  label: string;

  @Column({ name: 'created_by', length: 190 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
