import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { VehicleInvestmentKind } from '../../common/types';

/**
 * Investissement sur un camion (achat, équipement, réfection lourde).
 *
 * Comptabilisé tel quel, sans amortissement : une V1 volontairement simple,
 * qui additionne le montant plutôt que de le répartir dans le temps.
 */
@Index('idx_vehicle_investment_vehicle', ['vehicleId', 'at'])
@Entity('vehicle_investments')
export class VehicleInvestment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ type: 'varchar', length: 32 })
  kind: VehicleInvestmentKind;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ type: 'datetime' })
  at: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ name: 'created_by', length: 190 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
