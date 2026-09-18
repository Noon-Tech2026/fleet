import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Repertoire de la flotte. Remplace la constante REGISTRY qui vivait
 * en dur dans fleet.service.ts.
 *
 * La cle primaire est le code d'exploitation (C-01, C-02...) et non un
 * UUID : c'est l'identifiant que les chauffeurs et le superviseur
 * utilisent au quotidien, et celui que Traccar renvoie comme nom de
 * boitier. Un UUID technique n'apporterait rien ici.
 */
@Entity('vehicles')
export class Vehicle {
  @PrimaryColumn({ length: 32 })
  id: string;

  @Column({ length: 32 })
  plate: string;

  /** Vide tant qu'aucun depart n'a ete confirme pour ce camion. */
  @Column({ length: 120, default: '' })
  driver: string;

  /** IMEI du boitier Teltonika. Unique : un boitier = un camion. */
  @Index({ unique: true })
  @Column({ length: 32 })
  imei: string;

  @Column({ length: 64, default: 'SHACMAN F3000' })
  model: string;

  /** Capacites reelles des reservoirs, en litres. */
  @Column({ name: 'tank_main_capacity', default: 700 })
  tankMainCapacity: number;

  @Column({ name: 'tank_aux_capacity', default: 300 })
  tankAuxCapacity: number;

  /** Numero de la carte SIM installee dans le boitier. */
  @Column({ name: 'sim_number', length: 32, default: '' })
  simNumber: string;

  /** Kilometrage au compteur du camion lors de l'ajout (camion d'occasion).
   *  L'odometre affiche = ce point de depart + la distance GPS accumulee. */
  @Column({ name: 'initial_odometer', default: 0 })
  initialOdometer: number;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
