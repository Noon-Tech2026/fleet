import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Ecriture manuelle au journal d'un client. Les voyages ne sont pas copies ici :
 * le releve les lit directement (debit automatique), ces lignes s'y ajoutent.
 */
@Entity({ name: 'client_entries' })
export class ClientEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'client_id', length: 36 })
  clientId: string;

  @Column({ type: 'varchar', length: 8 })
  kind: 'debit' | 'credit';

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'datetime' })
  at: Date;

  @Column({ type: 'varchar', length: 160 })
  label: string;

  @Column({ name: 'created_by', length: 190 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
