import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FuelCalibration, CalibrationPoint } from './entities/fuel-calibration.entity';

interface Sample {
  liters: number;
  speed: number;
  at: number;
  ignition?: boolean;
}

/** Chute consideree comme anormale : plus de 25 L en 10 min, vehicule a l'arret. */
const DROP_LITERS = 25;
const DROP_WINDOW_MS = 10 * 60 * 1000;
const LOW_FUEL_TOTAL = 150;

/**
 * Courbe de repli, utilisee tant qu'un camion n'a pas ete calibre.
 * Volontairement lineaire et donc FAUSSE sur un reservoir aluminium :
 * elle permet de demarrer, pas de facturer du carburant.
 */
const FALLBACK: Record<'main' | 'aux', { capacity: number; points: CalibrationPoint[] }> = {
  main: {
    capacity: 700,
    points: [
      { volts: 0.5, liters: 0 },
      { volts: 4.5, liters: 700 },
    ],
  },
  aux: {
    capacity: 300,
    points: [
      { volts: 0.5, liters: 0 },
      { volts: 4.5, liters: 300 },
    ],
  },
};

@Injectable()
export class FuelService implements OnModuleInit {
  private readonly log = new Logger(FuelService.name);
  private readonly history = new Map<string, Sample[]>();

  /** Cache : la conversion tourne a chaque trame. */
  private cache = new Map<string, FuelCalibration>();

  constructor(
    @InjectRepository(FuelCalibration) private readonly repo: Repository<FuelCalibration>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.repo.find();
    this.cache = new Map(rows.map((r) => [`${r.vehicleId}:${r.tank}`, r]));
    this.log.log(`${rows.length} courbes de calibration chargees`);
  }

  /** Convertit une tension de sonde (AIN) en litres, par interpolation lineaire. */
  toLiters(vehicleId: string, tank: 'main' | 'aux', volts: number): number {
    const cal = this.cache.get(`${vehicleId}:${tank}`);
    const points = cal?.points ?? FALLBACK[tank].points;
    const capacity = cal?.capacity ?? FALLBACK[tank].capacity;

    if (points.length < 2) return 0;
    if (volts <= points[0].volts) return 0;
    if (volts >= points[points.length - 1].volts) return capacity;

    for (let i = 1; i < points.length; i++) {
      if (volts <= points[i].volts) {
        const a = points[i - 1];
        const b = points[i];
        const f = (volts - a.volts) / (b.volts - a.volts);
        return Math.round(a.liters + (b.liters - a.liters) * f);
      }
    }
    return capacity;
  }

  isCalibrated(vehicleId: string): boolean {
    return this.cache.has(`${vehicleId}:main`);
  }

  /* --- detection d'anomalies -------------------------------------------- */
  // Seuils : ajuster apres quelques semaines de donnees reelles.
  private static readonly SMOOTH = 0.35;                 // EMA sur la lecture (bruit capteur)
  private static readonly DRAIN_L = 30;                  // chute brutale a l'arret (vol)
  private static readonly DRAIN_WINDOW_MS = 10 * 60_000;
  private static readonly LEAK_L = 20;                   // baisse lente moteur coupe (fuite)
  private static readonly LEAK_WINDOW_MS = 2 * 60 * 60_000;
  private static readonly REFILL_L = 30;                 // hausse = plein
  private static readonly OVER_RATIO = 2;                // consommation > 2x la reference
  private static readonly OVER_MIN_KM = 20;
  private static readonly REF_L_PER_100KM = 45;          // reference camion charge, a affiner par camion
  private static readonly ALERT_COOLDOWN_MS = 30 * 60_000;

  private readonly smoothed = new Map<string, number>();
  private readonly lastAlert = new Map<string, number>();
  private readonly tripStart = new Map<string, { liters: number; odometer: number; at: number }>();

