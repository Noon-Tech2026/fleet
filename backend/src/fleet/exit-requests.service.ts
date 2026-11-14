import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ExitRequest } from './entities/exit-request.entity';
import { EventsService } from '../events/events.service';
import { ExitRequestView } from '../common/types';

export function toView(r: ExitRequest): ExitRequestView {
  return {
    id: r.id,
    vehicleId: r.vehicleId,
    zoneId: r.zoneId,
    zoneName: r.zoneName,
    exitedAt: r.exitedAt.toISOString(),
    buttonPressedAt: r.buttonPressedAt ? r.buttonPressedAt.toISOString() : null,
    status: r.status,
    rejections: r.rejections,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    tripId: r.tripId,
    reason: r.reason,
  };
}

@Injectable()
export class ExitRequestsService {
  private readonly log = new Logger(ExitRequestsService.name);

  constructor(
    @InjectRepository(ExitRequest) private readonly repo: Repository<ExitRequest>,
    private readonly events: EventsService,
  ) {}

  async pendingFor(vehicleId: string): Promise<ExitRequest | null> {
    return this.repo.findOne({ where: { vehicleId, status: 'pending' }, order: { createdAt: 'DESC' } });
  }

  /**
   * Cree une demande. Appelee a l'appui du bouton (ou a la sortie si le
   * bouton avait deja ete presse) : une demande par chargement, plusieurs
   * par camion et par jour — le superviseur les valide en fin de service.
   */
  async create(vehicleId: string, zone: { id: string; name: string } | null, exitedAt: Date, buttonPressed: boolean): Promise<ExitRequest> {
    const now = new Date();
    const r = await this.repo.save(
      this.repo.create({
        vehicleId,
        zoneId: zone?.id ?? null,
        zoneName: zone?.name ?? '',
        exitedAt,
        buttonPressedAt: buttonPressed ? now : null,
        status: 'pending',
        rejections: 0,
      }),
    );
    this.log.log(`${vehicleId} — demande de chargement (${zone?.name ?? 'zone ?'})`);
    this.publish(r);
    return r;
  }

  /**
   * Appui du bouton apres la sortie : complete une demande rejetee en
   * attente d'un nouvel appui, sinon en ouvre une nouvelle.
   */
  async pressButton(vehicleId: string, zone: { id: string; name: string } | null, exitedAt: Date): Promise<ExitRequest> {
    const rejected = await this.repo.findOne({ where: { vehicleId, status: 'pending', buttonPressedAt: IsNull() }, order: { createdAt: 'DESC' } });
    if (rejected) {
      rejected.buttonPressedAt = new Date();
      await this.repo.save(rejected);
      this.publish(rejected);
      return rejected;
    }
    return this.create(vehicleId, zone, exitedAt, true);
  }

  async confirm(id: string, actor: string, tripId: string): Promise<ExitRequest> {
    const r = await this.get(id);
    r.status = 'confirmed';
    r.tripId = tripId;
    r.decidedBy = actor;
    r.decidedAt = new Date();
    await this.repo.save(r);
    this.publish(r);
    return r;
  }

  /** Rejet : la demande reste ouverte, le bouton devra etre presse a nouveau. */
  async reject(id: string, actor: string): Promise<ExitRequest> {
    const r = await this.get(id);
    r.rejections += 1;
    r.buttonPressedAt = null;
    r.decidedBy = actor;
    r.decidedAt = new Date();
    await this.repo.save(r);
    this.publish(r);
    return r;
  }

  async bypass(id: string, actor: string, reason: string): Promise<ExitRequest> {
    const r = await this.get(id);
    r.status = 'bypassed';
    r.reason = reason;
    r.decidedBy = actor;
    r.decidedAt = new Date();
    await this.repo.save(r);
    this.publish(r);
    return r;
  }

  async openList(): Promise<ExitRequest[]> {
    return this.repo.find({ where: { status: 'pending' }, order: { createdAt: 'ASC' } });
  }

  async history(vehicleId?: string, limit = 100): Promise<ExitRequest[]> {
    return this.repo.find({ where: vehicleId ? { vehicleId } : {}, order: { createdAt: 'DESC' }, take: limit });
  }

