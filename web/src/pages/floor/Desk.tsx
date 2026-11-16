import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Keyboard, Plus, Undo2, UserPlus } from 'lucide-react';
import { rpc } from '../../lib/api';
import { useStaff } from '../../lib/auth';
import { useLive } from '../../lib/live';
import { fmtTime } from '../../lib/clock';
import { useIsMobile } from '../../lib/useMedia';
import type { AdminState, Startup } from '../../lib/types';
import { StaffShell } from '../../shell/StaffShell';
import { Button, Callout, Confirm, Dialog, Empty, Field, Input, SearchInput, Select, Seg, StartupStatus, useAction } from '../../ui';
import { QrScan } from '../../ui/qr';

/** Registration desk. Desktop: search focused on load, works with a USB scanner. Mobile: camera first. */
export default function Desk() {
  const { token } = useStaff();
  const mobile = useIsMobile();
  const [mode, setMode] = useState<'scan' | 'search'>(mobile ? 'scan' : 'search');
  const [text, setText] = useState('');
  const [results, setResults] = useState<Startup[] | null>(null);
  const [sel, setSel] = useState<Startup | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [undo, setUndo] = useState<Startup | null>(null);
  const [last, setLast] = useState<{ s: Startup; already: boolean } | null>(null);
  const { run, must, pending } = useAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const stats = useLive(() => rpc<AdminState>('admin_state', { p_token: token }), [token]);

  const search = async (q: string) => {
    if (!q.trim()) { setResults(null); return; }
    const r = await rpc<Startup[]>('startup_search', { p_token: token, p_q: q }).catch(() => []);
    setResults(r);
    // A scan or exact ID match selects the startup straight away.
    const exact = r.find(x => x.eureka_id.toUpperCase() === q.trim().toUpperCase().replace(/^PD:/, ''));
    if (exact) setSel(exact); else if (r.length === 1) setSel(r[0]);
  };
  useEffect(() => { const t = setTimeout(() => search(text), 180); return () => clearTimeout(t); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkIn = async (s: Startup) => {
    const r = await run<{ already: boolean; startup: Startup }>('checkin', 'checkin', { p_token: token, p_startup: s.id },
      x => x.already ? null : `${x.startup.name} checked in, ticket #${x.startup.ticket_no}`);
    if (r) {
      setLast({ s: r.startup, already: r.already });
      setSel(null); setText(''); setResults(null);
      if (navigator.vibrate) navigator.vibrate(r.already ? [40, 60, 40] : 60);
      if (!mobile) inputRef.current?.focus();
    }
  };

  const counts = stats.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0) - (counts.withdrawn ?? 0);
  const arrived = total - (counts.registered ?? 0);

  const finder = (
    <section className="panel">
      <div className="panel-head">
        <h2>Find startup</h2><div className="spacer" />
        <Seg label="Input method" value={mode} onChange={setMode} options={[{ value: 'scan', label: <span className="row" style={{ gap: 6 }}><Camera size={14} />Scan</span> }, { value: 'search', label: <span className="row" style={{ gap: 6 }}><Keyboard size={14} />Search</span> }]} />
      </div>
      <div className="panel-body col-4">
        {mode === 'scan' && <QrScan onCode={code => { setMode('search'); setText(code); }} />}
        <SearchInput ref={inputRef} autoFocus={!mobile} value={text} onChange={e => setText(e.target.value)} placeholder="Eureka! ID, startup name or email" aria-label="Search startups"
          onKeyDown={e => { if (e.key === 'Enter' && sel && !sel.checked_in_at) checkIn(sel); }} />
        {results && results.length === 0 && <Callout tone="warn" title="No startup found">Check the spelling, or add them as a walk-in.</Callout>}
        {results && results.length > 0 && !sel && (
          <div className="panel list">
            {results.map(s => (
              <button key={s.id} className="list-item" onClick={() => setSel(s)}>
                <div className="main"><span className="title truncate">{s.name}</span><span className="meta">{s.eureka_id} · {s.track}</span></div>
                <StartupStatus status={s.status} />
              </button>
            ))}
          </div>
        )}
        <div className="row"><Button variant="quiet" size="sm" icon={<UserPlus size={16} />} onClick={() => setWalkIn(true)}>Add a walk-in</Button></div>
      </div>
    </section>
  );

  const selected = sel && (
    <section className="panel" aria-live="polite">
      <div className="panel-head"><h2>Check in</h2><div className="spacer" /><Button variant="quiet" size="sm" onClick={() => setSel(null)}>Clear</Button></div>
      <div className="panel-body col-4">
        <div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{sel.name}</div>
          <div className="muted small">{sel.eureka_id} · {sel.track} · {sel.email}</div>
        </div>
        {sel.checked_in_at
          ? <Callout tone="ok" title={`Already checked in, ticket #${sel.ticket_no}`}>By {sel.checked_in_by} at {fmtTime(sel.checked_in_at)}. The first check-in time is kept.</Callout>
          : sel.status === 'withdrawn' ? <Callout tone="danger" title="Withdrawn">An admin must restore this startup before check-in.</Callout>
          : <Button variant="primary" size="lg" block icon={<CheckCircle2 size={18} />} pending={pending === 'checkin'} onClick={() => checkIn(sel)}>Mark present</Button>}
        {sel.status === 'no_show' && <Button onClick={() => run('restore', 'startup_set_active', { p_token: token, p_startup: sel.id, p_active: true, p_reason: 'Arrived at desk' }, 'Back in the queue').then(() => setSel(null))}>Return to queue (was no-show)</Button>}
        {sel.checked_in_at && !['pitching', 'done'].includes(sel.status) && <Button variant="quiet" icon={<Undo2 size={16} />} onClick={() => setUndo(sel)}>Undo check-in</Button>}
      </div>
    </section>
  );

  const lastBox = last && !sel && (
    <Callout tone={last.already ? 'warn' : 'ok'} title={last.already ? `${last.s.name} was already checked in` : `${last.s.name} is checked in`}>
      Ticket <strong className="num">#{last.s.ticket_no}</strong>. {last.already ? `First checked in by ${last.s.checked_in_by} at ${fmtTime(last.s.checked_in_at)}.` : 'Ask them to wait in the hall and watch their phone or the hall board.'}
    </Callout>
  );

  return (
    <StaffShell title="Registration desk" updatedAt={stats.updatedAt}
      actions={<span className="small num" aria-label="Arrival count"><strong>{arrived}</strong><span className="muted"> / {total} arrived</span></span>}>
      {mobile ? <div className="col-4">{lastBox}{selected}{finder}</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
          {finder}
          <div className="col-4">{lastBox}{selected || (!lastBox && <div className="panel"><Empty title="Scan a badge or search" icon={<Keyboard size={28} />}>The selected startup appears here. Press Enter to check in.</Empty></div>)}<TrackCounts d={stats.data} /></div>
        </div>
      )}
      {walkIn && <WalkIn onClose={() => setWalkIn(false)} onAdded={s => { setWalkIn(false); setText(s); }} tracks={stats.data?.tracks ?? []} />}
      {undo && <Confirm title={`Undo check-in for ${undo.name}?`} confirmLabel="Undo check-in" danger reason reasonRequired
        body="Use this if the wrong startup was checked in. Their ticket number is released and they leave the queue."
        onConfirm={reason => must('undo', 'checkin_undo', { p_token: token, p_startup: undo.id, p_reason: reason }, 'Check-in undone').then(() => setSel(null))}
        onClose={() => setUndo(null)} />}
    </StaffShell>
  );
}

