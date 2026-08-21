import { useState } from 'react';
import type { VehicleState } from '../lib/types';
import { statusOf } from '../lib/status';
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
  const { can } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const status = statusOf(vehicle);

  // Masquer un bouton n'est pas une protection — le serveur refuse de
  // toute façon. C'est du confort : ne pas proposer une action qui
  // renverra 403.
  const canOperate = can('operator');
  const canControlStarter = can('supervisor');

  async function block(reason: string) {
    const audit = await api.blockStarter(vehicle.id, reason);
    setDialogOpen(false);
    setNotice(
      audit.applied
        ? 'Démarreur bloqué. Le boîtier a accusé réception.'
        : "Blocage en file d'attente. Il s'appliquera automatiquement dès l'arrêt du camion, contact coupé.",
    );
  }

  async function release() {
    await api.releaseStarter(vehicle.id, 'Réautorisation manuelle');
    setNotice('Démarrage réautorisé.');
  }

  return (
    <div className="detail">
      <header className="detail-head">
        <div>
          <h2>{vehicle.id}</h2>
          <p>
            {vehicle.plate} · {vehicle.driver}
          </p>
        </div>
        <span className={`badge ${status.tone}`}>{status.label}</span>
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

        {!canControlStarter ? (
          <p className="hint">Le contrôle du démarreur est réservé aux superviseurs.</p>
        ) : vehicle.starter === 'allowed' ? (
          <button className="btn danger full" onClick={() => setDialogOpen(true)}>
            Bloquer le démarrage
          </button>
        ) : (
          <button className="btn mint full" onClick={() => void release()}>
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
