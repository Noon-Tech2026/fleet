import { useMemo, useState } from 'react';
import type { Role } from './lib/types';
import { useFleetStream } from './api/useFleetStream';
import { useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { FleetMap } from './components/FleetMap';
import { FleetOverview } from './components/FleetOverview';
import { VehicleList } from './components/VehicleList';
import { VehicleDetail } from './components/VehicleDetail';
import { AlertFeed } from './components/AlertFeed';
import { UsersPage } from './users/UsersPage';
import { MaintenancePage } from './maintenance/MaintenancePage';
import { AccountingPage } from './accounting/AccountingPage';
import { CreateDriverDialog } from './accounting/CreateDriverDialog';
import { CreateClientDialog } from './accounting/CreateClientDialog';
import { ROLE_LABEL } from './lib/roles';

const SIMULATOR_MODE = import.meta.env.DEV;

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
  const { vehicles, alerts } = useFleetStream();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState(true);
  const [view, setView] = useState<'overview' | 'fleet' | 'maintenance' | 'accounting' | 'users'>('overview');
  const [creatingDriver, setCreatingDriver] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { can } = useAuth();
  const isAdmin = can('admin');
  const canManageDirectory = can('supervisor');

  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? vehicles[0] ?? null,
    [vehicles, selectedId],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" className="mark" alt="" aria-hidden="true" />
          <div>
            <h1>GeoTruck</h1>
            <p>Your fleet under control</p>
          </div>
        </div>

        <nav className="nav">
          <button
            className={`nav-tab ${view === 'overview' ? 'active' : ''}`}
            onClick={() => setView('overview')}
          >
            Vue d'ensemble
          </button>
          <button
            className={`nav-tab ${view === 'fleet' ? 'active' : ''}`}
            onClick={() => setView('fleet')}
          >
            Supervision
          </button>
          <button
            className={`nav-tab ${view === 'maintenance' ? 'active' : ''}`}
            onClick={() => setView('maintenance')}
          >
            Entretien
          </button>
          <button
            className={`nav-tab ${view === 'accounting' ? 'active' : ''}`}
            onClick={() => setView('accounting')}
          >
            Comptabilité
          </button>
          {/* L'onglet n'apparaît que pour un administrateur — confort
              d'affichage : le serveur refuse de toute façon. */}
          {isAdmin && (
            <button
              className={`nav-tab ${view === 'users' ? 'active' : ''}`}
              onClick={() => setView('users')}
            >
              Utilisateurs
            </button>
          )}
          {canManageDirectory && (
            <>
              <button className="nav-tab" onClick={() => setCreatingDriver(true)}>
                Ajouter chauffeur
              </button>
              <button className="nav-tab" onClick={() => setCreatingClient(true)}>
                Ajouter client
              </button>
            </>
          )}
        </nav>

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

      {notice && <p className="banner ok app-notice">{notice}</p>}

      {view === 'users' && isAdmin ? (
        <UsersPage />
      ) : view === 'maintenance' ? (
        <MaintenancePage vehicles={vehicles} />
      ) : view === 'accounting' ? (
        <AccountingPage />
      ) : view === 'overview' ? (
        <FleetOverview
          vehicles={vehicles}
          onTrack={(id) => {
            setSelectedId(id);
            setView('fleet');
          }}
        />
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

      {creatingDriver && (
        <CreateDriverDialog
          onCancel={() => setCreatingDriver(false)}
          onCreated={(driver) => {
            setCreatingDriver(false);
            setNotice(`${driver.fullName} — chauffeur ajouté au référentiel.`);
          }}
        />
      )}

      {creatingClient && (
        <CreateClientDialog
          onCancel={() => setCreatingClient(false)}
          onCreated={(client) => {
            setCreatingClient(false);
            setNotice(`${client.name} — client ajouté au référentiel.`);
          }}
        />
      )}
    </div>
  );
}
