import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Chauffeur au sens comptable : celui qui a fait un voyage.
 *
 * Distinct du champ libre `Vehicle.driver`, qui ne sert qu'à la
 * confirmation de départ (DIN2) et ne garde aucun historique. Un même
 * chauffeur peut ici conduire plusieurs camions au fil du temps.
 */
@Entity('drivers')
export class Driver {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'full_name', length: 120 })
  fullName: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string | null;

  @Column({ name: 'license_number', type: 'varchar', length: 64, nullable: true })
  licenseNumber: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
