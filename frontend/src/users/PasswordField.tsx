import { useState } from 'react';
import { PASSWORD_MIN_LENGTH, generatePassword } from '../lib/roles';

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
}

/**
 * Champ partagé par la création de compte et la réinitialisation.
 * Le mot de passe reste visible : l'administrateur doit pouvoir le
 * relire pour le transmettre, un champ masqué l'oblige à le retaper
 * ailleurs — c'est ainsi qu'ils finissent dans un fichier texte.
 */
export function PasswordField({ value, onChange, label }: Props) {
  const [copied, setCopied] = useState(false);
  const short = value.length > 0 && value.length < PASSWORD_MIN_LENGTH;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé (page non sécurisée) : la valeur reste
      // lisible à l'écran, l'action n'est qu'un raccourci.
    }
  }

  return (
    <div className="field">
      <span>{label}</span>
      <div className="field-row">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={`${PASSWORD_MIN_LENGTH} caractères minimum`}
        />
        <button type="button" className="btn small" onClick={() => onChange(generatePassword())}>
          Générer
        </button>
        <button type="button" className="btn small" onClick={() => void copy()} disabled={!value}>
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      {short && (
        <p className="field-error">
          {PASSWORD_MIN_LENGTH} caractères minimum — le système peut immobiliser un camion.
        </p>
      )}
    </div>
  );
}
