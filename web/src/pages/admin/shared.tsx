import { fmtClock, phaseElapsed } from '../../lib/clock';
import { useTick } from '../../lib/live';
import type { Room, Session, Settings } from '../../lib/types';

/** A live phase clock computed from server timestamps. */
export function PhaseClock({ s, settings, size = 'md' }: { s: Session; settings: Settings; size?: 'md' | 'lg' | 'xl' }) {
  useTick(1000);
  const el = phaseElapsed(s);
  const allotted = s.status === 'pitch' ? settings.pitch_s : settings.qa_s;
  const left = allotted - el;
  const over = left < 0;
  const fs = size === 'xl' ? 'clamp(96px, 22vw, 260px)' : size === 'lg' ? 56 : 14;
  return (
    <span className={`timer ${over ? 'over' : ''}`} style={{ fontSize: fs, lineHeight: 1 }} aria-label={`${over ? 'over by' : 'remaining'} ${fmtClock(Math.abs(left))}`}>
      {over ? '+' : ''}{fmtClock(Math.abs(left))}
    </span>
  );
}
export const phaseLabel = (s: Session) => (s.paused_at ? 'Paused' : s.status === 'pitch' ? 'Pitch' : 'Q&A');

export function roomNow(r: Room) {
  if (r.status === 'closed') return 'Closed';
  if (r.live) return null;
  if (r.status === 'break') return 'On break';
  return r.on_deck.length ? 'Waiting to start' : 'Idle, queue empty';
}
