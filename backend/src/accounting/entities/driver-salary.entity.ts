import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Salaire d'un mois declare du a un chauffeur. */
@Entity({ name: 'driver_salaries' })
@Index(['driverId', 'month'], { unique: true })
export class DriverSalary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'driver_id', length: 36 })
  driverId: string;

  /** YYYY-MM */
  @Column({ length: 7 })
  month: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  /** Paiement qui a regle ce salaire (null = encore du). */
  @Column({ name: 'driver_payment_id', type: 'varchar', length: 36, nullable: true })
  driverPaymentId: string | null;

  @Column({ name: 'created_by', length: 190 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
