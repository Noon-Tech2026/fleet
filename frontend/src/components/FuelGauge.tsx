interface Props {
  liters: number;
  capacity: number;
  label: string;
}

/**
 * Les deux réservoirs sont affichés séparément et jamais additionnés :
 * c'est la lecture séparée qui rend un siphonnage visible.
 */
export function FuelGauge({ liters, capacity, label }: Props) {
  const ratio = Math.max(0, Math.min(1, liters / capacity));
  const tone = ratio < 0.15 ? 'var(--red)' : ratio < 0.3 ? 'var(--amber)' : 'var(--mint)';

  return (
    <div className="fuel">
      <div
        className="fuel-tank"
        role="img"
        aria-label={`${label} : ${Math.round(liters)} litres sur ${capacity}`}
      >
        <div className="fuel-level" style={{ height: `${ratio * 100}%`, background: tone, color: tone }} />
      </div>
      <div className="fuel-value" style={{ color: tone }}>
        {Math.round(liters)} <span>L</span>
      </div>
      <div className="fuel-label">{label}</div>
      <div className="fuel-cap">capacité {capacity} L</div>
    </div>
  );
}
