import { useEffect, useState } from 'react';
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
  onCancel: () => void;
  onDone: (trip: TripEntry) => void;
}

let rowKey = 0;
const newRow = (): ContainerRow => ({ key: rowKey++, containerNumber: '', size: '40', loaded: true });

/**
 * Consignation d'un voyage facturé. Le nombre de conteneurs n'est jamais
 * saisi directement : il découle du nombre de lignes de ce formulaire.
 */
export function TripDialog({ vehicleId, clients: allClients, drivers: allDrivers, onCancel, onDone }: Props) {
  // Désactiver un chauffeur ou un client garde ses voyages passés intacts
  // mais le retire des nouveaux : c'est l'alternative à sa suppression.
  const clients = allClients.filter((c) => c.active);
  const drivers = allDrivers.filter((d) => d.active);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? '');
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<ContainerRow[]>(() => [newRow()]);
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
      setError('Sélectionnez un client et un chauffeur.');
      return;
    }

    setBusy(true);
    try {
      const trip = await api.createTrip({
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
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
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
        <h2 id="trip-dialog-title">Nouveau voyage — {vehicleId}</h2>

        <div className="field-grid">
          <label className="field">
            <span>Client</span>
            <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
              {clients.length === 0 && <option value="">Aucun client actif</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Chauffeur</span>
            <select className="select" value={driverId} onChange={(e) => setDriverId(e.target.value)} required>
              {drivers.length === 0 && <option value="">Aucun chauffeur actif</option>}
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
          </label>
        </div>

        {(clients.length === 0 || drivers.length === 0) && (
          <p className="modal-note">
            Ajoutez ou réactivez d'abord un client et un chauffeur dans les onglets Chauffeurs et Clients.
          </p>
        )}

        <div className="field-grid">
          <label className="field">
            <span>Date du voyage</span>
            <input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} required />
          </label>

          <label className="field">
            <span>Montant facturé (MRU)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Origine</span>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="ex. Port de Nador" />
          </label>

          <label className="field">
            <span>Destination</span>
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="ex. Zone industrielle"
            />
          </label>
        </div>

        <div className="repeatable">
          <div className="repeatable-head">
            <span>Conteneurs transportés</span>
            <button type="button" className="btn ghost small" onClick={() => setRows((list) => [...list, newRow()])}>
              + Ajouter un conteneur
            </button>
          </div>

          {rows.map((row) => (
            <div className="field-row" key={row.key}>
              <input
                placeholder="Numéro (ex. MSCU1234567)"
                value={row.containerNumber}
                onChange={(e) => updateRow(row.key, { containerNumber: e.target.value })}
              />
              <select
                className="select"
                value={row.size}
                onChange={(e) => updateRow(row.key, { size: e.target.value as ContainerSize })}
              >
                <option value="20">20 pieds</option>
                <option value="40">40 pieds</option>
              </select>
              <label className="check">
                <input
                  type="checkbox"
                  checked={row.loaded}
                  onChange={(e) => updateRow(row.key, { loaded: e.target.checked })}
                />
                Plein
              </label>
              <button
                type="button"
                className="btn ghost small"
                disabled={rows.length === 1}
                onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}
                title={rows.length === 1 ? 'Un voyage doit garder au moins un conteneur' : 'Retirer'}
              >
                Retirer
              </button>
            </div>
          ))}
        </div>

        <label className="field">
          <span>Observations</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex. attente au port" />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={busy || clients.length === 0 || drivers.length === 0}>
            {busy ? 'Enregistrement…' : 'Enregistrer le voyage'}
          </button>
        </div>
      </form>
    </div>
  );
}
