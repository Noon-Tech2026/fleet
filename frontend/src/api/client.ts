import type { Alert, AuthUser, CommandAudit, Role, VehicleState } from '../lib/types';

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
