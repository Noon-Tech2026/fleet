import { useEffect, useRef, useState } from 'react';

type Props = {
  value: string;                                   // ISO AAAA-MM-JJ ou ''
  onChange: (e: { target: { value: string } }) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

function isoToText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function textToIso(txt: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(txt.trim());
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function mask(raw: string): string {
  const s = raw.replace(/\D/g, '').slice(0, 8);
  if (s.length <= 2) return s;
  if (s.length <= 4) return `${s.slice(0, 2)}/${s.slice(2)}`;
  return `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}`;
}

function placeholder(): string {
  const lang = (document.documentElement.lang || '').slice(0, 2);
  if (lang === 'ar') return 'يوم/شهر/سنة';
  if (lang === 'en') return 'dd/mm/yyyy';
  return 'jj/mm/aaaa';
}

export default function DateInput({ value, onChange, min, max, required, disabled, className }: Props) {
  const [text, setText] = useState(isoToText(value));
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(isoToText(value)); }, [value]);

  const emit = (iso: string) => onChange({ target: { value: iso } });

  const onType = (raw: string) => {
    const t = mask(raw);
    setText(t);
    if (t === '') { if (value) emit(''); return; }
    const iso = textToIso(t);
    if (iso && iso !== value) emit(iso);
  };

  const onBlur = () => {
    if (text !== '' && !textToIso(text)) setText(isoToText(value));
  };

  const openPicker = () => {
    const el = nativeRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    try {
      if (el.showPicker) el.showPicker(); else el.click();
    } catch {
      el.focus();
    }
  };

  return (
    <span className={`date-input${className ? ' ' + className : ''}`}>
      <input
        type="text"
        className="date-input-text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder()}
        pattern="\d{2}/\d{2}/\d{4}"
        value={text}
        onChange={(e) => onType(e.target.value)}
        onBlur={onBlur}
        required={required}
        disabled={disabled}
      />
      <input
        ref={nativeRef}
        type="date"
        className="date-input-native"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        min={min}
        max={max}
        onChange={(e) => emit(e.target.value)}
      />
      <button type="button" className="date-input-btn" onClick={openPicker} disabled={disabled} aria-label="Calendrier">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>
    </span>
  );
}
