import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientRecord, ContainerSize, DriverRecord, TripEntry } from '../lib/types';
import { api } from '../api/client';

interface ContainerRow {
  key: number;
  containerNumber: string;
  size: ContainerSize;
  loaded: boolean;
}

interface Props {
  vehicleId: string;
  clients: ClientRecord[];
  drivers: DriverRecord[];
  /** Présent = modification : seuls trajet, montant et notes sont modifiables (API). */
  initial?: TripEntry;
  onCancel: () => void;
  onDone: (trip: TripEntry) => void;
}

let rowKey = 0;
const newRow = (): ContainerRow => ({ key: rowKey++, containerNumber: '', size: '40', loaded: true });

/**
 * Consignation d'un voyage facturé. Le nombre de conteneurs n'est jamais
 * saisi directement : il découle du nombre de lignes de ce formulaire.
 */
export function TripDialog({ vehicleId, clients: allClients, drivers: allDrivers, initial, onCancel, onDone }: Props) {
  const { t } = useTranslation();
  const editing = Boolean(initial);

  // Désactiver un chauffeur ou un client garde ses voyages passés intacts
  // mais le retire des nouveaux : c'est l'alternative à sa suppression.
  const clients = allClients.filter((c) => c.active || c.id === initial?.clientId);
  const drivers = allDrivers.filter((d) => d.active || d.id === initial?.driverId);
  const [clientId, setClientId] = useState(initial?.clientId ?? clients[0]?.id ?? '');
  const [driverId, setDriverId] = useState(initial?.driverId ?? drivers[0]?.id ?? '');
  const [startedAt, setStartedAt] = useState(() => (initial ? initial.startedAt : new Date().toISOString()).slice(0, 10));
  const [origin, setOrigin] = useState(initial?.origin ?? '');
  const [destination, setDestination] = useState(initial?.destination ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [rows, setRows] = useState<ContainerRow[]>(() =>
    initial
      ? initial.containers.map((c) => ({ key: rowKey++, containerNumber: c.containerNumber ?? '', size: c.size, loaded: c.loaded }))
      : [newRow()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  function updateRow(key: number, patch: Partial<ContainerRow>) {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!clientId || !driverId) {
      setError(t('dialog.trip.selectRefs'));
      return;
    }

    setBusy(true);
    try {
      const trip = initial
        ? await api.updateTrip(initial.id, {
            clientId,
            driverId,
            startedAt: new Date(`${startedAt}T08:00:00`).toISOString(),
            origin: origin.trim() || undefined,
            destination: destination.trim() || undefined,
            amount: Number(amount),
            notes: notes.trim() || undefined,
            containers: rows.map((r) => ({
              containerNumber: r.containerNumber.trim() || undefined,
              size: r.size,
              loaded: r.loaded,
            })),
          })
        : await api.createTrip({
            vehicleId,
            clientId,
            driverId,
            startedAt: new Date(`${startedAt}T08:00:00`).toISOString(),
            origin: origin.trim() || undefined,
            destination: destination.trim() || undefined,
            amount: Number(amount),
            notes: notes.trim() || undefined,
            containers: rows.map((r) => ({
              containerNumber: r.containerNumber.trim() || undefined,
              size: r.size,
              loaded: r.loaded,
            })),
          });
      onDone(trip);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dialog.common.error'));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="trip-dialog-title">{t(editing ? 'dialog.trip.titleEdit' : 'dialog.trip.titleNew', { id: vehicleId })}</h2>

        <div className="field-grid">
          <label className="field">
            <span>{t('dialog.trip.client')}</span>
            <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
              {clients.length === 0 && <option value="">{t('dialog.trip.noClient')}</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>{t('dialog.trip.driver')}</span>
            <select className="select" value={driverId} onChange={(e) => setDriverId(e.target.value)} required>
              {drivers.length === 0 && <option value="">{t('dialog.trip.noDriver')}</option>}
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.fullName}</option>
              ))}
            </select>
          </label>
        </div>

        {(clients.length === 0 || drivers.length === 0) && (
          <p className="modal-note">{t('dialog.trip.needRefs')}</p>
        )}

        <div className="field-grid">
          <label className="field">
            <span>{t('dialog.trip.date')}</span>
            <input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} required />
          </label>

          <label className="field">
            <span>{t('dialog.trip.amount')}</span>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>{t('dialog.trip.origin')}</span>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder={t('dialog.trip.originPlaceholder')} />
          </label>

          <label className="field">
            <span>{t('dialog.trip.destination')}</span>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder={t('dialog.trip.destinationPlaceholder')} />
          </label>
        </div>

        <div className="repeatable">
          <div className="repeatable-head">
            <span>{t('dialog.trip.containers')}</span>
            <button type="button" className="btn ghost small" onClick={() => setRows((list) => [...list, newRow()])}>
              {t('dialog.trip.addContainer')}
            </button>
          </div>

          {rows.map((row) => (
            <div className="field-row" key={row.key}>
              <input
                placeholder={t('dialog.trip.containerNumber')}
                value={row.containerNumber}
                onChange={(e) => updateRow(row.key, { containerNumber: e.target.value })}
               
              />
              <select
                className="select"
                value={row.size}
                onChange={(e) => updateRow(row.key, { size: e.target.value as ContainerSize })}
               
              >
                <option value="20">{t('dialog.trip.ft20')}</option>
                <option value="40">{t('dialog.trip.ft40')}</option>
              </select>
              <label className="check">
                <input
                  type="checkbox"
                  checked={row.loaded}
                  onChange={(e) => updateRow(row.key, { loaded: e.target.checked })}
                 
                />
                {t('dialog.trip.loaded')}
              </label>
              {(
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={rows.length === 1}
                  onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}
                  title={rows.length === 1 ? t('dialog.trip.keepOne') : t('dialog.trip.remove')}
                >
                  {t('dialog.trip.remove')}
                </button>
              )}
            </div>
          ))}
        </div>

        <label className="field">
          <span>{t('dialog.trip.notes')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('dialog.trip.notesPlaceholder')} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {t('dialog.common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy || clients.length === 0 || drivers.length === 0}>
            {busy ? t('dialog.common.saving') : t('dialog.trip.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
