import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { AuthContextData } from '../../shared/types';

interface AuthContextValue extends AuthContextData {
  loading: boolean;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthContextData>({
    user: null,
    subscription: null,
    plan: null,
    usage: null,
    savedStudiosCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('nf_theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('nf_theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const data = await apiRequest<AuthContextData>('/api/auth/me');
      setState(data);
    } catch {
      setState({ user: null, subscription: null, plan: null, usage: null, savedStudiosCount: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      setState({ user: null, subscription: null, plan: null, usage: null, savedStudiosCount: 0 });
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, loading, theme, toggleTheme, refreshAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
