import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { MaintenanceKind } from '../../common/types';

/**
 * Trace d'un entretien realise. Jamais modifiee ni supprimee : c'est ce
 * journal qui repond a « quand cette cartouche a-t-elle ete changee, par
 * qui, a quel kilometrage » — la seule defense possible face a une panne
 * moteur imputee a un defaut d'entretien.
 *
 * Le releve du compteur est saisi a la main et non repris de la derniere
 * trame : un entretien s'enregistre parfois le lendemain, et c'est le
 * kilometrage du jour de l'intervention qui fait foi.
 */
@Index('idx_maintenance_log_vehicle', ['vehicleId', 'at'])
@Entity('maintenance_logs')
export class MaintenanceLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ type: 'varchar', length: 32 })
  kind: MaintenanceKind;

  @Column({ type: 'datetime' })
  at: Date;

  @Column({ type: 'int', nullable: true })
  odometer: number | null;

  @Column({ name: 'engine_hours', type: 'int', nullable: true })
  engineHours: number | null;

  /** Reference de la piece posee — cartouche, filtre, bidon d'huile. */
  @Column({ name: 'part_reference', type: 'varchar', length: 120, nullable: true })
  partReference: string | null;

  /** Cout en dirhams, saisi si connu. */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cost: string | null;

  @Column({ name: 'performed_by', length: 190 })
  performedBy: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
