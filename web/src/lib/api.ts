// One door to the backend: every call is a database function over HTTPS.
import { noteServerTime } from './clock';

export const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:54321';
export const ANON_KEY: string = import.meta.env.VITE_ANON_KEY || '';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type Listener = (ok: boolean) => void;
const netListeners = new Set<Listener>();
let lastNetOk = true;
export function onNetwork(fn: Listener) { netListeners.add(fn); return () => { netListeners.delete(fn); }; }
function setNet(ok: boolean) { if (ok !== lastNetOk) { lastNetOk = ok; netListeners.forEach(f => f(ok)); } }
export const isNetOk = () => lastNetOk;

const authListeners = new Set<() => void>();
export function onAuthExpired(fn: () => void) { authListeners.add(fn); return () => { authListeners.delete(fn); }; }

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Call a backend function. Writes carry a request id (p_req) so a retry after a dropped
 * connection returns the first result instead of acting twice; they are retried automatically.
 */
export async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}, opts: { retries?: number; signal?: AbortSignal } = {}): Promise<T> {
  const isWrite = 'p_req' in args;
  const retries = opts.retries ?? (isWrite ? 3 : 1);
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ANON_KEY ? { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } : {}),
        },
        body: JSON.stringify(args),
        signal: opts.signal,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        // Server reachable; this is a business answer, never retried.
        setNet(true);
        const raw: string = data?.message || res.statusText || 'Request failed';
        const m = raw.match(/^([A-Z_]+): ([\s\S]*)$/);
        const code = m ? m[1] : res.status >= 500 ? 'SERVER' : 'ERROR';
        const message = m ? m[2] : res.status >= 500 ? 'The server had a problem. Try again in a moment.' : raw;
        if (code === 'AUTH') authListeners.forEach(f => f());
        throw new ApiError(code, message, res.status);
      }
      setNet(true);
      if (data && typeof data === 'object' && 'now' in data) noteServerTime(data.now);
      return data as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as any)?.name === 'AbortError') throw e;
      setNet(false);
      if (attempt >= retries) throw new ApiError('NETWORK', 'No connection. Your action was not confirmed; it will be safe to try again.', 0);
      attempt++;
      await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }
}

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error)?.message || 'Something went wrong.');
