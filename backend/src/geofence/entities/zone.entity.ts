import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ZoneKind = 'station' | 'forbidden';
export type ZoneShape = 'circle' | 'polygon';

/**
 * Zones geographiques. Remplace la constante ZONES qui vivait en dur.
 *
 * Les deux formes cohabitent dans une seule table plutot que dans deux :
 * une zone est toujours soit un cercle, soit un polygone, jamais les deux,
 * et les colonnes inutilisees restent NULL. Deux tables auraient impose
 * une jointure a chaque evaluation de position.
 */
@Entity('zones')
export class Zone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  kind: ZoneKind;

  @Column({ type: 'varchar', length: 16 })
  shape: ZoneShape;

  /* --- forme cercle --- */
  @Column({ type: 'double', nullable: true })
  lat: number | null;

  @Column({ type: 'double', nullable: true })
  lon: number | null;

  /** Rayon en metres. */
  @Column({ type: 'int', nullable: true })
  radius: number | null;

  /* --- forme polygone --- */
  /** Sommets [lat, lon], stockes en JSON. */
  @Column({ type: 'json', nullable: true })
  points: [number, number][] | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
