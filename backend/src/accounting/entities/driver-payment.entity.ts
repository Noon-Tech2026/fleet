import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Versement fait a un chauffeur en reglement de ses primes. Pas une charge : la prime l'est deja. */
@Entity({ name: 'driver_payments' })
export class DriverPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'driver_id', length: 36 })
  driverId: string;

  /** fee = primes, salary = salaire, advance = avance sur salaire, other. */
  @Column({ type: 'varchar', length: 16, default: 'fee' })
  kind: 'fee' | 'salary' | 'advance' | 'other';

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ type: 'datetime' })
  at: Date;

  @Column({ type: 'varchar', length: 160, nullable: true })
  notes: string | null;

  @Column({ name: 'created_by', length: 190 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
