import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { VehicleExpenseCategory } from '../../common/types';

/**
 * Charge d'exploitation d'un camion (carburant, pneus, assurance...).
 *
 * Volontairement sans catégorie "entretien" : ce coût est déjà tracé dans
 * `maintenance_logs.cost`. Le dupliquer ici compterait deux fois la même
 * dépense dans le résultat net du véhicule.
 */
@Index('idx_vehicle_expense_vehicle', ['vehicleId', 'at'])
@Entity('vehicle_expenses')
export class VehicleExpense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ type: 'varchar', length: 32 })
  category: VehicleExpenseCategory;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ type: 'datetime' })
  at: Date;

  /** Numéro de facture ou de quittance, si connu. */
  @Column({ type: 'varchar', length: 160, nullable: true })
  reference: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Renseigne pour les primes chauffeur generees automatiquement a la confirmation d'un voyage. */
  @Column({ name: 'trip_id', type: 'varchar', length: 36, nullable: true })
  tripId: string | null;

  @Column({ name: 'driver_id', type: 'varchar', length: 36, nullable: true })
  driverId: string | null;

  /** Bon de retour a vide (conteneur rendu) recu pour ce voyage : date de reception. */
  @Column({ name: 'retour_vide_at', type: 'datetime', nullable: true })
  retourVideAt: Date | null;

  @Column({ name: 'retour_vide_by', type: 'varchar', length: 190, nullable: true })
  retourVideBy: string | null;

  /** Paiement qui a regle cette prime (null = encore due). */
  @Column({ name: 'driver_payment_id', type: 'varchar', length: 36, nullable: true })
  driverPaymentId: string | null;

  /**
   * Reglement : 'cash' = paye a la saisie (sort de la caisse a `at`),
   * 'credit' = dette fournisseur (sort de la caisse a `paidAt`, null tant que due).
   * null = charge historique, saisie avant cette option : hors caisse.
   */
  @Column({ type: 'varchar', length: 8, nullable: true })
  payment: 'cash' | 'credit' | null;

  @Column({ name: 'paid_at', type: 'datetime', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'paid_by', type: 'varchar', length: 190, nullable: true })
  paidBy: string | null;

  /** Fournisseur (a qui l'on doit, pour une charge a credit). */
  @Column({ type: 'varchar', length: 160, nullable: true })
  supplier: string | null;

  @Column({ name: 'created_by', length: 190 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
