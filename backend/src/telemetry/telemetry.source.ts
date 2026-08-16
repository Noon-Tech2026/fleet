/**
 * Ce que l'API attend d'une source de données, quelle qu'elle soit.
 *
 * Le simulateur et Traccar implémentent la même interface, donc le reste
 * du backend ne sait pas — et ne doit jamais savoir — d'où viennent les
 * positions. C'est ce qui permet de développer tout le dashboard avant
 * que le premier boîtier soit installé, puis de basculer par une variable
 * d'environnement.
 */

export interface RawPosition {
  vehicleId: string;
  lat: number;
  lon: number;
  speed: number; // km/h
  course: number;
  ignition: boolean; // DIN1
  buttonPressed: boolean; // DIN2 — impulsion du bouton chauffeur
  outputActive: boolean; // DOUT1 — état réel du relais
  fuelMainVolts: number; // AIN1
  fuelAuxVolts: number; // AIN2
  odometer: number; // km
  engineHours: number; // h
  battery: number; // V
  gsm: number; // 0..5
  at: Date;
}

export type PositionHandler = (position: RawPosition) => void;

export const TELEMETRY_SOURCE = Symbol('TELEMETRY_SOURCE');

export interface TelemetrySource {
  /** Démarre la réception. Appelé une fois au boot. */
  start(onPosition: PositionHandler): Promise<void>;

  /**
   * Bascule une sortie numérique du boîtier.
   * Doit rejeter si le boîtier n'accuse pas réception — le backend
   * ne considère jamais une commande comme appliquée sans confirmation.
   */
  setDigitalOutput(vehicleId: string, output: 1 | 2, active: boolean): Promise<void>;
}
