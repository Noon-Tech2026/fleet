/**
 * Miroir de backend/src/common/types.ts.
 * A extraire dans un package partage (packages/contracts) des que le
 * projet grossit — pour l'instant la duplication reste plus simple.
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
  | 'device_offline'
  | 'maintenance_due'
  | 'maintenance_overdue';

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

/* --- Entretien ------------------------------------------------------------ */

/** Operations suivies. Ce catalogue est celui d'un SHACMAN F3000 : il
 *  se complete, mais un code retire laisserait des lignes orphelines. */
export type MaintenanceKind =
  | 'engine_oil' // vidange huile moteur
  | 'oil_filter' // cartouche filtre a huile
  | 'fuel_filter' // cartouche filtre a gasoil
  | 'water_separator' // cartouche decanteur d'eau
  | 'air_filter' // filtre a air
  | 'gearbox_oil' // huile de boite
  | 'axle_oil' // huile de ponts
  | 'greasing' // graissage general
  | 'brake_check'; // controle du freinage

export type MaintenanceStatus =
  | 'unknown' // aucun entretien enregistre : echeance incalculable
  | 'ok'
  | 'soon' // dans les derniers 15 % de l'intervalle
  | 'overdue';

/** Echeance calculee a partir du releve courant du camion. */
export interface MaintenancePlanState {
  id: string;
  vehicleId: string;
  kind: MaintenanceKind;
  label: string;
  status: MaintenanceStatus;

  intervalKm: number | null;
  intervalHours: number | null;
  intervalDays: number | null;

  lastServiceOdometer: number | null;
  lastServiceHours: number | null;
  lastServiceAt: string | null;

  /** Restant avant echeance ; negatif = depasse. null = axe non suivi. */
  remainingKm: number | null;
  remainingHours: number | null;
  remainingDays: number | null;

  /** Part consommee de l'intervalle sur l'axe le plus avance, 0..1 et au-dela. */
  usage: number;

  notes: string | null;
}

export interface MaintenanceLogEntry {
  id: string;
  vehicleId: string;
  kind: MaintenanceKind;
  label: string;
  at: string;
  odometer: number | null;
  engineHours: number | null;
  partReference: string | null;
  cost: number | null;
  performedBy: string;
  notes: string | null;
}

/* --- Messages poussés sur le flux SSE ------------------------------------ */

export type StreamMessage =
  | { type: 'snapshot'; vehicles: VehicleState[]; alerts: Alert[] }
  | { type: 'position'; vehicle: VehicleState }
  | { type: 'alert'; alert: Alert }
  | { type: 'command'; audit: CommandAudit }
  | { type: 'heartbeat'; at: string };

/* --- Authentification ---------------------------------------------------- */

export type Role = 'viewer' | 'operator' | 'supervisor' | 'admin';

/** Du moins au plus permissif. L'index dans ce tableau fait foi. */
export const ROLE_RANK: Role[] = ['viewer', 'operator', 'supervisor', 'admin'];

export function hasAtLeast(role: Role, required: Role): boolean {
  return ROLE_RANK.indexOf(role) >= ROLE_RANK.indexOf(required);
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
}
