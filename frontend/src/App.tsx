import {useEffect, useMemo, useState} from 'react';
import { useBranding } from './lib/branding';
import { useTranslation } from 'react-i18next';
import type { Role } from './lib/types';
import { useFleetStream } from './api/useFleetStream';
import type { VehicleDirectoryEntry } from './api/client';
import { api } from './api/client';
import { useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { FleetMap } from './components/FleetMap';
import { FleetOverview } from './components/FleetOverview';
import { VehicleList } from './components/VehicleList';
import { VehicleDetail } from './components/VehicleDetail';
import { TrackHistoryDialog } from './components/TrackHistoryDialog';
import { ExitRequestsPanel } from './components/ExitRequestsPanel';
import { AlertFeed } from './components/AlertFeed';
import { UsersPage } from './users/UsersPage';
import { MaintenancePage } from './maintenance/MaintenancePage';
import { AccountingPage } from './accounting/AccountingPage';
import { ZonesPage } from './zones/ZonesPage';
import { DriversPage } from './accounting/DriversPage';
import { ClientsPage } from './accounting/ClientsPage';
import { CashPage } from './accounting/CashPage';
import { VersementsPage } from './accounting/VersementsPage';

const SIMULATOR_MODE = import.meta.env.DEV;

type Lang = 'fr' | 'en' | 'ar';

function LangSwitch() {
  const { i18n } = useTranslation();
  const current = (i18n.language || 'fr').slice(0, 2) as Lang;
  return (
    <div className="lang-switch nav-lang">
      {(['ar', 'fr', 'en'] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          className={l === current ? 'lang-btn active' : 'lang-btn'}
          onClick={() => i18n.changeLanguage(l)}
        >
          {l === 'ar' ? 'ع' : l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const { t } = useTranslation();
  const { user, loading, logout } = useAuth();

  if (loading) return <div className="boot">{t('app.checkingSession')}</div>;
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
  const { t } = useTranslation();
  const { vehicles, alerts, exitRequests } = useFleetStream();
  const brand = useBranding();
  const [exitOpenSignal, setExitOpenSignal] = useState(0);

  // Répertoire des camions : ceux dont le boîtier n'a encore rien transmis
  // apparaissent dans la liste (sans marqueur) jusqu'à leur première trame.
  const [directory, setDirectory] = useState<VehicleDirectoryEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => api.fleetVehicles().then((d) => { if (cancelled === false) setDirectory(d); }).catch(() => undefined);
    void load();
    const timer = setInterval(load, 60_000);
    // Ecriture ailleurs (camion cree / modifie) : repertoire recharge tout de suite.
    const onChanged = () => void load();
    window.addEventListener('mirsad:data-changed', onChanged);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('mirsad:data-changed', onChanged); };
  }, []);
  const pendingVehicles = directory.filter(
    (d) => d.active !== false && vehicles.some((v) => v.id === d.id) === false,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trackVehicleId, setTrackVehicleId] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState(true);
  const { can } = useAuth();
  const isAdmin = can('admin');
  // Hors administrateurs : seule la Supervision est accessible.
  const canManageZones = isAdmin;
  const [view, setView] = useState<
    'overview' | 'fleet' | 'maintenance' | 'accounting' | 'drivers' | 'clients' | 'cash' | 'versements' | 'users' | 'zones'
  >(isAdmin ? 'overview' : 'fleet');
  const shownView = isAdmin ? view : 'fleet';

  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? vehicles[0] ?? null,
    [vehicles, selectedId],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={brand.logo} className="mark" alt="" aria-hidden="true" />
          <div>
            <h1>{brand.name}</h1>
            <p>{brand.tagline}</p>
          </div>
        </div>

        <nav className="nav">
          {isAdmin && <button className={`nav-tab ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>
            {t('nav.overview')}
          </button>}
          <button className={`nav-tab ${shownView === 'fleet' ? 'active' : ''}`} onClick={() => setView('fleet')}>
            {t('nav.supervision')}
            {exitRequests.length > 0 && <span className="nav-badge">{exitRequests.length}</span>}
          </button>
          {isAdmin && <button className={`nav-tab ${view === 'maintenance' ? 'active' : ''}`} onClick={() => setView('maintenance')}>
            {t('nav.maintenance')}
          </button>}
          {isAdmin && <button className={`nav-tab ${view === 'accounting' ? 'active' : ''}`} onClick={() => setView('accounting')}>
            {t('nav.accounting')}
          </button>}
          {isAdmin && <button className={`nav-tab ${view === 'drivers' ? 'active' : ''}`} onClick={() => setView('drivers')}>
            {t('nav.drivers')}
          </button>}
          {isAdmin && <button className={`nav-tab ${view === 'clients' ? 'active' : ''}`} onClick={() => setView('clients')}>
            {t('nav.clients')}
          </button>}
          {isAdmin && <button className={`nav-tab ${view === 'cash' ? 'active' : ''}`} onClick={() => setView('cash')}>
            {t('nav.cash')}
          </button>}
          {isAdmin && <button className={`nav-tab ${view === 'versements' ? 'active' : ''}`} onClick={() => setView('versements')}>
            {t('nav.versements')}
          </button>}
          {canManageZones && (
            <button className={`nav-tab ${view === 'zones' ? 'active' : ''}`} onClick={() => setView('zones')}>
              {t('nav.zones')}
            </button>
          )}
          {isAdmin && (
            <button className={`nav-tab ${view === 'users' ? 'active' : ''}`} onClick={() => setView('users')}>
              {t('nav.users')}
            </button>
          )}
        </nav>

        <div className="session">
          <LangSwitch />
          <div className="who">
            <strong>{userName}</strong>
            <span>{t(`roles.${role}`)}</span>
          </div>
          <button className="btn ghost small" onClick={() => void onLogout()}>
            {t('nav.logout')}
          </button>
        </div>
      </header>

      {shownView === 'users' && isAdmin ? (
        <UsersPage />
      ) : shownView === 'maintenance' ? (
        <MaintenancePage vehicles={vehicles} />
      ) : shownView === 'accounting' ? (
        <AccountingPage />
      ) : shownView === 'zones' ? (
        <ZonesPage vehicles={vehicles} directory={directory} isAdmin={isAdmin} />
      ) : shownView === 'drivers' ? (
        <DriversPage />
      ) : shownView === 'versements' ? (
        <VersementsPage />
      ) : shownView === 'cash' ? (
        <CashPage />
      ) : shownView === 'clients' ? (
        <ClientsPage />
      ) : shownView === 'overview' ? (
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
            <ExitRequestsPanel requests={exitRequests} openSignal={exitOpenSignal} vehicles={vehicles} directory={directory} />
            <h2 className="col-title">
              {t('app.fleet')} <span className="count">{vehicles.length + pendingVehicles.length}</span>
            </h2>
            <VehicleList vehicles={vehicles} pending={pendingVehicles} selectedId={selected?.id ?? null} onSelect={setSelectedId} onTrack={setTrackVehicleId} />
          </aside>

          <section className="col center">
            <FleetMap vehicles={vehicles} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
            <div className={`feed ${feedOpen ? '' : 'collapsed'}`}>
              <div className="feed-head">
                <h2 className="col-title">
                  {t('app.events')} {alerts.length > 0 && <span className="count">{alerts.length}</span>}
                </h2>
                <button className="btn ghost small" onClick={() => setFeedOpen((open) => !open)} aria-expanded={feedOpen}>
                  {feedOpen ? t('app.hide') : t('app.show')}
                </button>
              </div>
              {feedOpen && <AlertFeed alerts={alerts} vehicles={vehicles} directory={directory} />}
            </div>
          </section>

          <aside className="col right">
            {selected ? (
              <VehicleDetail
                vehicle={selected}
                simulatorMode={SIMULATOR_MODE}
                onTrack={() => setTrackVehicleId(selected.id)}
                requests={exitRequests.filter((r) => r.vehicleId === selected.id)}
                onShowRequests={() => setExitOpenSignal((n) => n + 1)}
                fuelAlerts={alerts.filter((a) => a.vehicleId === selected.id && a.code.startsWith('fuel_'))}
              />
            ) : (
              <p className="empty">{t('app.selectVehicle')}</p>
            )}
          </aside>
        </main>
      )}
      {trackVehicleId && (
        <TrackHistoryDialog
          vehicleId={trackVehicleId}
          plate={vehicles.find((v) => v.id === trackVehicleId)?.plate ?? directory.find((d) => d.id === trackVehicleId)?.plate ?? ''}
          onClose={() => setTrackVehicleId(null)}
        />
      )}
    </div>
  );
}
