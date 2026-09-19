import { useState } from 'react';
import type { VehicleState } from '../lib/types';
import { statusOf } from '../lib/status';
import { useTranslation } from 'react-i18next';
import { FuelGauge } from './FuelGauge';
import { MaintenancePanel } from './MaintenancePanel';
import { StarterDialog } from './StarterDialog';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface Props {
  vehicle: VehicleState;
  simulatorMode: boolean;
}

export function VehicleDetail({ vehicle, simulatorMode }: Props) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const status = statusOf(vehicle);

  // Masquer un bouton n'est pas une protection — le serveur refuse de
  // toute façon. C'est du confort : ne pas proposer une action qui
  // renverra 403.
  const canOperate = can('operator');
  const canControlStarter = can('supervisor');

  const [sending, setSending] = useState(false);
  const locked = sending || vehicle.commandLock !== null;

  function explain(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes('409') || msg.toLowerCase().includes('deja en cours')
      ? "Une commande est déjà en cours pour ce camion (autre utilisateur). Attendez la confirmation du boîtier."
      : `Échec de la commande : ${msg}`;
  }

  async function block(reason: string) {
    setSending(true);
    try {
      const audit = await api.blockStarter(vehicle.id, reason);
      setDialogOpen(false);
      setNotice(
        audit.applied
          ? 'Commande envoyée au boîtier — en attente de confirmation.'
          : "Blocage en file d'attente. Il s'appliquera automatiquement dès que le camion sera immobile (≤ 9 km/h pendant 10 s).",
      );
    } catch (e) {
      setNotice(explain(e));
    } finally {
      setSending(false);
    }
  }

  async function release() {
    setSending(true);
    try {
      await api.releaseStarter(vehicle.id, 'Réautorisation manuelle');
      setNotice('Commande envoyée au boîtier — en attente de confirmation.');
    } catch (e) {
      setNotice(explain(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="detail">
      <header className="detail-head">
        <div>
          <h2>{vehicle.id}</h2>
          <p>
            {vehicle.plate} · {vehicle.driver || 'Non affecté'}
          </p>
        </div>
        <span className={`badge ${status.tone}`}>{t(`status.${status.key}`)}</span>
      </header>

      <dl className="stats">
        <div>
          <dt>Vitesse</dt>
          <dd>{vehicle.speed} km/h</dd>
        </div>
        <div>
          <dt>Moteur</dt>
          <dd>{vehicle.ignition ? 'En marche' : 'Coupé'}</dd>
        </div>
        <div>
          <dt>Odomètre</dt>
          <dd>{vehicle.odometer.toLocaleString('fr-FR')} km</dd>
        </div>
        <div>
          <dt>Heures moteur</dt>
          <dd>{vehicle.engineHours.toLocaleString('fr-FR')} h</dd>
        </div>
      </dl>

      <h3>Carburant</h3>
      <div className="fuel-row">
        <FuelGauge liters={vehicle.fuelMain} capacity={700} label="Principal" />
        <FuelGauge liters={vehicle.fuelAux} capacity={300} label="Auxiliaire" />
      </div>

      <h3>Entretien</h3>
      <MaintenancePanel vehicleId={vehicle.id} />

      <h3>Confirmation de départ</h3>
      <div className={`panel ${vehicle.departureConfirmed ? 'ok' : 'warn'}`}>
        <strong>{vehicle.departureConfirmed ? 'Départ confirmé' : 'Aucune confirmation'}</strong>
        <span>Bouton chauffeur · entrée DIN2</span>
        {simulatorMode && canOperate && !vehicle.departureConfirmed && (
          <button className="btn ghost full" onClick={() => void api.pressButton(vehicle.id)}>
            Simuler l'appui du bouton
          </button>
        )}
      </div>

      <h3>Contrôle du démarreur</h3>
      <div
        className={`panel ${vehicle.starter === 'allowed' ? 'ok' : vehicle.starter === 'pending_block' ? 'warn' : 'danger'}`}
      >
        <strong>
          {vehicle.starter === 'allowed'
            ? 'Démarrage autorisé'
            : vehicle.starter === 'pending_block'
              ? "Blocage en attente d'arrêt"
              : 'Démarrage bloqué'}
        </strong>
        <span>Sortie DOUT1 · relais 24 V sur circuit démarreur</span>
        {vehicle.commandLock && (
          <p className="hint">Commande en cours par {vehicle.commandLock.by} — en attente de confirmation du boîtier…</p>
        )}

        {!canControlStarter ? (
          <p className="hint">Le contrôle du démarreur est réservé aux superviseurs.</p>
        ) : vehicle.starter === 'allowed' ? (
          <button className="btn danger full" disabled={locked} onClick={() => setDialogOpen(true)}>
            Bloquer le démarrage
          </button>
        ) : (
          <button className="btn mint full" disabled={locked} onClick={() => void release()}>
            Réautoriser le démarrage
          </button>
        )}
      </div>

      {notice && <p className="notice">{notice}</p>}

      <dl className="tech">
        <div>
          <dt>IMEI</dt>
          <dd>{vehicle.imei}</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>
            {vehicle.lat.toFixed(5)}, {vehicle.lon.toFixed(5)}
          </dd>
        </div>
        <div>
          <dt>Batterie</dt>
          <dd>{vehicle.battery} V</dd>
        </div>
        <div>
          <dt>Dernière trame</dt>
          <dd>{new Date(vehicle.updatedAt).toLocaleTimeString('fr-FR')}</dd>
        </div>
      </dl>

      {dialogOpen && (
        <StarterDialog vehicle={vehicle} onCancel={() => setDialogOpen(false)} onConfirm={block} />
      )}
    </div>
  );
}
