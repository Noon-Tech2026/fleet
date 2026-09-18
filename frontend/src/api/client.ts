import type {
  Alert,
  AuthUser,
  ClientRecord,
  CommandAudit,
  ContainerSize,
  DriverRecord,
  MaintenanceKind,
  MaintenanceLogEntry,
  MaintenancePlanState,
  Role,
  TripEntry,
  VehicleAccountingSummary,
  VehicleExpenseCategory,
  VehicleExpenseEntry,
  VehicleInvestmentEntry,
  VehicleInvestmentKind,
  VehicleState,
} from '../lib/types';

/**
 * Repertoire d'un vehicule (fiche administrative), independant de sa
 * telemetrie : existe des la creation, meme si le boitier n'a encore rien
 * transmis — contrairement a VehicleState, alimente par le flux SSE.
 */
export interface VehicleDirectoryEntry {
  id: string;
  plate: string;
  driver: string;
  imei: string;
  model: string;
  active: boolean;
}

/** Declenche quand la session est definitivement perdue. */
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

let refreshing: Promise<boolean> | null = null;

/**
 * Le jeton d'acces dure 15 minutes. Plutot que de deconnecter l'exploitant
 * en pleine surveillance, on tente un rafraichissement silencieux au premier
 * 401, puis on rejoue la requete une seule fois.
 *
 * `refreshing` evite que dix appels simultanes lancent dix rafraichissements
 * concurrents — la rotation des jetons cote serveur les ferait tous echouer
 * sauf un, et couperait la session.
 */
async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include', // indispensable : la session est dans un cookie httpOnly
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (res.status === 401 && retry && !path.includes('/auth/')) {
    const recovered = await refreshSession();
    if (recovered) return request<T>(path, init, false);
    onSessionLost?.();
    throw new Error('Session expiree');
  }

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Remonte le message du serveur plutot qu'un code HTTP nu. */
async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const message = body.message;
    if (Array.isArray(message)) return message.join(' · ');
    if (typeof message === 'string') return message;
  } catch {
    /* corps non JSON */
  }
  return `Erreur ${res.status}`;
}

