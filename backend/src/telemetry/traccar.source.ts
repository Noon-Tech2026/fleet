import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { TelemetrySource, PositionHandler, RawPosition } from './telemetry.source';

/**
 * Connexion réelle à Traccar.
 *
 * Le WebSocket de Traccar est lié à une session utilisateur et supporte mal
 * les connexions multiples : on en ouvre UNE seule ici, et le backend
 * rediffuse ensuite en SSE à tous les navigateurs.
 *
 * Non testé contre un serveur réel tant que le boîtier pilote n'est pas
 * installé — la correspondance des attributs (in1, in2, out1, adc1, adc2)
 * devra être vérifiée sur le FMC650 à l'installation.
 */
@Injectable()
export class TraccarSource implements TelemetrySource, OnModuleDestroy {
  private readonly log = new Logger(TraccarSource.name);
  private ws?: WebSocket;
  private cookie = '';
  private deviceToVehicle = new Map<number, string>();
  private reconnectDelay = 2000;
  private stopped = false;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('TRACCAR_URL', 'http://localhost:8082');
  }

  async start(onPosition: PositionHandler): Promise<void> {
    await this.login();
    await this.loadDevices();
    this.connect(onPosition);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private async login(): Promise<void> {
    const body = new URLSearchParams({
      email: this.config.getOrThrow<string>('TRACCAR_USER'),
      password: this.config.getOrThrow<string>('TRACCAR_PASSWORD'),
    });

    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Authentification Traccar refusée (${res.status})`);

    this.cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
    this.log.log('Session Traccar ouverte');
  }

  private async loadDevices(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/devices`, { headers: { Cookie: this.cookie } });
    const devices = (await res.json()) as { id: number; name: string; uniqueId: string }[];
    for (const d of devices) this.deviceToVehicle.set(d.id, d.name);
    this.log.log(`${devices.length} boîtiers connus`);
  }

  private connect(onPosition: PositionHandler): void {
    const url = this.baseUrl.replace(/^http/, 'ws') + '/api/socket';
    this.ws = new WebSocket(url, { headers: { Cookie: this.cookie } });

    this.ws.on('open', () => {
      this.reconnectDelay = 2000;
      this.log.log('Flux Traccar connecté');
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(raw.toString()) as { positions?: TraccarPosition[] };
        for (const p of payload.positions ?? []) {
          const mapped = this.map(p);
          if (mapped) onPosition(mapped);
        }
      } catch (err) {
        this.log.error(`Trame illisible : ${String(err)}`);
      }
    });

    this.ws.on('close', () => {
      if (this.stopped) return;
      this.log.warn(`Flux Traccar coupé, reconnexion dans ${this.reconnectDelay} ms`);
      setTimeout(() => this.restart(onPosition), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
    });

    this.ws.on('error', (err: Error) => this.log.error(`WebSocket : ${err.message}`));
  }

  private async restart(onPosition: PositionHandler): Promise<void> {
    try {
      await this.login();
      this.connect(onPosition);
    } catch (err) {
      this.log.error(`Reconnexion échouée : ${String(err)}`);
      setTimeout(() => this.restart(onPosition), this.reconnectDelay);
    }
  }

  private map(p: TraccarPosition): RawPosition | null {
    const vehicleId = this.deviceToVehicle.get(p.deviceId);
    if (!vehicleId) return null;
    const a = p.attributes ?? {};
    return {
      vehicleId,
      lat: p.latitude,
      lon: p.longitude,
      speed: Math.round(p.speed * 1.852), // nœuds → km/h
      course: p.course,
      ignition: Boolean(a.ignition ?? a.in1),
      buttonPressed: Boolean(a.in2),
      outputActive: Boolean(a.out1),
      fuelMainVolts: Number(a.adc1 ?? 0),
      fuelAuxVolts: Number(a.adc2 ?? 0),
      odometer: Math.round(Number(a.totalDistance ?? 0) / 1000),
      engineHours: Math.round(Number(a.hours ?? 0) / 3_600_000),
      battery: Number(a.power ?? 0),
      gsm: Number(a.sat ?? 0),
      at: new Date(p.deviceTime ?? p.fixTime),
    };
  }

  async setDigitalOutput(vehicleId: string, output: 1 | 2, active: boolean): Promise<void> {
    const deviceId = [...this.deviceToVehicle.entries()].find(([, name]) => name === vehicleId)?.[0];
    if (!deviceId) throw new Error(`Aucun boîtier associé à ${vehicleId}`);

    // Commande GPRS Teltonika : setdigout 1 = actif, 0 = inactif.
    const value = active ? '1' : '0';
    const res = await fetch(`${this.baseUrl}/api/commands/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: this.cookie },
      body: JSON.stringify({
        deviceId,
        type: 'custom',
        attributes: { data: `setdigout ${output === 1 ? value : '?'}${output === 2 ? value : ''}` },
      }),
    });

    if (!res.ok) throw new Error(`Commande refusée par Traccar (${res.status})`);
  }
}

interface TraccarPosition {
  deviceId: number;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  deviceTime?: string;
  fixTime: string;
  attributes?: Record<string, unknown>;
}
