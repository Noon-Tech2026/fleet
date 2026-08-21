import { useEffect, useState } from 'react';
import type { MaintenanceLogEntry } from '../lib/types';
import { api } from '../api/client';

/**
 * Journal des interventions.
 *
 * Il ne se modifie pas depuis l'interface : c'est lui qui répond à
 * « quand cette cartouche a-t-elle été changée, par qui, à quel
 * kilométrage », et une ligne rectifiable ne prouve plus rien.
 */
export function MaintenanceLogs() {
  const [logs, setLogs] = useState<MaintenanceLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .maintenanceLogs()
      .then((rows) => {
        if (!cancelled) setLogs(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Chargement impossible');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="banner err">{error}</p>;
  if (!logs) return <p className="empty">Chargement du journal…</p>;
  if (logs.length === 0) {
    return (
      <p className="empty">
        Aucune intervention enregistrée. Le journal se remplit dès le premier entretien consigné.
      </p>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Camion</th>
            <th>Opération</th>
            <th>Compteur</th>
            <th>Pièce</th>
            <th>Coût</th>
            <th>Enregistré par</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((entry) => (
            <tr key={entry.id}>
              <td className="cell-muted">{new Date(entry.at).toLocaleDateString('fr-FR')}</td>
              <td>
                <strong>{entry.vehicleId}</strong>
              </td>
              <td>
                {entry.label}
                {entry.notes && <div className="cell-sub">{entry.notes}</div>}
              </td>
              <td className="cell-muted">
                {entry.odometer !== null ? `${entry.odometer.toLocaleString('fr-FR')} km` : '—'}
                {entry.engineHours !== null && (
                  <div className="cell-sub">{entry.engineHours.toLocaleString('fr-FR')} h</div>
                )}
              </td>
              <td className="cell-muted">{entry.partReference ?? '—'}</td>
              <td className="cell-muted">
                {entry.cost !== null ? `${entry.cost.toLocaleString('fr-FR')} DH` : '—'}
              </td>
              <td className="cell-muted">{entry.performedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
