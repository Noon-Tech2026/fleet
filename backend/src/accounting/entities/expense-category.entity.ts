import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Catalogue des categories de charges, gere par l'administrateur. */
@Entity({ name: 'expense_categories' })
export class ExpenseCategory {
  /** Identifiant stable (slug) stocke sur les charges. */
  @PrimaryColumn({ length: 32 })
  id: string;

  @Column({ name: 'label_fr', length: 80 })
  labelFr: string;

  @Column({ name: 'label_en', type: 'varchar', length: 80, nullable: true })
  labelEn: string | null;

  @Column({ name: 'label_ar', type: 'varchar', length: 80, nullable: true })
  labelAr: string | null;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'sort_order', default: 100 })
  sortOrder: number;

  /** Categories techniques (prime chauffeur) : ni modifiables ni supprimables. */
  @Column({ default: false })
  system: boolean;
}
