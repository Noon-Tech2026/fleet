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
  outputActive: boolean | undefined; // DOUT1 — état réel du relais ; undefined si absent de la trame
  fuelMainVolts: number; // AIN1
  fuelAuxVolts: number; // AIN2
  odometer: number; // km
  engineHours: number; // h
  battery: number; // V
  gsm: number; // 0..5
  at: Date;
}

export type PositionHandler = (position: RawPosition) => void;

/** Reponse du boitier a une interrogation d'etat (commande getio). */
export interface IoReport {
  vehicleId: string;
  din: Record<number, boolean>;
  /** Valeurs physiques des sorties (avant inversion eventuelle). */
  dout: Record<number, boolean>;
  /** DOUT1 traduite dans la convention interne : true = demarreur bloque. */
  starterBlocked: boolean | undefined;
  raw: string;
  at: Date;
}
export type IoReportHandler = (report: IoReport) => void;

export const TELEMETRY_SOURCE = Symbol('TELEMETRY_SOURCE');

export interface TelemetrySource {
  /** Démarre la réception. Appelé une fois au boot. */
  start(onPosition: PositionHandler): Promise<void>;

  /**
   * Bascule une sortie numérique du boîtier.
   * Doit rejeter si le boîtier n'accuse pas réception — le backend
   * ne considère jamais une commande comme appliquée sans confirmation.
   */
  /** durationSec : le boitier remet la sortie a 0 lui-meme apres ce delai (setdigout avec timeout). */
  setDigitalOutput(vehicleId: string, output: 1 | 2, active: boolean, durationSec?: number): Promise<void>;

  /**
   * Gestion du répertoire des boîtiers côté source (Traccar). Optionnel :
   * le simulateur n'en a pas besoin. Doit rejeter si la source refuse,
   * pour que le répertoire local ne diverge jamais de celui de Traccar.
   */
  /** Demande au boitier l'etat de ses entrees/sorties ; la reponse arrive via onIoReport. */
  queryIo?(vehicleId: string): Promise<void>;
  queryIoAll?(): Promise<void>;
  onIoReport?(handler: IoReportHandler): void;

  registerDevice?(vehicleId: string, imei: string): Promise<void>;
  updateDeviceImei?(vehicleId: string, imei: string): Promise<void>;
  setDeviceEnabled?(vehicleId: string, enabled: boolean): Promise<void>;
  unregisterDevice?(vehicleId: string): Promise<void>;
}
