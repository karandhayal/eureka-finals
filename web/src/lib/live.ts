// Live updates: a push signal (Supabase Realtime) with a polling fallback.
// Screens never trust the push alone; they also re-check on a timer, on reconnect and on focus.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RealtimeClient } from '@supabase/realtime-js';
import { API_URL, ANON_KEY, rpc, onNetwork, isNetOk } from './api';

type Conn = 'live' | 'polling' | 'offline';
let seq = -1;
let conn: Conn = 'polling';
let started = false;
let pushJoined = false;
const listeners = new Set<() => void>();
const connListeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());
const setConn = (c: Conn) => { if (c !== conn) { conn = c; connListeners.forEach(f => f()); } };
const updateConn = () => setConn(!isNetOk() ? 'offline' : pushJoined ? 'live' : 'polling');

async function checkSeq() {
  try {
    const r = await rpc<{ seq: number }>('poll', {}, { retries: 0 });
    if (r.seq !== seq) { seq = r.seq; emit(); }
  } catch { /* network state handled in api */ }
  updateConn();
}

function start() {
  if (started) return;
  started = true;
  if (ANON_KEY && API_URL.startsWith('https')) {
    try {
      const client = new RealtimeClient(API_URL.replace(/^http/, 'ws') + '/realtime/v1', { params: { apikey: ANON_KEY } });
      client.setAuth(ANON_KEY);
      client.channel('pitchday')
        .on('broadcast', { event: 'changed' }, (msg: any) => {
          const s = msg?.payload?.seq;
          if (typeof s === 'number' && s !== seq) { seq = s; emit(); }
        })
        .subscribe(status => {
          pushJoined = status === 'SUBSCRIBED';
          updateConn();
          if (pushJoined) checkSeq();
        });
    } catch { pushJoined = false; }
  }
  const loop = () => {
    const delay = pushJoined ? 15000 : document.hidden ? 10000 : 3000;
    setTimeout(async () => { await checkSeq(); loop(); }, delay);
  };
  checkSeq(); loop();
  window.addEventListener('online', checkSeq);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSeq(); });
  onNetwork(() => updateConn());
}

export function useConnection(): Conn {
  return useSyncExternalStore(f => { connListeners.add(f); return () => connListeners.delete(f); }, () => conn);
}

/** Ask every live view to refetch now (after this device made a change). */
export const refreshAll = () => emit();

/**
 * Load data and keep it current. Previous data stays on screen during refetches and errors,
 * so a flaky connection never blanks a working screen.
 */
export function useLive<T>(fetcher: () => Promise<T>, deps: unknown[], opts: { safetyMs?: number; feed?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const inflight = useRef(false);
  const again = useRef(false);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const alive = useRef(true);

  const run = useCallback(async () => {
    if (inflight.current) { again.current = true; return; }
    inflight.current = true;
    try {
      const d = await fetchRef.current();
      if (!alive.current) return;
      setData(d); setError(null); setUpdatedAt(Date.now());
    } catch (e) {
      if (alive.current) setError(e as Error);
    } finally {
      inflight.current = false;
      if (again.current) { again.current = false; run(); }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    setData(null); setError(null);
    run();
    const useFeed = opts.feed !== false;
    if (useFeed) start();
    let t: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => { clearTimeout(t); t = setTimeout(run, 120); };
    if (useFeed) listeners.add(onChange);
    const safety = setInterval(run, opts.safetyMs ?? 20000);
    const onVis = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', run);
    return () => {
      alive.current = false;
      listeners.delete(onChange); clearInterval(safety); clearTimeout(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading: data === null && error === null, refresh: run, updatedAt };
}

/** Re-render on a fixed beat (for clocks). */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const i = setInterval(() => set(x => x + 1), ms); return () => clearInterval(i); }, [ms]);
}
