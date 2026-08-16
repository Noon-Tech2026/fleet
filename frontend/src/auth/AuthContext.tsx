import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import type { AuthUser, Role } from '../lib/types';
import { hasAtLeast } from '../lib/types';
import { api, setSessionLostHandler } from '../api/client';

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Vrai si l'utilisateur a au moins ce role. */
  can: (required: Role) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Au chargement, on demande au serveur qui nous sommes. Le cookie
  // httpOnly n'etant pas lisible en JavaScript, c'est le seul moyen
  // de savoir si une session est encore ouverte.
  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => setUser(null));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setUser(await api.login(email, password));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const can = useCallback(
    (required: Role) => (user ? hasAtLeast(user.role, required) : false),
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit etre utilise dans un AuthProvider');
  return ctx;
}
