import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Fiche de depart saisie par le superviseur au bureau.
 *
 * Elle est creee AVANT la sortie du camion, puis rapprochee de l'appui
 * du bouton chauffeur. Les deux evenements sont volontairement separes :
 *   - la fiche dit ce que le camion est cense transporter et ou il va ;
 *   - l'appui bouton dit que le chauffeur a bien pris le depart.
 *
 * Une sortie sans fiche, ou une fiche sans appui bouton, sont deux
 * anomalies differentes qui n'appellent pas la meme reaction.
 */
@Entity('departures')
export class Departure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ length: 120 })
  driver: string;

  @Column({ length: 190 })
  destination: string;

  @Column({ type: 'varchar', length: 190, nullable: true })
  cargo: string | null;

  /** Poids du chargement en kg, si connu. */
  @Column({ name: 'cargo_weight', type: 'int', nullable: true })
  cargoWeight: number | null;

  /** Email du superviseur qui a saisi la fiche. */
  @Column({ name: 'recorded_by', length: 190 })
  recordedBy: string;

  /** Horodatage de l'appui du bouton chauffeur, NULL tant qu'absent. */
  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true })
  confirmedAt: Date | null;

  /** Renseigne a la sortie effective de la station. */
  @Column({ name: 'departed_at', type: 'datetime', nullable: true })
  departedAt: Date | null;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