export const api = {
  /* --- session --- */
  login: (email: string, password: string) =>
    request<AuthUser>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<AuthUser>('/api/auth/me'),

  /* --- flotte --- */
  vehicles: () => request<VehicleState[]>('/api/vehicles'),
  alerts: () => request<Alert[]>('/api/alerts'),

  /**
   * `applied: false` dans la reponse signifie que la commande attend
   * l'arret du vehicule — ce n'est pas une erreur.
   */
  blockStarter: (id: string, reason: string) =>
    request<CommandAudit>(`/api/vehicles/${id}/starter/block`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  releaseStarter: (id: string, reason: string) =>
    request<CommandAudit>(`/api/vehicles/${id}/starter/release`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  confirmDeparture: (id: string) =>
    request<VehicleState>(`/api/vehicles/${id}/departure/confirm`, { method: 'POST' }),

  pressButton: (id: string) =>
    request<{ ok: boolean }>(`/api/simulator/vehicles/${id}/press-button`, { method: 'POST' }),

  /* --- entretien --- */
  maintenance: () => request<MaintenancePlanState[]>('/api/maintenance'),

  vehicleMaintenance: (id: string) =>
    request<MaintenancePlanState[]>(`/api/vehicles/${id}/maintenance`),

  maintenanceLogs: (vehicleId?: string) =>
    request<MaintenanceLogEntry[]>(
      vehicleId ? `/api/maintenance/logs?vehicleId=${encodeURIComponent(vehicleId)}` : '/api/maintenance/logs',
    ),

  /** Consigne un entretien realise et repousse l'echeance. */
  recordService: (
    id: string,
    kind: MaintenanceKind,
    body: {
      at?: string;
      odometer?: number;
      engineHours?: number;
      partReference?: string;
      cost?: number;
      notes?: string;
    },
  ) =>
    request<MaintenancePlanState>(`/api/vehicles/${id}/maintenance/${kind}/service`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Reglage des periodicites — superviseur cote serveur. */
  saveMaintenancePlan: (
    id: string,
    kind: MaintenanceKind,
    body: { intervalKm?: number; intervalHours?: number; intervalDays?: number; notes?: string },
  ) =>
    request<MaintenancePlanState>(`/api/vehicles/${id}/maintenance/${kind}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  applyMaintenanceCatalog: (id: string) =>
    request<MaintenancePlanState[]>(`/api/vehicles/${id}/maintenance`, { method: 'POST' }),

  /* --- comptabilite --- */
  accountingSummary: () => request<VehicleAccountingSummary[]>('/api/accounting/summary'),

  vehicleAccountingSummary: (id: string) =>
    request<VehicleAccountingSummary>(`/api/vehicles/${id}/accounting-summary`),

  clients: () => request<ClientRecord[]>('/api/accounting/clients'),

  createClient: (input: { name: string; contact?: string; notes?: string }) =>
    request<ClientRecord>('/api/accounting/clients', { method: 'POST', body: JSON.stringify(input) }),

  drivers: () => request<DriverRecord[]>('/api/accounting/drivers'),

  createDriver: (input: { fullName: string; phone?: string; licenseNumber?: string }) =>
    request<DriverRecord>('/api/accounting/drivers', { method: 'POST', body: JSON.stringify(input) }),

  vehicleTrips: (id: string) => request<TripEntry[]>(`/api/vehicles/${id}/trips`),

  createTrip: (input: {
    vehicleId: string;
    driverId: string;
    clientId: string;
    startedAt: string;
    endedAt?: string;
    origin?: string;
    destination?: string;
    amount: number;
    notes?: string;
    containers: { containerNumber?: string; size: ContainerSize; loaded?: boolean; notes?: string }[];
  }) => request<TripEntry>('/api/accounting/trips', { method: 'POST', body: JSON.stringify(input) }),

  vehicleExpenses: (id: string) => request<VehicleExpenseEntry[]>(`/api/vehicles/${id}/expenses`),

  addExpense: (
    id: string,
    input: { category: VehicleExpenseCategory; amount: number; at?: string; reference?: string; notes?: string },
  ) =>
    request<VehicleExpenseEntry>(`/api/vehicles/${id}/expenses`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  vehicleInvestments: (id: string) => request<VehicleInvestmentEntry[]>(`/api/vehicles/${id}/investments`),

  addInvestment: (
    id: string,
    input: { kind: VehicleInvestmentKind; amount: number; at?: string; description?: string },
  ) =>
    request<VehicleInvestmentEntry>(`/api/vehicles/${id}/investments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /* --- repertoire des vehicules --- */
  fleetVehicles: () => request<VehicleDirectoryEntry[]>('/api/fleet/vehicles'),

  /** Reserve au role admin cote serveur. */
  createVehicle: (input: {
    id: string;
    plate: string;
    imei: string;
    model?: string;
    simNumber?: string;
    initialOdometer?: number;
    tankMainCapacity?: number;
    tankAuxCapacity?: number;
    notes?: string;
  }) => request<VehicleDirectoryEntry>('/api/fleet/vehicles', { method: 'POST', body: JSON.stringify(input) }),

  /* --- comptes (reserve au role admin cote serveur) --- */
  users: () => request<AuthUser[]>('/api/users'),

  createUser: (input: { email: string; fullName: string; role: Role; password: string }) =>
    request<AuthUser>('/api/users', { method: 'POST', body: JSON.stringify(input) }),

  updateUser: (id: string, patch: { role?: Role; active?: boolean; fullName?: string }) =>
    request<AuthUser>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  /** Coupe aussi toutes les sessions ouvertes de l'utilisateur. */
  resetUserPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/api/users/${id}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
};
