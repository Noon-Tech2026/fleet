import { useState } from 'react';
import type { ClientRecord, DriverRecord } from '../lib/types';
import { api } from '../api/client';

interface Props {
  clients: ClientRecord[];
  drivers: DriverRecord[];
  canManage: boolean;
  onClientsChange: (clients: ClientRecord[]) => void;
  onDriversChange: (drivers: DriverRecord[]) => void;
}

/** Référentiels clients/chauffeurs — gestion réservée au superviseur côté serveur. */
export function DirectoryPanel({ clients, drivers, canManage, onClientsChange, onDriversChange }: Props) {
  const [clientName, setClientName] = useState('');
  const [clientContact, setClientContact] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addClient(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createClient({
        name: clientName.trim(),
        contact: clientContact.trim() || undefined,
      });
      onClientsChange([...clients, created]);
      setClientName('');
      setClientContact('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible');
    } finally {
      setBusy(false);
    }
  }

  async function addDriver(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createDriver({
        fullName: driverName.trim(),
        phone: driverPhone.trim() || undefined,
      });
      onDriversChange([...drivers, created]);
      setDriverName('');
      setDriverPhone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="accounting-detail">
      {error && <p className="banner err">{error}</p>}

      <section className="accounting-block">
        <header>
          <h4>Clients</h4>
        </header>

        {canManage && (
          <form className="field-row" onSubmit={(e) => void addClient(e)}>
            <input
              placeholder="Nom du client"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              required
            />
            <input
              placeholder="Contact (téléphone ou email)"
              value={clientContact}
              onChange={(e) => setClientContact(e.target.value)}
            />
            <button className="btn small" type="submit" disabled={busy}>
              Ajouter
            </button>
          </form>
        )}

        {clients.length === 0 ? (
          <p className="empty">Aucun client au référentiel.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className={c.active ? '' : 'is-off'}>
                    <td>{c.name}</td>
                    <td className="cell-muted">{c.contact ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="accounting-block">
        <header>
          <h4>Chauffeurs</h4>
        </header>

        {canManage && (
          <form className="field-row" onSubmit={(e) => void addDriver(e)}>
            <input
              placeholder="Nom du chauffeur"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              required
            />
            <input
              placeholder="Téléphone"
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
            />
            <button className="btn small" type="submit" disabled={busy}>
              Ajouter
            </button>
          </form>
        )}

        {drivers.length === 0 ? (
          <p className="empty">Aucun chauffeur au référentiel.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Téléphone</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id} className={d.active ? '' : 'is-off'}>
                    <td>{d.fullName}</td>
                    <td className="cell-muted">{d.phone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
