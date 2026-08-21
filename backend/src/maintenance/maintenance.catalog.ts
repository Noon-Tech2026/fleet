import { MaintenanceKind } from '../common/types';

export interface MaintenanceTask {
  kind: MaintenanceKind;
  label: string;
  /** null = axe non suivi pour cette operation. */
  intervalKm: number | null;
  intervalHours: number | null;
  intervalDays: number | null;
}

/**
 * Periodicites de reference d'un SHACMAN F3000 en service carriere.
 *
 * Ce sont des valeurs de depart, pas une doctrine : elles se reglent par
 * camion depuis l'interface. Un moteur qui tourne dans la poussiere use
 * ses cartouches plus vite que ce que dit un carnet d'atelier.
 */
export const MAINTENANCE_CATALOG: readonly MaintenanceTask[] = [
  { kind: 'engine_oil', label: 'Vidange huile moteur', intervalKm: 15_000, intervalHours: 250, intervalDays: 365 },
  { kind: 'oil_filter', label: 'Cartouche filtre a huile', intervalKm: 15_000, intervalHours: 250, intervalDays: 365 },
  { kind: 'fuel_filter', label: 'Cartouche filtre a gasoil', intervalKm: 20_000, intervalHours: null, intervalDays: 365 },
  { kind: 'water_separator', label: "Cartouche decanteur d'eau", intervalKm: 20_000, intervalHours: null, intervalDays: 180 },
  { kind: 'air_filter', label: 'Filtre a air', intervalKm: 30_000, intervalHours: null, intervalDays: 365 },
  { kind: 'gearbox_oil', label: 'Huile de boite', intervalKm: 60_000, intervalHours: null, intervalDays: 730 },
  { kind: 'axle_oil', label: 'Huile de ponts', intervalKm: 60_000, intervalHours: null, intervalDays: 730 },
  { kind: 'greasing', label: 'Graissage general', intervalKm: 5_000, intervalHours: null, intervalDays: 30 },
  { kind: 'brake_check', label: 'Controle du freinage', intervalKm: 20_000, intervalHours: null, intervalDays: 90 },
];

export const MAINTENANCE_KINDS: readonly MaintenanceKind[] = MAINTENANCE_CATALOG.map((t) => t.kind);

const BY_KIND = new Map(MAINTENANCE_CATALOG.map((t) => [t.kind, t]));

export function taskOf(kind: MaintenanceKind): MaintenanceTask | undefined {
  return BY_KIND.get(kind);
}

export function labelOf(kind: MaintenanceKind): string {
  return BY_KIND.get(kind)?.label ?? kind;
}
