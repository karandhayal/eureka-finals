// Staff sign-in is stored on this device only.
export type Me = { id: number; name: string; email: string; role: 'admin' | 'coordinator'; duty: 'desk' | 'room' | 'floor' | null; room_id: number | null };
const KEY = 'pd.staff';
export function loadSession(): { token: string; me: Me } | null {
  try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function saveSession(s: { token: string; me: Me } | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}
export const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