  /**
   * Analyse la serie recente d'un reservoir (lecture lissee).
   * Retourne un motif d'alerte, ou null. Un seul motif par appel, avec
   * un delai anti-rafale par camion/reservoir/motif.
   */
  inspect(
    vehicleId: string,
    tank: 'main' | 'aux',
    rawLiters: number,
    speed: number,
    ignition = false,
    odometer = 0,
  ): { code: 'fuel_drop' | 'fuel_leak' | 'fuel_refill' | 'fuel_overconsumption'; delta: number } | null {
    // Sans calibration, la lecture n'a pas de sens : rien a analyser.
    if (this.cache.has(`${vehicleId}:${tank}`) === false) return null;

    const key = `${vehicleId}:${tank}`;
    const now = Date.now();
    const prev = this.smoothed.get(key);
    const liters = prev === undefined ? rawLiters : prev + FuelService.SMOOTH * (rawLiters - prev);
    this.smoothed.set(key, liters);

    const series = (this.history.get(key) ?? []).filter((s) => now - s.at <= FuelService.LEAK_WINDOW_MS);
    series.push({ liters, speed, at: now, ignition });
    this.history.set(key, series);
    if (series.length < 3) return null;

    const fire = (code: 'fuel_drop' | 'fuel_leak' | 'fuel_refill' | 'fuel_overconsumption', delta: number) => {
      const k = `${key}:${code}`;
      const last = this.lastAlert.get(k) ?? 0;
      if (now - last < FuelService.ALERT_COOLDOWN_MS) return null;
      this.lastAlert.set(k, now);
      this.history.set(key, [{ liters, speed, at: now, ignition }]);
      this.log.warn(`${vehicleId} — ${code} ${Math.round(delta)} L (${tank})`);
      return { code, delta: Math.round(Math.abs(delta)) };
    };

    // 1. Plein : hausse nette (quel que soit l'etat).
    const minRecent = Math.min(...series.map((s) => s.liters));
    if (liters - minRecent >= FuelService.REFILL_L) return fire('fuel_refill', liters - minRecent);

    // 2. Chute brutale a l'arret : vol / siphonnage.
    const recent = series.filter((s) => now - s.at <= FuelService.DRAIN_WINDOW_MS);
    if (recent.length >= 3 && recent.every((s) => s.speed < 3)) {
      const delta = recent[0].liters - liters;
      if (delta >= FuelService.DRAIN_L) return fire('fuel_drop', delta);
    }

    // 3. Baisse lente moteur coupe : fuite.
    if (series.every((s) => s.speed < 3 && s.ignition === false)) {
      const delta = series[0].liters - liters;
      if (delta >= FuelService.LEAK_L && now - series[0].at >= FuelService.LEAK_WINDOW_MS / 2) return fire('fuel_leak', delta);
    }

    // 4. Surconsommation en roulage (reservoir principal seulement).
    if (tank === 'main' && odometer > 0) {
      const start = this.tripStart.get(vehicleId);
      if (speed >= 3) {
        if (start === undefined) this.tripStart.set(vehicleId, { liters, odometer, at: now });
        else {
          const km = odometer - start.odometer;
          if (km >= FuelService.OVER_MIN_KM) {
            const used = start.liters - liters;
            const per100 = (used / km) * 100;
            this.tripStart.set(vehicleId, { liters, odometer, at: now });
            if (per100 >= FuelService.REF_L_PER_100KM * FuelService.OVER_RATIO) return fire('fuel_overconsumption', per100);
          }
        }
      } else if (start !== undefined && now - start.at > 30 * 60_000) {
        this.tripStart.delete(vehicleId); // arret prolonge : nouveau segment au prochain depart
      }
    }
    return null;
  }

  isLow(main: number, aux: number): boolean {
    return main + aux < LOW_FUEL_TOTAL;
  }

  /* --- administration --------------------------------------------------- */

  async list(vehicleId?: string): Promise<FuelCalibration[]> {
    return this.repo.find({
      where: vehicleId ? { vehicleId } : {},
      order: { vehicleId: 'ASC', tank: 'ASC' },
    });
  }

  /**
   * Enregistre une courbe. Les points sont tries et valides ici : une
   * courbe non monotone donnerait des litres qui diminuent quand la
   * tension augmente, et personne ne le verrait avant une facture.
   */
  async save(
    vehicleId: string,
    tank: 'main' | 'aux',
    capacity: number,
    points: CalibrationPoint[],
    actor: string,
  ): Promise<FuelCalibration> {
    if (points.length < 2) {
      throw new NotFoundException('Une courbe demande au moins deux points');
    }

    const sorted = [...points].sort((a, b) => a.volts - b.volts);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].liters < sorted[i - 1].liters) {
        throw new NotFoundException(
          'Courbe incoherente : les litres doivent croitre avec la tension',
        );
      }
    }

    const existing = await this.repo.findOne({ where: { vehicleId, tank } });
    const entity = existing ?? this.repo.create({ vehicleId, tank });

    entity.capacity = capacity;
    entity.points = sorted;
    entity.calibratedBy = actor;
    entity.calibratedAt = new Date();

    const saved = await this.repo.save(entity);
    await this.reload();
    return saved;
  }
}
