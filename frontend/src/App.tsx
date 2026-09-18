import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
            <p>{t('app.tagline')}</p>
          </div>
        </div>

        <nav className="nav">
          <button className={`nav-tab ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>
            {t('nav.overview')}
          </button>
          <button className={`nav-tab ${view === 'fleet' ? 'active' : ''}`} onClick={() => setView('fleet')}>
            {t('nav.supervision')}
          </button>
          <button className={`nav-tab ${view === 'maintenance' ? 'active' : ''}`} onClick={() => setView('maintenance')}>
            {t('nav.maintenance')}
          </button>
          <button className={`nav-tab ${view === 'accounting' ? 'active' : ''}`} onClick={() => setView('accounting')}>
            {t('nav.accounting')}
          </button>
          {isAdmin && (
            <button className={`nav-tab ${view === 'users' ? 'active' : ''}`} onClick={() => setView('users')}>
              {t('nav.users')}
            </button>
          )}
          {canManageDirectory && (
            <>
              <button className="nav-tab" onClick={() => setCreatingDriver(true)}>
                {t('nav.addDriver')}
              </button>
              <button className="nav-tab" onClick={() => setCreatingClient(true)}>
                {t('nav.addClient')}
              </button>
            </>
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
              {t('app.fleet')} <span className="count">{vehicles.length}</span>
            </h2>
            <VehicleList vehicles={vehicles} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
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
              {feedOpen && <AlertFeed alerts={alerts} />}
            </div>
          </section>

          <aside className="col right">
            {selected ? (
              <VehicleDetail vehicle={selected} simulatorMode={SIMULATOR_MODE} />
            ) : (
              <p className="empty">{t('app.selectVehicle')}</p>
            )}
          </aside>
        </main>
      )}

      {creatingDriver && (
        <CreateDriverDialog
          onCancel={() => setCreatingDriver(false)}
          onCreated={(driver) => {
            setCreatingDriver(false);
            setNotice(t('app.driverAdded', { name: driver.fullName }));
          }}
        />
      )}

      {creatingClient && (
        <CreateClientDialog
          onCancel={() => setCreatingClient(false)}
          onCreated={(client) => {
            setCreatingClient(false);
            setNotice(t('app.clientAdded', { name: client.name }));
          }}
        />
      )}
    </div>
  );
}
