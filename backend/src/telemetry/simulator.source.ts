import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TelemetrySource, PositionHandler, RawPosition } from './telemetry.source';

interface SimVehicle {
  id: string;
  route: [number, number][]; // [lat, lon]
  t: number;
  dir: 1 | -1;
  speed: number;
  ignition: boolean;
  fuelMain: number;
  fuelAux: number;
  odometer: number;
  engineHours: number;
  output: boolean;
  buttonPressed: boolean;
  scenario: 'normal' | 'departure_without_button' | 'fuel_theft';
}

const R1: [number, number][] = [
  [35.2, -2.4],
  [35.24, -2.34],
  [35.28, -2.28],
  [35.33, -2.2],
  [35.37, -2.14],
  [35.41, -2.08],
  [35.44, -2.03],
];
const R2: [number, number][] = [
  [35.2, -2.4],
  [35.22, -2.33],
  [35.27, -2.26],
  [35.31, -2.19],
  [35.36, -2.13],
  [35.4, -2.07],
  [35.44, -2.03],
];
const R3: [number, number][] = [
  [35.28, -2.28],
  [35.35, -2.24],
  [35.42, -2.16],
  [35.47, -2.06],
  [35.44, -2.03],
];

/**
 * Cadence de la simulation. 1 tick = 1 minute simulée, émise chaque seconde,
 * ce qui rend les scénarios visibles en réunion sans attendre.
 */
const TICK_MS = 1000;
const MINUTES_PER_TICK = 1;

@Injectable()
export class SimulatorSource implements TelemetrySource, OnModuleDestroy {
  private readonly log = new Logger(SimulatorSource.name);
  private timer?: NodeJS.Timeout;
  private tick = 0;

  private vehicles: SimVehicle[] = [
    mk('C-01', R1, 0.28, 64, true, 612, 288, 184320, 5412, 'normal'),
    mk('C-02', R2, 0.34, 52, true, 421, 300, 231884, 6980, 'normal'),
    mk('C-03', R1, 0.0, 0, false, 700, 300, 96540, 2874, 'departure_without_button'),
    mk('C-04', R1, 0.74, 58, true, 340, 210, 302115, 9140, 'fuel_theft'),
    mk('C-05', R3, 0.42, 47, true, 528, 300, 158702, 4630, 'normal'),
    
  ];

  async start(onPosition: PositionHandler): Promise<void> {
    this.log.warn('Source SIMULÉE active — aucune donnée réelle.');
    this.timer = setInterval(() => this.step(onPosition), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async setDigitalOutput(vehicleId: string, output: 1 | 2, active: boolean): Promise<void> {
    const v = this.vehicles.find((x) => x.id === vehicleId);
    if (!v) throw new Error(`Véhicule inconnu : ${vehicleId}`);
    // Latence réseau GPRS réaliste — le dashboard doit savoir attendre.
    await new Promise((r) => setTimeout(r, 600));
    if (output === 1) v.output = active;
    this.log.log(`${vehicleId} — DOUT${output} = ${active ? 'ON' : 'OFF'}`);
  }

  /** Injecte un appui du bouton chauffeur (utilisé par l'endpoint de test). */
  pressButton(vehicleId: string): void {
    const v = this.vehicles.find((x) => x.id === vehicleId);
    if (v) v.buttonPressed = true;
  }

  private step(emit: PositionHandler): void {
    this.tick += 1;

    for (const v of this.vehicles) {
      this.applyScenario(v);

      if (v.ignition && v.speed > 0) {
        const km = (v.speed / 60) * MINUTES_PER_TICK;
        const len = routeKm(v.route);
        v.t += (v.dir * km) / len;
        if (v.t >= 1) {
          v.t = 1;
          v.dir = -1;
        }
        if (v.t <= 0) {
          v.t = 0;
          v.dir = 1;
        }
        v.odometer += km;
        v.engineHours += MINUTES_PER_TICK / 60;

        const burn = km * 0.34; // ~34 L / 100 km
        if (v.fuelMain > burn) v.fuelMain -= burn;
        else v.fuelAux = Math.max(0, v.fuelAux - burn);

        v.speed = clamp(v.speed + (Math.random() - 0.5) * 9, 28, 78);
      } else if (v.ignition) {
        v.engineHours += MINUTES_PER_TICK / 60;
      }

      const p = pointAt(v.route, v.t);
      const position: RawPosition = {
        vehicleId: v.id,
        lat: p.lat,
        lon: p.lon,
        speed: Math.round(v.speed),
        course: v.dir === 1 ? p.course : (p.course + 180) % 360,
        ignition: v.ignition,
        buttonPressed: v.buttonPressed,
        outputActive: v.output,
        fuelMainVolts: litersToVolts(v.fuelMain, 700),
        fuelAuxVolts: litersToVolts(v.fuelAux, 300),
        odometer: Math.round(v.odometer),
        engineHours: Math.round(v.engineHours),
        battery: 26 + Math.random() * 2,
        gsm: 3 + Math.round(Math.random()),
        at: new Date(),
      };

      v.buttonPressed = false; // impulsion : un seul cycle
      emit(position);
    }
  }

  private applyScenario(v: SimVehicle): void {
    if (v.scenario === 'departure_without_button' && this.tick === 14 && !v.ignition) {
      v.ignition = true;
      v.speed = 22;
    }
    if (v.scenario === 'fuel_theft') {
      if (this.tick === 16) v.speed = 0;
      if (this.tick >= 18 && this.tick <= 23) v.fuelMain = Math.max(0, v.fuelMain - 14);
      if (this.tick === 26) v.speed = 55;
    }
  }
}

/* --- helpers ------------------------------------------------------------- */

function mk(
  id: string,
  route: [number, number][],
  t: number,
  speed: number,
  ignition: boolean,
  fuelMain: number,
  fuelAux: number,
  odometer: number,
  engineHours: number,
  scenario: SimVehicle['scenario'],
): SimVehicle {
  return {
    id,
    route,
    t,
    dir: 1,
    speed,
    ignition,
    fuelMain,
    fuelAux,
    odometer,
    engineHours,
    output: false,
    buttonPressed: false,
    scenario,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function routeKm(route: [number, number][]): number {
  let km = 0;
  for (let i = 1; i < route.length; i++) {
    const dLat = route[i][0] - route[i - 1][0];
    const dLon = route[i][1] - route[i - 1][1];
    km += Math.hypot(dLat * 111, dLon * 91);
  }
  return km;
}

function pointAt(route: [number, number][], t: number): { lat: number; lon: number; course: number } {
  const total = routeKm(route);
  let d = clamp(t, 0, 1) * total;
  for (let i = 1; i < route.length; i++) {
    const dLat = route[i][0] - route[i - 1][0];
    const dLon = route[i][1] - route[i - 1][1];
    const seg = Math.hypot(dLat * 111, dLon * 91);
    if (d <= seg) {
      const f = seg === 0 ? 0 : d / seg;
      return {
        lat: route[i - 1][0] + dLat * f,
        lon: route[i - 1][1] + dLon * f,
        course: (Math.atan2(dLon, dLat) * 180) / Math.PI,
      };
    }
    d -= seg;
  }
  const n = route.length - 1;
  return {
    lat: route[n][0],
    lon: route[n][1],
    course: (Math.atan2(route[n][1] - route[n - 1][1], route[n][0] - route[n - 1][0]) * 180) / Math.PI,
  };
}

/** Inverse de la calibration, pour que le simulateur parle bien en volts. */
function litersToVolts(liters: number, capacity: number): number {
  return 0.5 + (liters / capacity) * 4;
}
