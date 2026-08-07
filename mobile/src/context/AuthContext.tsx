import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authApi } from '../api/endpoints';
import {
  clearSession,
  loadUser,
  saveUser,
  setToken,
  setUnauthorizedHandler,
} from '../api/client';
import type { Role, User } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  isTeacher: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string, role: Role) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    await clearSession();
    setUser(null);
  }, []);

  // Restore a stored session on cold start, then revalidate against the API.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await loadUser<User>();
      if (!cancelled && cached) setUser(cached);

      try {
        const { user: fresh } = await authApi.me();
        if (!cancelled) {
          setUser(fresh);
          await saveUser(fresh);
        }
      } catch {
        // No/expired token, or the API is unreachable. If we had no cached
        // user we stay logged out; a cached user keeps offline access to
        // the shell until they next hit a protected endpoint.
        if (!cancelled && !cached) await clearSession();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 from the API drops the session.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void logout();
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const persist = useCallback(async (token: string, nextUser: User) => {
    await setToken(token);
    await saveUser(nextUser);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authApi.login(email.trim().toLowerCase(), password);
      await persist(res.token, res.user);
      return res.user;
    },
    [persist]
  );

  const register = useCallback(
    async (name: string, email: string, password: string, role: Role) => {
      const res = await authApi.register(name.trim(), email.trim().toLowerCase(), password, role);
      await persist(res.token, res.user);
      return res.user;
    },
    [persist]
  );

  const refresh = useCallback(async () => {
    try {
      const { user: fresh } = await authApi.me();
      setUser(fresh);
      await saveUser(fresh);
    } catch {
      /* ignore transient refresh failures */
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      isTeacher: user?.role === 'teacher' || user?.role === 'admin',
      isAdmin: user?.role === 'admin',
      login,
      register,
      logout,
      refresh,
    }),
    [user, loading, login, register, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
