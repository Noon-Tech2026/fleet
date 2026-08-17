import type { Role } from './types';

export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Consultation',
  operator: 'Exploitation',
  supervisor: 'Superviseur',
  admin: 'Administrateur',
};

/**
 * Ce que le rôle ajoute par rapport au précédent. Affiché au moment du
 * choix : un intitulé seul ne dit pas qu'un superviseur peut immobiliser
 * un camion.
 */
export const ROLE_HINT: Record<Role, string> = {
  viewer: 'Carte, fiches, alertes et historique.',
  operator: 'Confirmer un départ, acquitter une alerte.',
  supervisor: 'Bloquer et réautoriser un démarreur, gérer zones et calibrations.',
  admin: 'Gérer les comptes et le répertoire des véhicules.',
};

/** Longueur imposée par le serveur (CreateUserDto). Dupliquée ici pour
 *  refuser avant l'aller-retour, jamais à la place du serveur. */
export const PASSWORD_MIN_LENGTH = 12;

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789.-_';

/** Mot de passe tiré au sort côté navigateur : un administrateur qui doit
 *  en inventer un finit toujours par réutiliser le même. */
export function generatePassword(length = 18): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]).join('');
}

export function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
