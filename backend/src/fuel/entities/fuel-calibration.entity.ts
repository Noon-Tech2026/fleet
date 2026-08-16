import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export interface CalibrationPoint {
  /** Tension lue sur l'entree analogique. */
  volts: number;
  /** Litres reellement presents, mesures au compteur de la pompe. */
  liters: number;
}

/**
 * Courbe tension -> litres, une par reservoir et par camion.
 *
 * Une courbe unique pour toute la flotte ne tiendrait pas : deux
 * reservoirs de meme modele ont des sondes montees a des hauteurs
 * legerement differentes, et un reservoir aluminium n'a pas une section
 * constante sur sa hauteur. La conversion n'est donc jamais lineaire.
 *
 * Les points se relevent physiquement : reservoir vide, puis par paliers
 * mesures a la pompe. Cinq points minimum par reservoir.
 */
@Index('idx_calibration_vehicle_tank', ['vehicleId', 'tank'], { unique: true })
@Entity('fuel_calibrations')
export class FuelCalibration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ type: 'varchar', length: 8 })
  tank: 'main' | 'aux';

  @Column({ type: 'int' })
  capacity: number;

  /** Points tries par tension croissante. */
  @Column({ type: 'json' })
  points: CalibrationPoint[];

  /** Qui a releve la courbe, et quand — une calibration se refait. */
  @Column({ name: 'calibrated_by', type: 'varchar', length: 190, nullable: true })
  calibratedBy: string | null;

  @Column({ name: 'calibrated_at', type: 'datetime', nullable: true })
  calibratedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
