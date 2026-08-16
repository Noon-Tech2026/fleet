import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FuelCalibration, CalibrationPoint } from './entities/fuel-calibration.entity';

interface Sample {
  liters: number;
  speed: number;
  at: number;
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

  /**
   * Analyse la serie recente d'un reservoir.
   * Retourne un motif d'alerte, ou null si rien d'anormal.
   */
  inspect(
    vehicleId: string,
    tank: 'main' | 'aux',
    liters: number,
    speed: number,
  ): { code: 'fuel_drop'; delta: number } | null {
    const key = `${vehicleId}:${tank}`;
    const now = Date.now();
    const series = (this.history.get(key) ?? []).filter((s) => now - s.at <= DROP_WINDOW_MS);
    series.push({ liters, speed, at: now });
    this.history.set(key, series);

    if (series.length < 3) return null;

    // Une baisse pendant un roulage est de la consommation normale.
    if (!series.every((s) => s.speed < 3)) return null;

    const delta = series[0].liters - liters;
    if (delta >= DROP_LITERS) {
      this.history.set(key, [{ liters, speed, at: now }]);
      this.log.warn(`${vehicleId} — chute de ${Math.round(delta)} L sur le reservoir ${tank}`);
      return { code: 'fuel_drop', delta: Math.round(delta) };
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
