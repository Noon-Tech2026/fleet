import { useEffect, useState } from 'react';
import type { VehicleState } from '../lib/types';

interface Props {
  vehicle: VehicleState;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

/**
 * L'interface annonce ce qui va se passer, mais ne décide pas :
 * c'est le serveur qui tranche entre exécution immédiate et mise en
 * attente. Ce dialogue ne fait que rendre la décision prévisible.
 */
export function StarterDialog({ vehicle, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopped = vehicle.speed <= 3 && !vehicle.ignition;

  // Échap ferme la fenêtre : sur une action de cette gravité, l'abandon
  // doit être plus facile que la confirmation.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  async function submit() {
    if (reason.trim().length < 3) {
      setError('Indiquez un motif — il sera conservé dans le journal.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commande refusée');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="starter-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="starter-dialog-title">Blocage du démarreur — {vehicle.id}</h2>

        <div className="warning">
          <strong>Cette commande ne coupe jamais un moteur en marche.</strong>
          Elle agit uniquement sur le démarreur et empêche le redémarrage après un
          arrêt naturel du véhicule. Couper un moteur en roulage supprimerait la
          direction assistée et l'assistance de freinage.
        </div>

        <dl className="conditions">
          <div>
            <dt>Vitesse</dt>
            <dd>{vehicle.speed} km/h</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>{vehicle.ignition ? 'Mis' : 'Coupé'}</dd>
          </div>
        </dl>

        <p className="modal-note">
          {stopped
            ? 'Conditions réunies. Le blocage sera appliqué immédiatement.'
            : "Conditions non réunies. La commande sera mise en file d'attente et exécutée dès l'arrêt complet, contact coupé."}
        </p>

        <label className="field">
          <span>Motif</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. sortie sans confirmation, véhicule signalé volé"
            autoFocus
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button className="btn danger" onClick={submit} disabled={busy}>
            {busy ? 'Envoi…' : stopped ? 'Bloquer maintenant' : 'Programmer le blocage'}
          </button>
        </div>
      </div>
    </div>
  );
}
