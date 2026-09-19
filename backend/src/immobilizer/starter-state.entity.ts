import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Etat VOULU du demarreur, par camion, persiste pour survivre aux
 * redemarrages de l'API. L'etat REEL est demande au boitier (getio).
 */
@Entity('starter_states')
export class StarterState {
  @PrimaryColumn({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ type: 'varchar', length: 16, default: 'allowed' })
  desired: 'blocked' | 'allowed';

  /** Blocage demande mais differe (camion en mouvement). */
  @Column({ default: false })
  pending: boolean;

  @Column({ name: 'requested_by', length: 190, default: 'system' })
  requestedBy: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  reason: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
