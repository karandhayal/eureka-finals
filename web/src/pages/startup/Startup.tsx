import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock, DoorOpen, MapPin, PauseCircle, XCircle } from 'lucide-react';
import { errMsg, rpc } from '../../lib/api';
import { useLive } from '../../lib/live';
import { fmtDuration, fmtTime, serverNow } from '../../lib/clock';
import { store } from '../../lib/session';
import { Button, Callout, Field, Input, LoadError, LoadingRows } from '../../ui';
import { QrImage } from '../../ui/qr';
import { Brand, OrgLogo } from '../../ui/brand';

const KEY = 'pd.startup';

export function StartupLookup() {
  const nav = useNavigate();
  const [eid, setEid] = useState('');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const t = store.get(KEY); if (t) nav(`/s/${t}`, { replace: true }); }, [nav]);
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setPending(true); setErr(null);
    try { const r = await rpc<{ token: string }>('startup_access', { p_eureka_id: eid, p_email: email }); store.set(KEY, r.token); nav(`/s/${r.token}`); }
    catch (e2) { setErr(errMsg(e2)); } finally { setPending(false); }
  };
  return (
    <div className="solo">
      <main className="panel auth-card">
        <form className="col-4" onSubmit={go}>
          <div className="col" style={{ gap: 4 }}><div style={{ marginBottom: 20 }}><OrgLogo height={64} /></div><h1>Find your pitch</h1><p className="small muted">Eureka! Finals. See your queue position, your room and your check-in QR code.</p></div>
          <Field label="Eureka! ID" required htmlFor="eid"><Input id="eid" value={eid} onChange={e => setEid(e.target.value)} autoCapitalize="characters" autoComplete="off" placeholder="EU2610001" /></Field>
          <Field label="Registered email" required htmlFor="em"><Input id="em" type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></Field>
          {err && <Callout tone="danger">{err}</Callout>}
          <Button type="submit" variant="primary" block pending={pending} disabled={!eid || !email}>Continue</Button>
        </form>
      </main>
    </div>
  );
}

type Me = { now: string; event_name: string; startup: { name: string; eureka_id: string; track: string; status: string; ticket_no: number | null; checked_in_at: string | null };
  room: { id: number; name: string } | null; session: { status: string; room: string; started_at: string; ended_at: string | null } | null;
  ahead: number | null; rooms_for_track: number | null; eta_s: number | null; qr: string };

