import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ExitRequestStatus = 'pending' | 'confirmed' | 'bypassed';

/**
 * Sortie d'une zone de chargement, a confirmer par un superviseur.
 *
 * Flux : le camion quitte la zone -> demande "pending" (buzzer tant que le
 * chauffeur n'a pas appuye) -> appui bouton -> decision : confirmer (lie a un
 * voyage), rejeter (buzzer repart, la demande reste ouverte), contourner
 * (entretien / deplacement sans chargement).
 */
@Entity('exit_requests')
export class ExitRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ name: 'zone_id', type: 'varchar', length: 36, nullable: true })
  zoneId: string | null;

  @Column({ name: 'zone_name', length: 120, default: '' })
  zoneName: string;

  @Column({ name: 'exited_at', type: 'datetime' })
  exitedAt: Date;

  @Column({ name: 'button_pressed_at', type: 'datetime', nullable: true })
  buttonPressedAt: Date | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: ExitRequestStatus;

  @Column({ type: 'int', default: 0 })
  rejections: number;

  @Column({ name: 'decided_by', type: 'varchar', length: 190, nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'datetime', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'trip_id', type: 'varchar', length: 36, nullable: true })
  tripId: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
