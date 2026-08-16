/**
 * Contrat de données partagé entre l'API et le dashboard.
 * Toute modification ici doit être répercutée dans frontend/src/lib/types.ts.
 */

/** État du démarreur, tel que vu par l'exploitant. */
export type StarterState =
  | 'allowed' // démarrage autorisé
  | 'pending_block' // blocage demandé, en attente de l'arrêt du véhicule
  | 'blocked'; // démarreur coupé (DOUT1 actif)

export type AlertLevel = 'info' | 'warning' | 'critical';

export type AlertCode =
  | 'forbidden_zone_entered'
  | 'forbidden_zone_left'
  | 'departure_without_confirmation'
  | 'fuel_drop'
  | 'fuel_low'
  | 'starter_blocked'
  | 'starter_released'
  | 'device_offline';

export interface VehicleState {
  id: string;
  plate: string;
  driver: string;
  imei: string;

  lat: number;
  lon: number;
  speed: number; // km/h
  course: number; // degrés

  ignition: boolean; // DIN1 — fil d'allumage
  departureConfirmed: boolean; // DIN2 — bouton chauffeur
  starter: StarterState; // DOUT1 — relais démarreur

  fuelMain: number; // litres, réservoir 700 L (AIN1)
  fuelAux: number; // litres, réservoir 300 L (AIN2)

  odometer: number; // km
  engineHours: number; // h

  zoneId: string | null;
  battery: number; // volts
  gsm: number; // 0..5

  online: boolean;
  updatedAt: string; // ISO 8601
}

export interface Alert {
  id: string;
  vehicleId: string;
  level: AlertLevel;
  code: AlertCode;
  message: string;
  at: string;
  acknowledged: boolean;
}

/** Trace d'audit de toute commande envoyée à un boîtier. */
export interface CommandAudit {
  id: string;
  vehicleId: string;
  action: 'block_starter' | 'release_starter';
  actor: string;
  reason: string;
  /** true = envoyée au boîtier ; false = mise en file d'attente */
  applied: boolean;
  vehicleSpeedAtRequest: number;
  ignitionAtRequest: boolean;
  at: string;
}

/* --- Messages poussés sur le flux SSE ------------------------------------ */

export type StreamMessage =
  | { type: 'snapshot'; vehicles: VehicleState[]; alerts: Alert[] }
  | { type: 'position'; vehicle: VehicleState }
  | { type: 'alert'; alert: Alert }
  | { type: 'command'; audit: CommandAudit }
  | { type: 'heartbeat'; at: string };
