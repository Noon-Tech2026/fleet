import { useEffect, useRef } from 'react';

const EVT = 'mirsad:data-changed';

/** Emis par api/client.ts apres chaque ecriture reussie. */
export function notifyDataChanged(path: string): void {
  window.dispatchEvent(new CustomEvent(EVT, { detail: path }));
}

/**
 * Recharge l'ecran quand une donnee change ailleurs dans l'application
 * (dialogue, autre panneau) et au retour sur l'onglet. Appels regroupes (300 ms).
 */
export function useDataChanged(reload: () => unknown): void {
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void ref.current(), 300);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') trigger(); };
    window.addEventListener(EVT, trigger);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(EVT, trigger);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearTimeout(timer);
    };
  }, []);
}
