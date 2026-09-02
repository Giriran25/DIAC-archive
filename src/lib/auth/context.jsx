/* ---------------------------------------------------------------------- *
 * DAIC ARCHIVE — Auth context
 *
 * Provides authentication state to the component tree. The actual
 * authentication logic is delegated to the provider (currently a
 * development mock; will be replaced by real backend auth).
 * ---------------------------------------------------------------------- */

import { createContext, useCallback, useContext, useState } from 'react';
import { login as devLogin, logout as devLogout } from './provider.js';

const AuthContext = createContext(null);

export function AuthProvider({ children, initialAuth = false }) {
  const [auth, setAuth] = useState({
    authenticated: initialAuth,
    role: initialAuth ? 'archivist' : null,
    username: initialAuth ? 'archivist_dev' : null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const login = useCallback(async (username, password) => {
    setLoading(true);
    setError(null);
    try {
      const result = await devLogin(username, password);
      setAuth({
        authenticated: true,
        role: result.role,
        username: result.username,
      });
      return true;
    } catch (err) {
      setError(err.message || 'Login failed');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await devLogout();
    } catch { /* best-effort */ }
    setAuth({ authenticated: false, role: null, username: null });
    setError(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      ...auth,
      loading,
      error,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
