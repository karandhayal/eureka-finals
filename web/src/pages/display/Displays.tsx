import { asset } from '../../lib/asset';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { rpc } from '../../lib/api';
import { useLive, useConnection } from '../../lib/live';
import { fmtClock, phaseElapsed } from '../../lib/clock';
import { useTick } from '../../lib/live';
import type { Settings } from '../../lib/types';

function useDark() {
  useEffect(() => { document.body.classList.add('theme-dark'); document.body.style.background = 'var(--bg)'; return () => { document.body.classList.remove('theme-dark'); document.body.style.background = ''; }; }, []);
}
function ConnDot() {
  const c = useConnection();
  return <span style={{ position: 'fixed', right: 16, bottom: 12, fontSize: 12, color: c === 'offline' ? 'var(--danger)' : 'var(--text-3)' }}>{c === 'offline' ? 'Reconnecting…' : ''}</span>;
}

type RD = { settings: Settings; room: { name: string; status: string; last_ended_at: string | null }; live: any; next: { name: string; eureka_id: string }[] };

/** Projector screen for one room: readable from the back of the room. */
export function RoomDisplay() {
  const { code = '' } = useParams();
  useDark(); useTick(1000);
  const q = useLive(() => rpc<RD>('room_display', { p_code: code }), [code], { safetyMs: 10000 });
  const d = q.data;
  if (!d) return <div className="theme-dark" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-2)' }}>{q.error ? q.error.message : 'Loading…'}</div>;
  const live = d.live;
  const allotted = live ? (live.status === 'pitch' ? d.settings.pitch_s : d.settings.qa_s) : 0;
  const left = live ? allotted - phaseElapsed(live) : 0;
  const over = left < 0;
  const warn = !over && left <= 60;
  return (
    <div className="theme-dark" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '4vh 5vw', color: 'var(--text)', gap: '3vh' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: 'clamp(18px, 2.4vw, 32px)' }}>
        <img src={asset('ecell-mark-white.png')} alt="E-Cell" style={{ height: '1.4em', width: 'auto' }} />
        <strong>{d.room.name}</strong><span style={{ color: 'var(--text-3)' }}>{d.settings.event_name}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-2)' }}>{live ? (live.paused_at ? 'Paused' : live.status === 'pitch' ? 'Pitch' : 'Questions and answers') : d.room.status === 'open' ? (d.room.last_ended_at ? 'Changeover' : 'Starting soon') : d.room.status === 'break' ? 'Break' : 'Closed'}</span>
      </header>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2vh' }}>
        {live ? <>
          <div style={{ fontSize: 'clamp(28px, 5vw, 80px)', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em' }}>{live.name}</div>
          <div style={{ fontSize: 'clamp(16px, 2vw, 28px)', color: 'var(--text-2)' }}>{live.eureka_id} · {live.track}</div>
          <div className="timer" aria-live="off" style={{ fontSize: 'clamp(96px, 22vw, 340px)', lineHeight: 0.95, color: over ? 'var(--danger)' : warn ? 'var(--warn)' : 'var(--text)', opacity: live.paused_at ? 0.5 : 1 }}>
            {over ? '+' : ''}{fmtClock(Math.abs(left))}
          </div>
          <div style={{ height: 10, background: 'var(--surface-2)', borderRadius: 5, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, (1 - Math.max(left, 0) / Math.max(allotted, 1)) * 100)}%`, background: over ? 'var(--danger)' : warn ? 'var(--warn)' : 'var(--accent)', transition: 'width 1s linear' }} /></div>
        </> : (
          <div style={{ fontSize: 'clamp(28px, 4vw, 64px)', color: 'var(--text-2)' }}>
            {d.room.status !== 'open' ? `This room is ${d.room.status === 'break' ? 'on a break' : 'closed'}.` : d.next[0] ? <>Next: <strong style={{ color: 'var(--text)' }}>{d.next[0].name}</strong></> : 'Waiting for the next startup.'}
          </div>
        )}
      </main>
      {d.next.length > 0 && live && (
        <footer style={{ fontSize: 'clamp(16px, 2vw, 30px)', color: 'var(--text-2)', borderTop: '1px solid var(--border)', paddingTop: '2vh' }}>
          Up next: <strong style={{ color: 'var(--text)' }}>{d.next.map(n => n.name).join(', then ')}</strong>
        </footer>
      )}
      <ConnDot />
    </div>
  );
}

type HB = { settings: Settings; rooms: { name: string; status: string; live: { name: string; phase: string } | null; next: { name: string; eureka_id: string }[] }[] };

/** Waiting-area board: every room's now and next. */
export function HallBoard() {
  const { code = '' } = useParams();
  useDark();
  const q = useLive(() => rpc<HB>('hall_board', { p_code: code }), [code], { safetyMs: 10000 });
  const d = q.data;
  if (!d) return <div className="theme-dark" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-2)' }}>{q.error ? q.error.message : 'Loading…'}</div>;
  return (
    <div className="theme-dark" style={{ minHeight: '100vh', padding: '3vh 3vw', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: '2vh' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16 }}><img src={asset('ecell-logo-white.png')} alt="E-Cell IIT Bombay" style={{ height: 'clamp(40px, 5vw, 72px)', width: 'auto' }} /><h1 style={{ fontSize: 'clamp(22px, 2.6vw, 40px)' }}>{d.settings.event_name}</h1><span style={{ color: 'var(--text-3)', fontSize: 'clamp(14px, 1.4vw, 22px)' }}>If your name is under "Go now", go to that room.</span></header>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'clamp(16px, 1.7vw, 28px)' }}>
        <thead><tr style={{ color: 'var(--text-3)', textAlign: 'left', fontSize: '0.7em' }}><th style={{ padding: '1vh 1vw' }}>Room</th><th style={{ padding: '1vh 1vw' }}>Pitching now</th><th style={{ padding: '1vh 1vw' }}>Go now</th></tr></thead>
        <tbody>{d.rooms.map(r => (
          <tr key={r.name} style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: '1.4vh 1vw', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</td>
            <td style={{ padding: '1.4vh 1vw', color: r.live ? 'var(--text)' : 'var(--text-3)' }}>{r.status === 'break' ? 'Break' : r.live?.name ?? '-'}</td>
            <td style={{ padding: '1.4vh 1vw', color: 'var(--accent)', fontWeight: 600 }}>{r.next.map(n => n.name).join(', ') || <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>-</span>}</td>
          </tr>))}
        </tbody>
      </table>
      <ConnDot />
    </div>
  );
}
