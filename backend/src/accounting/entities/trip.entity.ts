import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Voyage facturé à un client pour un camion donné.
 *
 * Ne porte que le revenu (`amount`), pas les coûts du trajet : les charges
 * restent au niveau du véhicule (voir VehicleExpense) — simplification
 * volontaire pour la V1, un voyage plus fin pourra les rattacher plus tard.
 */
@Index('idx_trip_vehicle', ['vehicleId', 'startedAt'])
@Entity('trips')
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ name: 'driver_id', length: 36 })
  driverId: string;

  @Column({ name: 'client_id', length: 36 })
  clientId: string;

  @Column({ name: 'started_at', type: 'datetime' })
  startedAt: Date;

  /** null = voyage en cours. */
  @Column({ name: 'ended_at', type: 'datetime', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  origin: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  destination: string | null;

  /** Montant facturé au client, en dirhams. */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by', length: 190 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