function TrackCounts({ d }: { d: AdminState | null }) {
  if (!d?.tracks.length) return null;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Arrivals by track</h2></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Track</th><th className="r">Arrived</th><th className="r">Not yet</th></tr></thead>
        <tbody>{d.tracks.map(t => {
          const c = t.counts ?? {}; const not = c.registered ?? 0; const all = Object.values(c).reduce((a, b) => a + b, 0) - (c.withdrawn ?? 0);
          return <tr key={t.id}><td>{t.name}</td><td className="r num">{all - not}</td><td className="r num">{not}</td></tr>;
        })}</tbody>
      </table></div>
    </section>
  );
}

function WalkIn({ onClose, onAdded, tracks }: { onClose: () => void; onAdded: (eid: string) => void; tracks: { id: number; name: string }[] }) {
  const { token } = useStaff();
  const { must, pending } = useAction();
  const [f, setF] = useState({ eureka_id: '', name: '', email: '', track_id: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setErr(null);
    try {
      await must('walkin', 'startup_save', { p_token: token, p_id: null, p_eureka_id: f.eureka_id, p_email: f.email, p_name: f.name, p_track_id: Number(f.track_id) || null }, `${f.name} added`);
      onAdded(f.eureka_id);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog title="Add a walk-in" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Plus size={16} />} pending={pending === 'walkin'} onClick={save} disabled={!f.eureka_id || !f.name || !f.email || !f.track_id}>Add startup</Button></>}>
      <Field label="Eureka! ID" required><Input value={f.eureka_id} onChange={set('eureka_id')} autoCapitalize="characters" placeholder="EU2610001" /></Field>
      <Field label="Startup name" required><Input value={f.name} onChange={set('name')} /></Field>
      <Field label="Email" required><Input type="email" inputMode="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="Track" required><Select value={f.track_id} onChange={set('track_id')}><option value="">Choose a track</option>{tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      <p className="small muted">After adding, check them in from the search results.</p>
      {err && <Callout tone="danger">{err}</Callout>}
    </Dialog>
  );
}
