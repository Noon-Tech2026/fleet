import { useMemo, useState } from 'react';
import type { Role } from './lib/types';
import { useFleetStream } from './api/useFleetStream';
import { useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { FleetMap } from './components/FleetMap';
import { VehicleList } from './components/VehicleList';
import { VehicleDetail } from './components/VehicleDetail';
import { AlertFeed } from './components/AlertFeed';
import { UsersPage } from './users/UsersPage';
import { ROLE_LABEL } from './lib/roles';

const SIMULATOR_MODE = import.meta.env.DEV;

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
  role: Role;
}) {
  // Le flux SSE est ouvert par le tableau de bord et non par la vue carte :
  // changer d'onglet ne doit pas rouvrir une connexion vers l'API.
  const { vehicles, alerts, connection } = useFleetStream();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState(true);
  const [view, setView] = useState<'fleet' | 'users'>('fleet');
  const { can } = useAuth();
  const isAdmin = can('admin');

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

        {/* Un seul onglet ne serait que du bruit : la navigation
            n'apparaît que si elle mène quelque part. */}
        {isAdmin && (
          <nav className="nav">
            <button
              className={`nav-tab ${view === 'fleet' ? 'active' : ''}`}
              onClick={() => setView('fleet')}
            >
              Supervision
            </button>
            <button
              className={`nav-tab ${view === 'users' ? 'active' : ''}`}
              onClick={() => setView('users')}
            >
              Utilisateurs
            </button>
          </nav>
        )}

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

      {view === 'users' && isAdmin ? (
        <UsersPage />
      ) : (
        <main className="layout">
          <aside className="col left">
            <h2 className="col-title">
              Flotte <span className="count">{vehicles.length}</span>
            </h2>
            <VehicleList
              vehicles={vehicles}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
            />
          </aside>

          <section className="col center">
            <FleetMap vehicles={vehicles} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
            {/* Le bandeau se replie pour rendre toute la hauteur à la carte :
                en suivi de flotte, la carte est l'écran de travail. */}
            <div className={`feed ${feedOpen ? '' : 'collapsed'}`}>
              <div className="feed-head">
                <h2 className="col-title">
                  Événements {alerts.length > 0 && <span className="count">{alerts.length}</span>}
                </h2>
                <button
                  className="btn ghost small"
                  onClick={() => setFeedOpen((open) => !open)}
                  aria-expanded={feedOpen}
                >
                  {feedOpen ? 'Masquer' : 'Afficher'}
                </button>
              </div>
              {feedOpen && <AlertFeed alerts={alerts} />}
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
      )}
    </div>
  );
}
