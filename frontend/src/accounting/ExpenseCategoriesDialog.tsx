import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExpenseCategoryRecord } from '../lib/types';
import { api } from '../api/client';
import { useExpenseCategories } from '../lib/useExpenseCategories';

interface Props { onClose: () => void }

/** Administration du catalogue des charges : ajouter, renommer, activer/desactiver, supprimer. */
export function ExpenseCategoriesDialog({ onClose }: Props) {
  const { t } = useTranslation();
  const { categories, refresh } = useExpenseCategories(true);
  const [editing, setEditing] = useState<Partial<ExpenseCategoryRecord> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !editing.labelFr || editing.labelFr.trim().length < 2) return;
    setBusy(true); setError(null);
    try {
      await api.saveExpenseCategory({ id: editing.id, labelFr: editing.labelFr, labelEn: editing.labelEn ?? undefined, labelAr: editing.labelAr ?? undefined, active: editing.active, sortOrder: editing.sortOrder });
      setEditing(null); refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function toggle(c: ExpenseCategoryRecord) {
    await api.saveExpenseCategory({ id: c.id, labelFr: c.labelFr, labelEn: c.labelEn ?? undefined, labelAr: c.labelAr ?? undefined, active: !c.active }); refresh();
  }
  async function remove(c: ExpenseCategoryRecord) {
    if (window.confirm(t('expenseCat.confirmDelete', { label: c.labelFr })) === false) return;
    try { await api.deleteExpenseCategory(c.id); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ledger-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div><h2>{t('expenseCat.title')}</h2><p>{t('expenseCat.hint')}</p></div>
          <div className="chips">
            <button className="btn mint" onClick={() => setEditing({ labelFr: '', labelEn: '', labelAr: '', active: true, sortOrder: 100 })}>{t('expenseCat.new')}</button>
            <button className="btn ghost" onClick={onClose}>{t('track.close')}</button>
          </div>
        </header>
        {error && <p className="banner err">{error}</p>}

        {editing && (
          <form className="ledger-pay" onSubmit={save}>
            <label className="field inline grow"><span>{t('expenseCat.labelFr')}</span><input value={editing.labelFr ?? ''} onChange={(e) => setEditing({ ...editing, labelFr: e.target.value })} required /></label>
            <label className="field inline grow"><span>{t('expenseCat.labelEn')}</span><input value={editing.labelEn ?? ''} onChange={(e) => setEditing({ ...editing, labelEn: e.target.value })} /></label>
            <label className="field inline grow"><span>{t('expenseCat.labelAr')}</span><input dir="rtl" value={editing.labelAr ?? ''} onChange={(e) => setEditing({ ...editing, labelAr: e.target.value })} /></label>
            <label className="field inline"><span>{t('expenseCat.order')}</span><input type="number" min="0" value={editing.sortOrder ?? 100} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} /></label>
            <button className="btn primary" disabled={busy}>{t('common.save')}</button>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
          </form>
        )}

        <table className="table small">
          <thead><tr><th>{t('expenseCat.labelFr')}</th><th>{t('expenseCat.labelEn')}</th><th>{t('expenseCat.labelAr')}</th><th>{t('common.status')}</th><th /></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className={c.active ? '' : 'is-off'}>
                <td><strong>{c.labelFr}</strong>{c.system && <span className="badge idle" style={{ marginInlineStart: 6 }}>{t('expenseCat.system')}</span>}</td>
                <td className="cell-muted">{c.labelEn ?? '—'}</td>
                <td className="cell-muted" dir="rtl">{c.labelAr ?? '—'}</td>
                <td><span className={`badge ${c.active ? 'ok' : 'idle'}`}>{c.active ? t('common.active') : t('common.inactive')}</span></td>
                <td className="cell-actions">
                  {!c.system && <>
                    <button className="btn ghost small" onClick={() => setEditing({ ...c })}>{t('common.edit')}</button>
                    <button className="btn ghost small" onClick={() => void toggle(c)}>{c.active ? t('expenseCat.disable') : t('expenseCat.enable')}</button>
                    <button className="btn ghost small danger" onClick={() => void remove(c)}>{t('common.delete')}</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
