import { useMemo, useState } from 'react';
import { useFleetStream } from './api/useFleetStream';
import { useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { FleetMap } from './components/FleetMap';
import { VehicleList } from './components/VehicleList';
import { VehicleDetail } from './components/VehicleDetail';
import { AlertFeed } from './components/AlertFeed';

const SIMULATOR_MODE = import.meta.env.DEV;

const ROLE_LABEL: Record<string, string> = {
  viewer: 'Consultation',
  operator: 'Exploitation',
  supervisor: 'Superviseur',
  admin: 'Administrateur',
};

const CONNECTION_LABEL: Record<string, string> = {
  live: 'Flux en direct',
  connecting: 'Connexion…',
  lost: 'Flux interrompu',
};

export default function App() {
  const { user, loading, logout } = useAuth();

  if (loading) return <div className="boot">Vérification de la session…</div>;
  if (!user) return <LoginPage />;

  return <Dashboard onLogout={logout} userName={user.fullName} role={user.role} />;
}

function Dashboard({
  onLogout,
  userName,
  role,
}: {
  onLogout: () => Promise<void>;
  userName: string;
  role: string;
}) {
  const { vehicles, alerts, connection } = useFleetStream();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? vehicles[0] ?? null,
    [vehicles, selectedId],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <h1>Gestion de flotte</h1>
            <p>SHACMAN F3000 · {vehicles.length} véhicules</p>
          </div>
        </div>

        <div className="pills">
          {SIMULATOR_MODE && (
            <span className="pill sim">
              <i className="dot" aria-hidden="true" />
              Données simulées
            </span>
          )}
          <span className={`pill ${connection}`}>
            <i className="dot" aria-hidden="true" />
            {CONNECTION_LABEL[connection] ?? connection}
          </span>
        </div>

        <div className="session">
          <div className="who">
            <strong>{userName}</strong>
            <span>{ROLE_LABEL[role] ?? role}</span>
          </div>
          <button className="btn ghost small" onClick={() => void onLogout()}>
            Se déconnecter
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="col left">
          <h2 className="col-title">
            Flotte <span className="count">{vehicles.length}</span>
          </h2>
          <VehicleList vehicles={vehicles} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        </aside>

        <section className="col center">
          <FleetMap vehicles={vehicles} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
          <div className="feed">
            <h2 className="col-title">
              Événements {alerts.length > 0 && <span className="count">{alerts.length}</span>}
            </h2>
            <AlertFeed alerts={alerts} />
          </div>
        </section>

        <aside className="col right">
          {selected ? (
            <VehicleDetail vehicle={selected} simulatorMode={SIMULATOR_MODE} />
          ) : (
            <p className="empty">Sélectionnez un camion pour voir sa fiche.</p>
          )}
        </aside>
      </main>
    </div>
  );
}
