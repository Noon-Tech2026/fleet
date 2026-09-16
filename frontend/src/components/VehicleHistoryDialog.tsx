import { useEffect, useState } from 'react';
import type { TripEntry } from '../lib/types';
import { formatMoney } from '../lib/accounting';
import { api } from '../api/client';

interface Props {
  vehicleId: string;
  plate: string;
  onClose: () => void;
}

/**
 * Historique des voyages d'un camion, en lecture seule — ouvert depuis la
 * vue d'ensemble sans quitter la page. La saisie (nouveau voyage, charge,
 * investissement) reste réservée à l'onglet Comptabilité.
 */
export function VehicleHistoryDialog({ vehicleId, plate, onClose }: Props) {
  const [trips, setTrips] = useState<TripEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .vehicleTrips(vehicleId)
      .then(setTrips)
      .catch((err) => setError(err instanceof Error ? err.message : 'Chargement impossible'));
  }, [vehicleId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop full" onClick={onClose}>
      <div
        className="modal full"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-full-head">
          <div>
            <h2 id="history-dialog-title">Historique des voyages — {vehicleId}</h2>
            <p>
              {plate}
              {trips && ` · ${trips.length} voyage${trips.length > 1 ? 's' : ''} enregistré${trips.length > 1 ? 's' : ''}`}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>

        <div className="modal-full-body">
          {error && <p className="banner err">{error}</p>}

          {!trips ? (
            <p className="empty">Chargement…</p>
          ) : trips.length === 0 ? (
            <p className="empty">Aucun voyage enregistré pour ce camion.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Chauffeur</th>
                    <th>Trajet</th>
                    <th>Conteneurs</th>
                    <th>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <tr key={trip.id}>
                      <td>{new Date(trip.startedAt).toLocaleDateString('fr-FR')}</td>
                      <td>{trip.clientName}</td>
                      <td>{trip.driverName}</td>
                      <td className="cell-muted">
                        {trip.origin ?? '—'} → {trip.destination ?? '—'}
                      </td>
                      <td>
                        <span className="badge idle">{trip.containers.length}</span>
                      </td>
                      <td>
                        <strong>{formatMoney(trip.amount)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
