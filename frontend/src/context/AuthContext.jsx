import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('screensync_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('screensync_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function verify() {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await authApi.me();
        setUser(res.data.data.user);
        localStorage.setItem('screensync_user', JSON.stringify(res.data.data.user));
      } catch (err) {
        setUser(null);
        setToken(null);
        localStorage.removeItem('screensync_token');
        localStorage.removeItem('screensync_user');
      } finally {
        setLoading(false);
      }
    }
    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await authApi.login(email, password);
    const { user: loggedInUser, token: newToken } = res.data.data;
    setUser(loggedInUser);
    setToken(newToken);
    localStorage.setItem('screensync_token', newToken);
    localStorage.setItem('screensync_user', JSON.stringify(loggedInUser));
    return loggedInUser;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('screensync_token');
    localStorage.removeItem('screensync_user');
  }, []);

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
