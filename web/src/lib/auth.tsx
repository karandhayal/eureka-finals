import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthExpired, rpc } from './api';
import { loadSession, saveSession, type Me } from './session';

type Ctx = { token: string | null; me: Me | null; signIn: (token: string, me: Me) => void; signOut: (reason?: string) => void; setMe: (m: Me) => void; notice: string | null };
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initial = loadSession();
  const [token, setToken] = useState<string | null>(initial?.token ?? null);
  const [me, setMeState] = useState<Me | null>(initial?.me ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const signIn = useCallback((t: string, m: Me) => { setToken(t); setMeState(m); setNotice(null); saveSession({ token: t, me: m }); }, []);
  const signOut = useCallback((reason?: string) => {
    const t = loadSession()?.token;
    if (t && !reason) rpc('staff_logout', { p_token: t }).catch(() => {});
    setToken(null); setMeState(null); saveSession(null); setNotice(reason ?? null);
  }, []);
  const setMe = useCallback((m: Me) => { setMeState(m); const s = loadSession(); if (s) saveSession({ ...s, me: m }); }, []);
  useEffect(() => onAuthExpired(() => { if (loadSession()) signOut('Your session ended. Please sign in again.'); }), [signOut]);
  // Refresh role and duty on load (an admin may have changed them).
  useEffect(() => { if (token) rpc<Me>('staff_me', { p_token: token }).then(setMe).catch(() => {}); }, [token, setMe]);
  return <AuthCtx.Provider value={{ token, me, signIn, signOut, setMe, notice }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
/** For screens that only render when signed in. */
export function useStaff() {
  const a = useAuth();
  return { token: a.token as string, me: a.me as Me, isAdmin: a.me?.role === 'admin', signOut: a.signOut, setMe: a.setMe };
}
