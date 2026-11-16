// Server-aligned clock: every response carries the server's "now", so timers agree on every device.
let offsetMs = 0;
let samples = 0;
export function noteServerTime(iso: string) {
  const server = Date.parse(iso);
  if (Number.isNaN(server)) return;
  const est = server - Date.now();
  // Smooth over network jitter; trust the first sample fully.
  offsetMs = samples === 0 ? est : offsetMs * 0.7 + est * 0.3;
  samples++;
}
export const serverNow = () => Date.now() + offsetMs;

/** Seconds elapsed in the current phase of a session (pauses excluded). */
export function phaseElapsed(s: { phase_started_at: string; phase_paused_s: number | string; paused_at: string | null }): number {
  const start = Date.parse(s.phase_started_at);
  const end = s.paused_at ? Date.parse(s.paused_at) : serverNow();
  return Math.max(0, Math.floor((end - start) / 1000 - Number(s.phase_paused_s || 0)));
}

export function fmtClock(totalSeconds: number): string {
  const neg = totalSeconds < 0;
  const t = Math.abs(Math.round(totalSeconds));
  const m = Math.floor(t / 60), s = t % 60;
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}`;
}
export function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function fmtAgo(iso?: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((serverNow() - Date.parse(iso)) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return fmtTime(iso);
}
export function fmtDuration(sec?: number | null): string {
  if (sec == null) return '';
  const m = Math.round(sec / 60);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
