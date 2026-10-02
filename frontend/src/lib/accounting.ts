import type { VehicleInvestmentKind } from './types';

/** Libelles de secours pour les charges anciennes (le catalogue fait foi). */
export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  driver: 'Prime chauffeur', fuel: 'Carburant', tires: 'Pneus', insurance: 'Assurance', toll: 'Péage', salary: 'Salaire', fine: 'Amende', other: 'Autre',
};

export const INVESTMENT_KIND_LABEL: Record<VehicleInvestmentKind, string> = {
  purchase: 'Achat',
  equipment: 'Équipement',
  overhaul: 'Réfection lourde',
  other: 'Autre',
};

export function formatMoney(value: number): string {
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MRU`;
}