  /**
   * Voyages reels : chaque demande de sortie ouvre un voyage, qui se termine au
   * premier retour du camion dans la meme zone (positions.zone_id), au plus tard
   * a la sortie suivante. Pas de retour => voyage en cours.
   */
  async voyages(vehicleId: string, limit = 60) {
    const m = this.repo.manager;
    const iso = (v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      const d = v instanceof Date ? v : new Date(String(v).includes('T') ? String(v) : `${String(v).replace(' ', 'T')}Z`);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    const exits: Array<{ id: string; zone_id: string | null; zone_name: string; exited_at: Date; button_pressed_at: Date | null; status: string; trip_id: string | null; reason: string | null }> =
      await m.query(
        'SELECT id, zone_id, zone_name, exited_at, button_pressed_at, status, trip_id, reason FROM exit_requests WHERE vehicle_id = ? ORDER BY exited_at DESC LIMIT ?',
        [vehicleId, limit],
      );
    const out: Array<Record<string, unknown>> = [];
    for (let i = 0; i < exits.length; i++) {
      const e = exits[i];
      const next = i > 0 ? exits[i - 1].exited_at : null;
      let returnedAt: string | null = null;
      let retRaw: unknown = null;
      if (e.zone_id) {
        // 2 min de marge : le GPS peut encore "rebondir" dans la zone juste apres la sortie.
        const params: unknown[] = [vehicleId, e.zone_id, e.exited_at];
        let sql = 'SELECT MIN(recorded_at) AS t FROM positions WHERE vehicle_id = ? AND zone_id = ? AND recorded_at > DATE_ADD(?, INTERVAL 2 MINUTE)';
        if (next) { sql += ' AND recorded_at <= ?'; params.push(next); }
        const rows: Array<{ t: unknown }> = await m.query(sql, params);
        returnedAt = iso(rows[0]?.t);
        retRaw = rows[0]?.t ?? null;
      }
      const fuel = retRaw ? await this.fuelUse(vehicleId, e.exited_at, retRaw) : { liters: null, km: null };
      out.push({
        id: e.id,
        zoneName: e.zone_name,
        exitedAt: iso(e.exited_at),
        buttonPressedAt: iso(e.button_pressed_at),
        returnedAt,
        nextExitAt: iso(next),
        status: e.status,
        reason: e.reason,
        tripId: e.trip_id,
        fuelLiters: fuel.liters,
        km: fuel.km,
      });
    }
    return out;
  }

  /**
   * Carburant consomme entre deux instants (fuel-v2).
   * depart (mediane a l'arret) - arrivee (mediane a l'arret) + pleins en route.
   * null = non mesurable : capteurs absents, boitier muet > 5 min en roulage, incoherence.
   */
  private async fuelUse(vehicleId: string, from: unknown, to: unknown): Promise<{ liters: number | null; km: number | null }> {
    const rows: Array<{ a: unknown; b: unknown; o: unknown; s: unknown; t: unknown }> = await this.repo.manager.query(
      'SELECT fuel_main AS a, fuel_aux AS b, odometer AS o, speed AS s, recorded_at AS t FROM positions WHERE vehicle_id = ? AND recorded_at >= ? AND recorded_at <= ? ORDER BY recorded_at',
      [vehicleId, from, to],
    );
    const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Date.parse(String(v).includes('T') ? String(v) : `${String(v).replace(' ', 'T')}Z`));
    const median = (xs: number[]) => {
      const a = [...xs].sort((x, y) => x - y);
      const k = Math.floor(a.length / 2);
      return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2;
    };

    // Trou de trames en roulage : km et carburant de ce voyage ne sont pas fiables.
    for (let i = 1; i < rows.length; i++) {
      const gap = ms(rows[i].t) - ms(rows[i - 1].t);
      if (gap > 5 * 60_000 && (Number(rows[i].s) > 5 || Number(rows[i - 1].s) > 5)) return { liters: null, km: null };
    }

    let o0: number | null = null;
    let o1: number | null = null;
    const pts: Array<{ tot: number; stopped: boolean }> = [];
    for (const r of rows) {
      const o = Number(r.o);
      if (o > 0) { if (o0 === null) o0 = o; o1 = o; }
      const tot = Number(r.a) + Number(r.b);
      if (Number.isFinite(tot) && tot > 0) pts.push({ tot, stopped: Number(r.s) <= 3 });
    }
    const km = o0 !== null && o1 !== null && o1 >= o0 ? o1 - o0 : null;
    if (pts.length < 4) return { liters: null, km };

    const firstStop = pts.filter((p) => p.stopped).slice(0, 5).map((p) => p.tot);
    const lastStop = pts.filter((p) => p.stopped).slice(-5).map((p) => p.tot);
    const start = median(firstStop.length >= 2 ? firstStop : pts.slice(0, 5).map((p) => p.tot));
    const end = median(lastStop.length >= 2 ? lastStop : pts.slice(-5).map((p) => p.tot));

    // Pleins : serie lissee (mediane glissante de 5), hausse > 25 L au-dessus du minimum courant.
    const sm = pts.map((_, i) => median(pts.slice(Math.max(0, i - 2), i + 3).map((p) => p.tot)));
    let refill = 0;
    let runMin = sm[0];
    let base = 0;
    let peak = 0;
    let filling = false;
    for (const v of sm) {
      if (filling) {
        if (v > peak) peak = v;
        else if (v < peak - 5) { refill += peak - base; filling = false; runMin = v; }
        continue;
      }
      if (v > runMin + 25) { filling = true; base = runMin; peak = v; continue; }
      if (v < runMin) runMin = v;
    }
    if (filling) refill += peak - base;

    const liters = start - end + refill;
    if (liters < -10) return { liters: null, km };
    return { liters: Math.max(0, Math.round(liters)), km };
  }

  /** Moyennes de consommation par camion sur les voyages termines de la periode (YYYY-MM-DD). */
  async fuelStats(from?: string, to?: string) {
    const ids: Array<{ v: string }> = await this.repo.manager.query('SELECT DISTINCT vehicle_id AS v FROM exit_requests');
    const out: Array<{ vehicleId: string; voyages: number; avgLiters: number | null; avgKm: number | null; l100: number | null }> = [];
    for (const { v } of ids) {
      const list = await this.voyages(v, 2000);
      let liters = 0, km = 0, count = 0;
      for (const x of list) {
        const day = String(x.exitedAt ?? '').slice(0, 10);
        if (!x.returnedAt || x.status === 'bypassed' || x.fuelLiters === null || x.fuelLiters === undefined) continue;
        if ((from && day < from) || (to && day > to)) continue;
        liters += Number(x.fuelLiters);
        km += Number(x.km ?? 0);
        count += 1;
      }
      out.push({
        vehicleId: v,
        voyages: count,
        avgLiters: count ? Math.round(liters / count) : null,
        avgKm: count ? Math.round(km / count) : null,
        l100: km >= 5 ? Math.round((liters / km) * 1000) / 10 : null,
      });
    }
    return out;
  }

  private async get(id: string): Promise<ExitRequest> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Demande de sortie inconnue');
    return r;
  }

  private publish(r: ExitRequest): void {
    this.events.publish({ type: 'exit_request', request: toView(r) });
  }
}
