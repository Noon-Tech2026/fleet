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

  @Column({ name: 'created_by', length: 190 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
