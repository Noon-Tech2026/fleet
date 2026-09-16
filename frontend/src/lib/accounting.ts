import type { VehicleExpenseCategory, VehicleInvestmentKind } from './types';

export const EXPENSE_CATEGORY_LABEL: Record<VehicleExpenseCategory, string> = {
  fuel: 'Carburant',
  tires: 'Pneus',
  insurance: 'Assurance',
  toll: 'Péage',
  salary: 'Salaire',
  fine: 'Amende',
  other: 'Autre',
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
