import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExpenseCategoryRecord } from './types';
import { api } from '../api/client';
import { EXPENSE_CATEGORY_LABEL } from './accounting';

let cache: ExpenseCategoryRecord[] | null = null;
let inflight: Promise<ExpenseCategoryRecord[]> | null = null;

export function invalidateExpenseCategories(): void { cache = null; }

/** Catalogue des charges (actives), charge une fois ; libelle selon la langue. */
export function useExpenseCategories(all = false) {
  const { i18n } = useTranslation();
  const [list, setList] = useState<ExpenseCategoryRecord[]>(cache ?? []);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (all) { api.expenseCategories(true).then(setList).catch(() => setList([])); return; }
    if (cache) { setList(cache); return; }
    inflight ??= api.expenseCategories().then((r) => { cache = r; return r; });
    inflight.then(setList).catch(() => setList([])).finally(() => { inflight = null; });
  }, [all, version]);
  const label = (id: string): string => {
    const c = list.find((x) => x.id === id);
    if (!c) return EXPENSE_CATEGORY_LABEL[id] ?? id;
    const lang = i18n.language.slice(0, 2);
    return (lang === 'ar' && c.labelAr) || (lang === 'en' && c.labelEn) || c.labelFr;
  };
  return { categories: list, label, refresh: () => { invalidateExpenseCategories(); setVersion((v) => v + 1); } };
}
