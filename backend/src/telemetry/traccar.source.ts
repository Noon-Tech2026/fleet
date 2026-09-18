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
 * Le répertoire des boîtiers est aussi tenu à jour ici : créer un camion
 * depuis l'interface crée le boîtier dans Traccar (name = code véhicule,
 * uniqueId = IMEI). Sans cela, il faudrait le saisir deux fois.
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

  /** Appel REST authentifié ; rouvre la session une fois si elle a expiré. */
  private async api(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}), Cookie: this.cookie },
    });
    if (res.status === 401 && retry) {
      await this.login();
      return this.api(path, init, false);
    }
    return res;
  }

  private async loadDevices(): Promise<void> {
    const res = await this.api('/api/devices');
    const devices = (await res.json()) as TraccarDevice[];
    for (const d of devices) this.deviceToVehicle.set(d.id, d.name);
    this.log.log(`${devices.length} boîtiers connus`);
  }

  private async findDevice(vehicleId: string): Promise<TraccarDevice | null> {
    const res = await this.api('/api/devices');
    if (!res.ok) throw new Error(`Traccar injoignable (${res.status})`);
    const devices = (await res.json()) as TraccarDevice[];
    return devices.find((d) => d.name === vehicleId) ?? null;
  }

  private async fail(prefix: string, res: Response): Promise<never> {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`${prefix} (${res.status})${detail ? ` : ${detail}` : ''}`);
  }

  /* --- répertoire des boîtiers ----------------------------------------- */

  async registerDevice(vehicleId: string, imei: string): Promise<void> {
    const existing = await this.findDevice(vehicleId);
    if (existing) {
      // Déjà là avec le même IMEI (ex. créé à la main) : on réutilise.
      if (existing.uniqueId === imei) {
        this.deviceToVehicle.set(existing.id, vehicleId);
        return;
      }
      throw new Error(`Traccar : un boîtier nommé ${vehicleId} existe déjà avec l'IMEI ${existing.uniqueId}`);
    }

    const res = await this.api('/api/devices', {
      method: 'POST',
      body: JSON.stringify({ name: vehicleId, uniqueId: imei }),
    });
    if (!res.ok) await this.fail('Traccar a refusé la création du boîtier', res);

    const device = (await res.json()) as TraccarDevice;
    // Sans cette ligne, les positions du nouveau boîtier seraient ignorées
    // jusqu'au prochain redémarrage (la carte n'est chargée qu'au boot).
    this.deviceToVehicle.set(device.id, vehicleId);
    this.log.log(`Boîtier ${vehicleId} (${imei}) enregistré dans Traccar`);
  }

  async updateDeviceImei(vehicleId: string, imei: string): Promise<void> {
    const device = await this.findDevice(vehicleId);
    if (!device) return this.registerDevice(vehicleId, imei);
    if (device.uniqueId === imei) return;

    // Traccar exige l'objet complet en PUT.
    const res = await this.api(`/api/devices/${device.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...device, uniqueId: imei }),
    });
    if (!res.ok) await this.fail('Traccar a refusé la modification du boîtier', res);
    this.log.log(`Boîtier ${vehicleId} : IMEI ${device.uniqueId} → ${imei}`);
  }

  async setDeviceEnabled(vehicleId: string, enabled: boolean): Promise<void> {
    const device = await this.findDevice(vehicleId);
    if (!device) return;
    const res = await this.api(`/api/devices/${device.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...device, disabled: !enabled }),
    });
    if (!res.ok) await this.fail('Traccar a refusé la modification du boîtier', res);
  }

  /** Utilisé uniquement en rollback d'une création échouée côté base. */
  async unregisterDevice(vehicleId: string): Promise<void> {
    const device = await this.findDevice(vehicleId);
    if (!device) return;
    const res = await this.api(`/api/devices/${device.id}`, { method: 'DELETE' });
    if (!res.ok) await this.fail('Traccar a refusé la suppression du boîtier', res);
    this.deviceToVehicle.delete(device.id);
  }

  /* --- flux de positions ------------------------------------------------ */

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
      await this.loadDevices();
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
    const res = await this.api('/api/commands/send', {
      method: 'POST',
      body: JSON.stringify({
        deviceId,
        type: 'custom',
        attributes: { data: `setdigout ${output === 1 ? value : '?'}${output === 2 ? value : ''}` },
      }),
    });

    if (!res.ok) throw new Error(`Commande refusée par Traccar (${res.status})`);
  }
}

interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  disabled?: boolean;
  [key: string]: unknown;
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
