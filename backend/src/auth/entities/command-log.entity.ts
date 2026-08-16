import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Journal d'audit des commandes moteur.
 *
 * Table en ecriture seule du point de vue de l'application : aucune route
 * ne permet de la modifier ni de la vider. C'est la seule trace permettant
 * de repondre a « qui a bloque ce camion, quand, et pourquoi ».
 */
@Entity('command_logs')
export class CommandLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ type: 'varchar', length: 32 })
  action: 'block_starter' | 'release_starter';

  /** Email de l'utilisateur, ou 'system' pour une regle automatique. */
  @Column({ name: 'actor_email', length: 190 })
  actorEmail: string;

  @Column({ name: 'actor_id', type: 'varchar', length: 36, nullable: true })
  actorId: string | null;

  @Column({ length: 255 })
  reason: string;

  /** false = commande mise en file d'attente, pas encore envoyee au boitier. */
  @Column()
  applied: boolean;

  @Column({ name: 'speed_at_request' })
  speedAtRequest: number;

  @Column({ name: 'ignition_at_request' })
  ignitionAtRequest: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