export function StartupPage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  // Startup phones poll their own small status every 15 seconds; they do not hold a live connection.
  const q = useLive(() => rpc<Me>('startup_me', { p_stoken: token }), [token], { feed: false, safetyMs: 15000 });
  const prev = useRef<string | null>(null);
  const d = q.data;
  useEffect(() => { if (d) store.set(KEY, token); }, [d, token]);
  useEffect(() => {
    if (!d) return;
    if (d.startup.status === 'on_deck' && prev.current && prev.current !== 'on_deck' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
    prev.current = d.startup.status;
  }, [d?.startup.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <div className="solo"><div className="solo-body">{q.error ? <><LoadError error={q.error} retry={q.refresh} /><Button variant="quiet" onClick={() => { store.del(KEY); nav('/s'); }}>Look up again</Button></> : <LoadingRows />}</div></div>;
  const s = d.startup;
  const age = q.updatedAt ? Math.round((Date.now() - q.updatedAt) / 1000) : 0;
  const stale = !!q.error || age > 45;

  if (s.status === 'on_deck' && d.room) return (
    <div className="solo" style={{ background: 'var(--accent)', color: '#fff' }} role="alert">
      <main className="solo-body" style={{ justifyContent: 'center', textAlign: 'center', gap: 24 }}>
        <DoorOpen size={48} style={{ margin: '0 auto' }} />
        <div className="col" style={{ gap: 8 }}>
          <div style={{ fontSize: 16, opacity: 0.9 }}>Go now to</div>
          <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05 }}>{d.room.name}</div>
          <div style={{ fontSize: 16, opacity: 0.9 }}>You pitch next or very soon. Wait at the door for the room coordinator.</div>
        </div>
        <div className="small" style={{ opacity: 0.8 }}>{s.name} · {s.eureka_id}</div>
        <Freshness stale={stale} age={age} light />
      </main>
    </div>
  );

  const status = (() => {
    switch (s.status) {
      case 'registered': return { icon: <MapPin size={22} />, title: 'Check in at the registration desk', body: 'Show this QR code at the desk. You join the queue the moment you are checked in.', tone: 'neutral' };
      case 'waiting': return { icon: <Clock size={22} />, title: 'You are in the queue', body: d.rooms_for_track ? `${d.ahead ?? 0} ahead of you in ${s.track}. Stay nearby; this page tells you which room to go to.` : `No room is serving ${s.track} right now. Stay nearby; the organisers will open one.`, tone: 'neutral' };
      case 'hold': return { icon: <PauseCircle size={22} />, title: 'You are on hold', body: 'The organisers have paused your slot. They will put you back in the queue.', tone: 'warn' };
      case 'pitching': return { icon: <DoorOpen size={22} />, title: `Pitching now in ${d.room?.name ?? d.session?.room ?? 'your room'}`, body: 'Good luck.', tone: 'info' };
      case 'done': return { icon: <CheckCircle2 size={22} />, title: 'Your pitch is complete', body: d.session ? `Pitched in ${d.session.room} at ${fmtTime(d.session.started_at)}. Thank you.` : 'Thank you.', tone: 'ok' };
      case 'no_show': return { icon: <XCircle size={22} />, title: 'You missed your call', body: 'Go to the registration desk now. They can put you back in the queue.', tone: 'danger' };
      default: return { icon: <XCircle size={22} />, title: 'Not in the queue', body: 'Please speak to the registration desk.', tone: 'neutral' };
    }
  })();
  const eta = d.eta_s != null ? new Date(serverNow() + d.eta_s * 1000) : null;

  return (
    <div className="solo">
      <header className="solo-head"><div className="col" style={{ gap: 0, minWidth: 0 }}><strong className="truncate">{s.name}</strong><span className="xsmall subtle">{s.eureka_id} · {s.track}</span></div><div className="spacer" /><Brand /></header>
      <main className="solo-body">
        <section className="panel panel-body col-3" aria-live="polite">
          <div className="row" style={{ color: status.tone === 'ok' ? 'var(--ok)' : status.tone === 'danger' ? 'var(--danger)' : status.tone === 'warn' ? 'var(--warn)' : 'var(--accent)' }}>{status.icon}<h1 style={{ color: 'var(--text)' }}>{status.title}</h1></div>
          <p className="muted">{status.body}</p>
          {s.status === 'waiting' && d.rooms_for_track ? (
            <dl className="kv" style={{ fontSize: 14 }}>
              <dt>Ahead of you</dt><dd className="num strong">{d.ahead}</dd>
              <dt>Estimated time</dt><dd><strong className="num">{eta ? `around ${fmtTime(eta.toISOString())}` : '-'}</strong> <span className="subtle">(in about {fmtDuration(d.eta_s)}, an estimate that updates as rooms move)</span></dd>
              <dt>Ticket</dt><dd className="num">#{s.ticket_no}</dd>
            </dl>
          ) : null}
          <Freshness stale={stale} age={age} />
        </section>
        {['registered', 'waiting', 'hold', 'no_show'].includes(s.status) && (
          <section className="panel panel-body col" style={{ alignItems: 'center' }}>
            <QrImage value={d.qr} size={s.status === 'registered' ? 240 : 160} label={`Check-in QR code for ${s.name}`} />
            <span className="small muted mono">{s.eureka_id}</span>
          </section>
        )}
        <Button variant="quiet" size="sm" icon={<ArrowRight size={16} />} onClick={() => { store.del(KEY); nav('/s'); }}>Not your startup? Look up another</Button>
      </main>
    </div>
  );
}

function Freshness({ stale, age, light }: { stale: boolean; age: number; light?: boolean }) {
  return <p className="xsmall" style={{ color: light ? 'rgba(255,255,255,0.8)' : stale ? 'var(--danger)' : 'var(--text-3)' }} role="status">
    {stale ? `Connection problem. Last updated ${age}s ago. Check with the desk if in doubt.` : 'Updates automatically every 15 seconds.'}
  </p>;
}
