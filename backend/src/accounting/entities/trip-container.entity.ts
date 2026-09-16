import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ContainerSize } from '../../common/types';

/**
 * Un conteneur transporté lors d'un voyage. Le nombre de conteneurs d'un
 * voyage se lit en comptant ces lignes — jamais un champ dupliqué sur
 * `Trip`, qui finirait par diverger du détail.
 */
@Index('idx_trip_container_trip', ['tripId'])
@Entity('trip_containers')
export class TripContainer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trip_id', length: 36 })
  tripId: string;

  /** Numéro ISO du conteneur — pas toujours connu au moment de la saisie. */
  @Column({ name: 'container_number', type: 'varchar', length: 20, nullable: true })
  containerNumber: string | null;

  @Column({ type: 'varchar', length: 8 })
  size: ContainerSize;

  @Column({ default: true })
  loaded: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
