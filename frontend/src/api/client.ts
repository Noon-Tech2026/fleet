import type { Alert, AuthUser, ClientRecord, CommandAudit, ContainerSize, DriverRecord, MaintenanceKind, MaintenanceLogEntry, MaintenancePlanState, Role, TripEntry, VehicleAccountingSummary, VehicleExpenseCategory, VehicleExpenseEntry, VehicleInvestmentEntry, VehicleInvestmentKind, VehicleState, TrackPoint, Zone, ZoneInput, ExitRequestView , ExpenseCategoryRecord } from '../lib/types';
import { notifyDataChanged } from '../lib/dataChanged';

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
  model: string | null;
  simNumber: string | null;
  initialOdometer: number | null;
  tankMainCapacity: number;
  tankAuxCapacity: number;
  notes: string | null;
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

  const method = (init?.method ?? 'GET').toUpperCase();
  const body = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  // Ecriture reussie : les ecrans ouverts se rechargent (useDataChanged).
  if (method !== 'GET' && !path.includes('/auth/')) notifyDataChanged(path);
  return body;
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

/** ?from=&to= (YYYY-MM-DD) si renseignes. */
function rangeQs(range?: { from?: string; to?: string }): string {
  const q = new URLSearchParams();
  if (range?.from) q.set('from', range.from);
  if (range?.to) q.set('to', range.to);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export interface DriverLedger {
  driverId: string;
  period: { fees: number; feesCount: number; salaries: number; paid: number; balance: number };
  overall: { fees: number; salaries: number; paid: number; balance: number };
  salaries: { id: string; month: string; amount: number; paid: boolean }[];
  fees: { expenseId: string; tripId: string | null; vehicleId: string; at: string; amount: number; origin: string | null; destination: string | null; containers: string; paid: boolean; retourVideAt: string | null; retourVideBy: string | null }[];
  payments: { id: string; kind: 'fee' | 'salary' | 'advance' | 'other'; at: string; amount: number; notes: string | null; createdBy: string }[];
}

/** Resultat de la recherche par conteneur. */
export interface ContainerHit {
  containerNumber: string | null;
  size: string;
  tripId: string;
  clientId: string;
  clientName: string;
  vehicleId: string;
  plate: string | null;
  driverName: string | null;
  startedAt: string;
  endedAt: string | null;
  origin: string | null;
  destination: string | null;
  amount: number;
  paid: boolean;
  notes: string | null;
  otherContainers: string[];
}

export interface ClientLedger {
  clientId: string;
  period: { debit: number; credit: number; balance: number };
  overall: { debit: number; credit: number; balance: number };
  lines: { id: string; type: 'trip' | 'entry'; kind: 'debit' | 'credit'; at: string; amount: number; label: string; tripId: string | null; vehicleId: string | null; deletable: boolean }[];
}

/** Charge a credit non reglee. */
export interface PayableItem {
  id: string;
  vehicleId: string;
  category: string;
  amount: number;
  at: string;
  supplier: string | null;
  reference: string | null;
  notes: string | null;
}

export interface CashJournal {
  period: { debit: number; credit: number; balance: number };
  overall: { debit: number; credit: number; balance: number };
  lines: { id: string; kind: 'debit' | 'credit'; at: string; amount: number; label: string; source: 'client' | 'driver' | 'manual' | 'versement' | 'expense'; deletable: boolean }[];
}

export interface AccountingOverview {
  revenue: number; driverCharges: number; truckCharges: number; afterCharges: number;
  versements: number; afterVersements: number; investments: number; afterInvestments: number;
}
export interface VersementRecord { id: string; at: string; amount: number; label: string; createdBy: string }

export const api = {
  accountingOverview: (range?: { from?: string; to?: string }) => request<AccountingOverview>(`/api/accounting/overview${rangeQs(range)}`),
  versements: (range?: { from?: string; to?: string }) => request<VersementRecord[]>(`/api/accounting/versements${rangeQs(range)}`),
  addVersement: (input: { amount: number; at?: string; label: string }) => request<VersementRecord>('/api/accounting/versements', { method: 'POST', body: JSON.stringify(input) }),
  deleteVersement: (id: string) => request<{ ok: true }>(`/api/accounting/versements/${id}`, { method: 'DELETE' }),
  cashJournal: (range?: { from?: string; to?: string }) => request<CashJournal>(`/api/accounting/cash${rangeQs(range)}`),
  addCashEntry: (input: { kind: 'debit' | 'credit'; amount: number; at?: string; label: string }) =>
    request<unknown>('/api/accounting/cash/entries', { method: 'POST', body: JSON.stringify(input) }),
  deleteCashEntry: (id: string) => request<{ ok: true }>(`/api/accounting/cash/entries/${id}`, { method: 'DELETE' }),
  payables: () => request<{ total: number; items: PayableItem[] }>('/api/accounting/payables'),
  payExpense: (id: string, at?: string) =>
    request<VehicleExpenseEntry>(`/api/accounting/expenses/${id}/pay`, { method: 'POST', body: JSON.stringify({ at }) }),
  unpayExpense: (id: string) => request<VehicleExpenseEntry>(`/api/accounting/expenses/${id}/unpay`, { method: 'POST' }),
  expenseCategories: (all = false) => request<ExpenseCategoryRecord[]>(`/api/accounting/expense-categories${all ? '?all=1' : ''}`),
  saveExpenseCategory: (input: { id?: string; labelFr: string; labelEn?: string; labelAr?: string; active?: boolean; sortOrder?: number }) =>
    request<ExpenseCategoryRecord>('/api/accounting/expense-categories', { method: 'POST', body: JSON.stringify(input) }),
  deleteExpenseCategory: (id: string) => request<{ ok: true }>(`/api/accounting/expense-categories/${id}`, { method: 'DELETE' }),
  searchContainers: (q: string) =>
    request<ContainerHit[]>(`/api/accounting/containers/search?q=${encodeURIComponent(q)}`),
  clientLedger: (id: string, range?: { from?: string; to?: string }) =>
    request<ClientLedger>(`/api/accounting/clients/${id}/ledger${rangeQs(range)}`),
  addClientEntry: (id: string, input: { kind: 'debit' | 'credit'; amount: number; at?: string; label: string }) =>
    request<unknown>(`/api/accounting/clients/${id}/entries`, { method: 'POST', body: JSON.stringify(input) }),
  deleteClientEntry: (entryId: string) =>
    request<{ ok: true }>(`/api/accounting/clients/entries/${entryId}`, { method: 'DELETE' }),
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

  vehicleCommands: (id: string) => request<CommandAudit[]>(`/api/vehicles/${id}/commands`),

  confirmDeparture: (id: string) =>
    request<VehicleState>(`/api/vehicles/${id}/departure/confirm`, { method: 'POST' }),

  pressButton: (id: string) =>
    request<{ ok: boolean }>(`/api/simulator/vehicles/${id}/press-button`, { method: 'POST' }),

  /* --- entretien --- */
  maintenanceCatalog: () => request<{ kind: string; label: string }[]>('/api/maintenance/catalog'),
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
    body: { intervalKm?: number; intervalHours?: number; intervalDays?: number; remindKm?: number; remindHours?: number; remindDays?: number; notes?: string },
  ) =>
    request<MaintenancePlanState>(`/api/vehicles/${id}/maintenance/${kind}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteMaintenancePlan: (planId: string) =>
    request<{ ok: true }>(`/api/maintenance/plans/${encodeURIComponent(planId)}`, { method: 'DELETE' }),
  deleteMaintenanceLog: (logId: string) =>
    request<{ ok: true }>(`/api/maintenance/logs/${encodeURIComponent(logId)}`, { method: 'DELETE' }),
  applyMaintenanceCatalog: (id: string) =>
    request<MaintenancePlanState[]>(`/api/vehicles/${id}/maintenance`, { method: 'POST' }),

  /* --- comptabilite --- */
  accountingSummary: (range?: { from?: string; to?: string }) => request<VehicleAccountingSummary[]>(`/api/accounting/summary${rangeQs(range)}`),

  vehicleAccountingSummary: (id: string, range?: { from?: string; to?: string }) =>
    request<VehicleAccountingSummary>(`/api/vehicles/${id}/accounting-summary${rangeQs(range)}`),

  clients: () => request<ClientRecord[]>('/api/accounting/clients'),

  createClient: (input: { name: string; contact?: string; notes?: string }) =>
    request<ClientRecord>('/api/accounting/clients', { method: 'POST', body: JSON.stringify(input) }),

  /** `null` vide un champ optionnel ; une cle absente le laisse inchange. */
  updateClient: (
    id: string,
    patch: { name?: string; contact?: string | null; notes?: string | null; active?: boolean },
  ) => request<ClientRecord>(`/api/accounting/clients/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  /** Refuse (409) si le client a deja des voyages : il faut alors le desactiver. */
  deleteClient: (id: string) => request<void>(`/api/accounting/clients/${id}`, { method: 'DELETE' }),

  driverLedger: (id: string, range?: { from?: string; to?: string }) =>
    request<DriverLedger>(`/api/accounting/drivers/${id}/ledger${rangeQs(range)}`),
  declareDriverSalary: (id: string, input: { month: string; amount?: number }) =>
    request<unknown>(`/api/accounting/drivers/${id}/salaries`, { method: 'POST', body: JSON.stringify(input) }),
  deleteDriverSalary: (salaryId: string) => request<{ ok: true }>(`/api/accounting/drivers/salaries/${salaryId}`, { method: 'DELETE' }),
  addDriverPayment: (id: string, input: { amount?: number; feeIds?: string[]; salaryId?: string; kind?: 'fee' | 'salary' | 'advance' | 'other'; at?: string; notes?: string }) =>
    request<DriverLedger['payments'][number]>(`/api/accounting/drivers/${id}/payments`, { method: 'POST', body: JSON.stringify(input) }),
  setRetourVide: (expenseId: string, received: boolean) =>
    request<{ ok: true; retourVideAt: string | null }>(`/api/accounting/drivers/fees/${expenseId}/retour-vide`, { method: 'POST', body: JSON.stringify({ received }) }),
  deleteDriverPayment: (paymentId: string) =>
    request<{ ok: true }>(`/api/accounting/drivers/payments/${paymentId}`, { method: 'DELETE' }),
  driverFees: (id: string, range?: { from?: string; to?: string }) =>
    request<{ driverId: string; count: number; total: number; items: { expenseId: string; tripId: string | null; vehicleId: string; at: string; amount: number; origin: string | null; destination: string | null }[] }>(`/api/accounting/drivers/${id}/fees${rangeQs(range)}`),
  drivers: () => request<DriverRecord[]>('/api/accounting/drivers'),

  createDriver: (input: { fullName: string; phone?: string; licenseNumber?: string | null; tripFee?: number; monthlySalary?: number; vehicleId?: string | null }) =>
    request<DriverRecord>('/api/accounting/drivers', { method: 'POST', body: JSON.stringify(input) }),

  updateDriver: (
    id: string,
    patch: { fullName?: string; phone?: string | null; licenseNumber?: string | null; tripFee?: number; monthlySalary?: number; vehicleId?: string | null; active?: boolean },
  ) => request<DriverRecord>(`/api/accounting/drivers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteDriver: (id: string) => request<void>(`/api/accounting/drivers/${id}`, { method: 'DELETE' }),

  vehicleTrips: (id: string, range?: { from?: string; to?: string }) => request<TripEntry[]>(`/api/vehicles/${id}/trips${rangeQs(range)}`),

  createTrip: (input: {
    vehicleId: string;
    driverId: string;
    clientId: string;
    startedAt: string;
    endedAt?: string;
    origin?: string;
    destination?: string;
    amount: number; paid?: boolean;
    notes?: string;
    containers: { containerNumber?: string; size: ContainerSize; loaded?: boolean; notes?: string }[];
  }) => request<TripEntry>('/api/accounting/trips', { method: 'POST', body: JSON.stringify(input) }),

  updateTrip: (id: string, patch: { driverId?: string; clientId?: string; startedAt?: string; endedAt?: string; origin?: string; destination?: string; amount?: number; paid?: boolean; notes?: string; containers?: { containerNumber?: string; size: ContainerSize; loaded?: boolean; notes?: string }[] }) =>
    request<TripEntry>(`/api/accounting/trips/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteTrip: (id: string) => request<{ ok: true }>(`/api/accounting/trips/${id}`, { method: 'DELETE' }),

  updateExpense: (id: string, patch: { category?: VehicleExpenseCategory; amount?: number; at?: string; reference?: string; notes?: string; payment?: 'cash' | 'credit'; supplier?: string }) =>
    request<VehicleExpenseEntry>(`/api/accounting/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteExpense: (id: string) => request<{ ok: true }>(`/api/accounting/expenses/${id}`, { method: 'DELETE' }),

  updateInvestment: (id: string, patch: { kind?: VehicleInvestmentKind; amount?: number; at?: string; description?: string }) =>
    request<VehicleInvestmentEntry>(`/api/accounting/investments/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteInvestment: (id: string) => request<{ ok: true }>(`/api/accounting/investments/${id}`, { method: 'DELETE' }),

  vehicleExpenses: (id: string, range?: { from?: string; to?: string }) => request<VehicleExpenseEntry[]>(`/api/vehicles/${id}/expenses${rangeQs(range)}`),

  addExpense: (
    id: string,
    input: { category: VehicleExpenseCategory; amount: number; at?: string; reference?: string; notes?: string; payment?: 'cash' | 'credit'; supplier?: string },
  ) =>
    request<VehicleExpenseEntry>(`/api/vehicles/${id}/expenses`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  vehicleInvestments: (id: string, range?: { from?: string; to?: string }) => request<VehicleInvestmentEntry[]>(`/api/vehicles/${id}/investments${rangeQs(range)}`),

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
  exitRequestsOpen: () => request<ExitRequestView[]>('/api/exit-requests/open'),
  confirmExit: (id: string, tripId: string) =>
    request<ExitRequestView>(`/api/exit-requests/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify({ tripId }) }),
  rejectExit: (id: string) => request<ExitRequestView>(`/api/exit-requests/${encodeURIComponent(id)}/reject`, { method: 'POST' }),
  bypassExit: (id: string, reason: string) =>
    request<ExitRequestView>(`/api/exit-requests/${encodeURIComponent(id)}/bypass`, { method: 'POST', body: JSON.stringify({ reason }) }),
  zones: () => request<Zone[]>('/api/zones'),
  zonesAll: () => request<Zone[]>('/api/zones/all'),
  createZone: (input: ZoneInput) => request<Zone>('/api/zones', { method: 'POST', body: JSON.stringify(input) }),
  updateZone: (id: string, input: ZoneInput) =>
    request<Zone>(`/api/zones/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteZone: (id: string) => request<{ id: string; deleted: boolean }>(`/api/zones/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deactivateZone: (id: string) => request<Zone>(`/api/zones/${encodeURIComponent(id)}/deactivate`, { method: 'POST' }),
  silencePerimeter: (id: string) =>
    request<{ vehicleId: string; silenced: boolean }>(`/api/vehicles/${encodeURIComponent(id)}/perimeter/silence`, { method: 'POST' }),
  /** Positions historisees entre deux instants (ISO). */
  vehicleTrack: (id: string, from: string, to: string) =>
    request<TrackPoint[]>(
      `/api/vehicles/${encodeURIComponent(id)}/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

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

  /** Reserve au role admin cote serveur. L'IMEI n'est volontairement pas expose ici. */
  updateVehicle: (
    id: string,
    patch: { plate?: string; driver?: string; model?: string; simNumber?: string; initialOdometer?: number; tankMainCapacity?: number; tankAuxCapacity?: number; notes?: string },
  ) =>
    request<VehicleDirectoryEntry>(`/api/fleet/vehicles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

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
