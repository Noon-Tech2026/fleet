import { useState, useEffect } from 'react';
import { useBranding } from '../lib/branding';
import { useAuth } from './AuthContext';

type Lang = 'fr' | 'en' | 'ar';
const RTL_LANGS: Lang[] = ['ar'];

interface Translations {
  login: { title: string; subtitle: string; email: string; password: string; submit: string; submitting: string; error: string; };
}

export function LoginPage() {
  const brand = useBranding();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<Lang>('fr');
  const [t, setT] = useState<Translations | null>(null);

  useEffect(() => {
    fetch(`/locales/${lang}.json`).then((r) => r.json()).then(setT).catch(() => setT(null));
  }, [lang]);

  const dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t?.login.error ?? 'Erreur');
      setBusy(false);
    }
  }

  const tx = t?.login;

  return (
    <div className="login-split" dir={dir}>
      <div className="login-visual" aria-hidden="true">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="login-visual-caption">
          <div className="lv-logo"><span className="lv-dot" />{brand.name}</div>
          <p>Suivi et pilotage de flotte en temps réel.</p>
        </div>
        <div className="lv-truck-lane">
          <img src="/LOCONAV_TRUCK.svg" className="login-truck" alt="" />
        </div>
      </div>

      <div className="login-form-panel">
        <div className="lang-switch">
          {(['ar', 'fr', 'en'] as Lang[]).map((l) => (
            <button key={l} type="button" className={l === lang ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang(l)}>
              {l === 'ar' ? 'ع' : l.toUpperCase()}
            </button>
          ))}
        </div>

        <form className="login-card" onSubmit={submit}>
          <img src={brand.logo} className="mark" alt="" aria-hidden="true" />
          <h1>{brand.name}</h1>
          <p className="login-sub">{tx?.subtitle ?? ''}</p>

          <label className="field">
            <span>{tx?.email ?? 'Email'}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
          </label>

          <label className="field">
            <span>{tx?.password ?? 'Password'}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>

          {error && <p className="error">{error}</p>}

          <button className="btn primary full" type="submit" disabled={busy}>
            {busy ? (tx?.submitting ?? '…') : (tx?.submit ?? 'Se connecter')}
          </button>
        </form>
      </div>
    </div>
  );
}
