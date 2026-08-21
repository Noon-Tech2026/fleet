import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { MaintenanceKind } from '../../common/types';

/**
 * Echeance d'entretien : une ligne par camion et par operation.
 *
 * Les trois axes (kilometrage, heures moteur, calendrier) coexistent
 * volontairement. Un camion de carriere accumule des heures moteur sans
 * faire de kilometres — l'huile y vieillit au ralenti, pas a la roue.
 * Un camion peu utilise, lui, doit quand meme etre vidange une fois par
 * an. Retenir un seul axe laisserait un de ces deux cas sans suivi.
 *
 * L'echeance la plus proche des trois fait foi.
 */
@Index('idx_maintenance_vehicle_kind', ['vehicleId', 'kind'], { unique: true })
@Entity('maintenance_plans')
export class MaintenancePlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ type: 'varchar', length: 32 })
  kind: MaintenanceKind;

  /** null = axe non suivi pour cette operation. */
  @Column({ name: 'interval_km', type: 'int', nullable: true })
  intervalKm: number | null;

  @Column({ name: 'interval_hours', type: 'int', nullable: true })
  intervalHours: number | null;

  @Column({ name: 'interval_days', type: 'int', nullable: true })
  intervalDays: number | null;

  /**
   * Releves du dernier entretien effectue. Tant qu'ils sont nuls, aucune
   * echeance ne peut etre calculee : l'operation est signalee comme
   * « jamais effectuee » plutot que faussement conforme.
   */
  @Column({ name: 'last_service_odometer', type: 'int', nullable: true })
  lastServiceOdometer: number | null;

  @Column({ name: 'last_service_hours', type: 'int', nullable: true })
  lastServiceHours: number | null;

  @Column({ name: 'last_service_at', type: 'datetime', nullable: true })
  lastServiceAt: Date | null;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
