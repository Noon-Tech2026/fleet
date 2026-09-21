import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { AlertCode, AlertLevel } from '../../common/types';

/** Journal des alertes : survit aux redemarrages de l'API. */
@Entity({ name: 'alerts' })
export class AlertEntity {
  @PrimaryColumn({ length: 36 })
  id: string;

  @Index()
  @Column({ name: 'vehicle_id', length: 32 })
  vehicleId: string;

  @Column({ length: 16 })
  level: AlertLevel;

  @Column({ length: 48 })
  code: AlertCode;

  @Column({ type: 'text' })
  message: string;

  @Index()
  @Column({ type: 'datetime' })
  at: Date;

  @Column({ default: false })
  acknowledged: boolean;
}
