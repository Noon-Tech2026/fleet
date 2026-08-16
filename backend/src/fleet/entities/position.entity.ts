import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Historique des positions.
 *
 * C'est la table qui va grossir : cinq camions emettant toutes les
 * 30 secondes produisent environ 14 000 lignes par jour, soit 5 millions
 * par an. Deux consequences assumees dans la conception :
 *
 *   1. Toutes les trames ne sont PAS enregistrees. PositionsService
 *      filtre en amont (voir sa methode shouldPersist) : on garde les
 *      changements d'etat et les deplacements significatifs, pas le
 *      bruit d'un camion a l'arret.
 *
 *   2. L'index compose (vehicle_id, recorded_at) sert la requete
 *      dominante — « le trajet du camion X entre deux dates ». Sans lui,
 *      chaque affichage d'historique ferait un balayage complet.
 *
 * Cle primaire en bigint auto-incremente et non en UUID : sur une table
 * de plusieurs millions de lignes, un UUID aleatoire fragmente l'index
 * InnoDB et double la taille des index secondaires.
 */
@Index('idx_positions_vehicle_time', ['vehicleId', 'recordedAt'])
@Entity('positions')
export class Position {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ type: 'double' })
  lat: number;

  @Column({ type: 'double' })
  lon: number;

  /** km/h */
  @Column({ type: 'smallint' })
  speed: number;

  /** degres */
  @Column({ type: 'smallint' })
  course: number;

  @Column()
  ignition: boolean;

  /** Litres, reservoir principal (AIN1 converti). */
  @Column({ name: 'fuel_main', type: 'smallint' })
  fuelMain: number;

  /** Litres, reservoir auxiliaire (AIN2 converti). */
  @Column({ name: 'fuel_aux', type: 'smallint' })
  fuelAux: number;

  @Column({ type: 'int' })
  odometer: number;

  @Column({ name: 'engine_hours', type: 'int' })
  engineHours: number;

  /** Zone occupee au moment de la trame, ou NULL hors zone. */
  @Column({ name: 'zone_id', type: 'varchar', length: 36, nullable: true })
  zoneId: string | null;

  /**
   * Pourquoi cette trame a ete conservee. Utile pour comprendre a
   * posteriori pourquoi un trajet a plus ou moins de points.
   */
  @Column({ name: 'kept_because', type: 'varchar', length: 24 })
  keptBecause: 'first' | 'ignition' | 'moved' | 'interval' | 'zone';

  @Index()
  @Column({ name: 'recorded_at', type: 'datetime' })
  recordedAt: Date;
}
