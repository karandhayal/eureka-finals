import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, MoreHorizontal, Pause, Play, RotateCcw, Search, SkipForward, Square, UserCheck } from 'lucide-react';
import { rpc } from '../../lib/api';
import { useStaff } from '../../lib/auth';
import { useLive } from '../../lib/live';
import { fmtClock, fmtTime, phaseElapsed } from '../../lib/clock';
import { useIsMobile } from '../../lib/useMedia';
import type { Room, Settings, Startup } from '../../lib/types';
import { StaffShell } from '../../shell/StaffShell';
import { Badge, Button, Callout, Confirm, Dialog, Empty, Field, Input, LoadError, LoadingRows, RoomStatus, SearchInput, Select, StartupStatus, useAction } from '../../ui';
import { PhaseClock, phaseLabel } from '../admin/shared';

type RoomState = { now: string; me: any; settings: Settings; room: Room; rooms: { id: number; name: string; status: string }[]; queue_ahead: number };
const QUICK_REASONS = ['Scheduled startup not in the room', 'Startup arrived late', 'Startup asked for a different slot', 'Admin instruction'];

export default function RoomConsole() {
  const { roomId } = useParams();
  const id = Number(roomId);
  const { token, me, isAdmin, setMe } = useStaff();
  const nav = useNavigate();
  const mobile = useIsMobile();
  const q = useLive(() => rpc<RoomState>('room_state', { p_token: token, p_room: id }), [token, id]);
  const { run, must, pending } = useAction();
  const [override, setOverride] = useState<Startup | null>(null);
  const [skip, setSkip] = useState<Startup | null>(null);
  const [cancel, setCancel] = useState<null | 'cancel' | 'restart'>(null);
  const [search, setSearch] = useState(false);
  const [more, setMore] = useState(false);
  const d = q.data;
  const r = d?.room;
  const live = r?.live ?? null;
  const first = r?.on_deck[0] ?? null;
  const mine = isAdmin || me.room_id === id;

  const switchRoom = async (newId: number) => {
    if (!isAdmin) {
      const m = await run<any>('duty', 'staff_set_duty', { p_token: token, p_duty: 'room', p_room_id: newId }, null as any);
      if (m) setMe(m);
    }
    nav(`/room/${newId}`);
  };

  const start = (s: Startup, reason?: string) =>
    must('start', 'pitch_start', { p_token: token, p_room: id, p_startup: s.id, p_expected_version: s.version, p_reason: reason ?? null }, `${s.name}: pitch started`);
  const advance = () => live && run('advance', 'pitch_advance', { p_token: token, p_session: live.id, p_phase: live.status },
    live.status === 'pitch' && d!.settings.qa_s > 0 ? 'Q&A started' : `${live.startup.name} finished`);
  const pause = () => live && run('pause', 'pitch_pause', { p_token: token, p_session: live.id, p_pause: !live.paused_at }, live.paused_at ? 'Resumed' : 'Paused');

  const primary = useMemo(() => {
    if (!r) return null;
    if (live) {
      const toQa = live.status === 'pitch' && d!.settings.qa_s > 0;
      return { label: toQa ? 'End pitch, start Q&A' : 'Finish', icon: toQa ? <Play size={18} /> : <Square size={16} />, onClick: advance, key: 'advance', disabled: false };
    }
    if (first) return { label: `Start ${first.name}`, icon: <Play size={18} />, onClick: () => run('start', 'pitch_start', { p_token: token, p_room: id, p_startup: first.id, p_expected_version: first.version, p_reason: null }, `${first.name}: pitch started`), key: 'start', disabled: r.status !== 'open' };
    return null;
  }, [r, live, first, d]);

  if (!d || !r) return <StaffShell title="Room console">{q.error ? <LoadError error={q.error} retry={q.refresh} /> : <LoadingRows />}</StaffShell>;

  const roomPicker = (
    <Select value={id} onChange={e => switchRoom(Number(e.target.value))} aria-label="Switch room" style={{ width: mobile ? 140 : 180 }}>
      {d.rooms.map(x => <option key={x.id} value={x.id}>{x.name}{x.status !== 'open' ? ` (${x.status})` : ''}</option>)}
    </Select>
  );

  const current = (
    <section className="panel" aria-label="Current pitch">
      <div className="panel-head"><h2>{live ? 'Now pitching' : 'Next up'}</h2>{live && <Badge tone={live.paused_at ? 'warn' : 'info'} live={!live.paused_at}>{phaseLabel(live)}</Badge>}{live?.is_override && <Badge tone="warn" plain>Override</Badge>}</div>
      <div className="panel-body col-4">
        {live ? <>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{live.startup.name}</div>
            <div className="small muted">{live.startup.eureka_id} · {live.startup.track} · ticket #{live.startup.ticket_no} · started {fmtTime(live.pitch_started_at)} by {live.started_by}</div>
          </div>
          <ClockBlock live={live} settings={d.settings} />
        </> : first ? <>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{first.name}</div>
            <div className="small muted">{first.eureka_id} · {first.track} · ticket #{first.ticket_no}{first.skip_count ? ` · skipped ${first.skip_count}x` : ''}</div>
          </div>
          <p className="small muted">Called to this room. If they are not here, skip them or start whoever is present.</p>
        </> : <Empty title="Nobody waiting for this room" icon={<UserCheck size={28} />}>{d.queue_ahead ? `${d.queue_ahead} startups wait in the queue for this room's tracks.` : 'New check-ins for this room\'s tracks will appear here.'}</Empty>}
        {r.status !== 'open' && <Callout tone="warn" title={`This room is ${r.status === 'break' ? 'on break' : 'closed'}`}>{isAdmin ? 'Open it from the Live screen to continue.' : 'Ask an admin to reopen it.'}</Callout>}
        {!mine && <Callout tone="info">You are viewing another room. Switch to it to run pitches here.</Callout>}
        {!mobile && primary && mine && <Button variant="primary" size="lg" icon={primary.icon} pending={pending === primary.key} disabled={primary.disabled} onClick={primary.onClick}>{primary.label}</Button>}
        {!mobile && mine && (live
          ? <div className="row wrap">
              <Button icon={live.paused_at ? <Play size={16} /> : <Pause size={16} />} pending={pending === 'pause'} onClick={pause}>{live.paused_at ? 'Resume' : 'Pause'}</Button>
              <Button icon={<RotateCcw size={16} />} onClick={() => setCancel('restart')}>Restart</Button>
              <Button variant="danger" icon={<Ban size={16} />} onClick={() => setCancel('cancel')}>Cancel pitch</Button>
            </div>
          : first && <div className="row"><Button icon={<SkipForward size={16} />} onClick={() => setSkip(first)}>Not here, skip</Button></div>)}
      </div>
    </section>
  );

  const deck = (
    <section className="panel" aria-label="On deck">
      <div className="panel-head"><h2>On deck</h2><span className="subtle small hide-mobile">{d.queue_ahead} more in queue</span><div className="spacer" />{mine && <Button size="sm" icon={<Search size={16} />} onClick={() => setSearch(true)}>Start someone else</Button>}</div>
      {r.on_deck.length ? (
        <div className="list">
          {r.on_deck.map((s, i) => (
            <div key={s.id} className="list-item">
              <span className="num subtle" style={{ width: 20 }}>{i + 1}</span>
              <div className="main"><span className="title truncate">{s.name}</span><span className="meta">{s.eureka_id} · #{s.ticket_no}{s.skip_count ? ` · skipped ${s.skip_count}x` : ''}</span></div>
              {mine && !live && i > 0 && <Button size="sm" onClick={() => setOverride(s)}>Start</Button>}
              {mine && !live && i === 0 && mobile && <Button size="sm" variant="quiet" onClick={() => setSkip(s)}>Skip</Button>}
            </div>
          ))}
        </div>
      ) : <p className="small muted" style={{ padding: 16 }}>Nobody on deck.</p>}
    </section>
  );

  const history = (
    <section className="panel" aria-label="Earlier in this room">
      <div className="panel-head"><h2>Earlier in this room</h2><span className="subtle small">{r.done_count} done</span></div>
      {r.history?.length ? (
        <div className="list" style={{ maxHeight: 320, overflow: 'auto' }}>
          {r.history.map(h => (
            <div key={h.id} className="list-item" style={{ minHeight: 0 }}>
              <div className="main"><span className="small strong truncate">{h.startup_name}</span>
                <span className="meta">{h.status === 'cancelled' ? `Cancelled: ${h.cancel_reason}` : `${fmtTime(h.pitch_started_at)} to ${fmtTime(h.qa_ended_at)}`}{h.is_override ? ' · override' : ''}</span></div>
              {h.status === 'cancelled' ? <Badge>Cancelled</Badge> : <Badge tone="ok">Done</Badge>}
            </div>
          ))}
        </div>
      ) : <p className="small muted" style={{ padding: 16 }}>No pitches yet.</p>}
      {r.last && <div className="small muted" style={{ padding: '8px 16px', borderTop: '1px solid var(--border)' }}>Scores for {r.last.startup}: <strong className="num" style={{ color: r.last.scores_in < r.last.scorers ? 'var(--warn)' : 'var(--ok)' }}>{r.last.scores_in} of {r.last.scorers}</strong> in</div>}
    </section>
  );

  return (
    <StaffShell title={<span className="row">{r.name} <RoomStatus status={r.status} /></span>} actions={roomPicker} updatedAt={q.updatedAt}>
      {mobile ? (
        <div className="col-4" style={{ paddingBottom: 80 }}>
          {current}{deck}{history}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 24, alignItems: 'start' }}>
          <div className="col-6">{current}{history}</div>
          {deck}
        </div>
      )}

      {mobile && mine && (primary || live) && (
        <div className="sticky-foot" style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(var(--bottombar-h) + env(safe-area-inset-bottom))' }}>
          <div className="row">
            {primary && <Button variant="primary" size="lg" block icon={primary.icon} pending={pending === primary.key} disabled={primary.disabled} onClick={primary.onClick}>{primary.label}</Button>}
            <Button size="lg" iconOnly aria-label="More actions" onClick={() => setMore(true)} style={{ width: 52 }}><MoreHorizontal size={20} /></Button>
          </div>
        </div>
      )}
      {more && (
        <Dialog title="Room actions" onClose={() => setMore(false)}>
          <div className="list panel">
            {live && <button className="list-item" onClick={() => { setMore(false); pause(); }}>{live.paused_at ? <Play size={18} /> : <Pause size={18} />}<span className="main title">{live.paused_at ? 'Resume' : 'Pause'}</span></button>}
            {live && <button className="list-item" onClick={() => { setMore(false); setCancel('restart'); }}><RotateCcw size={18} /><span className="main title">Restart pitch</span></button>}
            {live && <button className="list-item" onClick={() => { setMore(false); setCancel('cancel'); }} style={{ color: 'var(--danger)' }}><Ban size={18} /><span className="main title">Cancel pitch</span></button>}
            {!live && first && <button className="list-item" onClick={() => { setMore(false); setSkip(first); }}><SkipForward size={18} /><span className="main title">Skip {first.name}</span></button>}
            {!live && <button className="list-item" onClick={() => { setMore(false); setSearch(true); }}><Search size={18} /><span className="main title">Start someone else</span></button>}
          </div>
        </Dialog>
      )}

      {search && <OverrideSearch roomId={id} onPick={s => { setSearch(false); setOverride(s); }} onClose={() => setSearch(false)} busy={!!live} />}
      {override && <OverrideDialog s={override} roomName={r.name} isFirst={first?.id === override.id} onClose={() => setOverride(null)} onStart={reason => start(override, reason)} />}
      {skip && (
        <Confirm title={`Skip ${skip.name}?`} confirmLabel="Skip" reason reasonLabel="Note (optional)"
          body={skip.skip_count + 1 >= d.settings.skip_limit
            ? <>This is skip number {skip.skip_count + 1}. They will be marked <strong>no-show</strong>. The desk or an admin can bring them back.</>
            : <>They go back to the queue a few places down and will be called again. A second skip marks them no-show.</>}
          onConfirm={reason => must('skip', 'startup_skip', { p_token: token, p_room: id, p_startup: skip.id, p_reason: reason || null }, `${skip.name} skipped`)}
          onClose={() => setSkip(null)} />
      )}
      {cancel && live && (
        <Confirm title={cancel === 'restart' ? `Restart ${live.startup.name}'s pitch?` : `Cancel ${live.startup.name}'s pitch?`}
          danger={cancel === 'cancel'} confirmLabel={cancel === 'restart' ? 'Restart from zero' : 'Cancel pitch'} reason reasonRequired
          body={cancel === 'restart' ? 'This attempt is voided and the clock starts again. The voided attempt stays in the log.' : 'Use this if the wrong startup was started. They go back to the front of this room\'s on-deck list. Nothing is deleted.'}
          onConfirm={reason => must('cancel', 'pitch_cancel', { p_token: token, p_session: live.id, p_restart: cancel === 'restart', p_reason: reason }, cancel === 'restart' ? 'Pitch restarted' : 'Pitch cancelled')}
          onClose={() => setCancel(null)} />
      )}
    </StaffShell>
  );
}

function ClockBlock({ live, settings }: { live: NonNullable<Room['live']>; settings: Settings }) {
  const allotted = live.status === 'pitch' ? settings.pitch_s : settings.qa_s;
  const el = phaseElapsed(live);
  const pct = Math.min(100, (el / Math.max(1, allotted)) * 100);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <PhaseClock s={live} settings={settings} size="lg" />
        <span className="muted small">{el > allotted ? 'over' : 'left'} of {fmtClock(allotted)} {live.status === 'pitch' ? 'pitch' : 'Q&A'}</span>
      </div>
      <div className={`meter ${el > allotted ? 'over' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={allotted} aria-valuenow={el}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function OverrideSearch({ roomId, onPick, onClose, busy }: { roomId: number; onPick: (s: Startup) => void; onClose: () => void; busy: boolean }) {
  const { token } = useStaff();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<(Startup & { serves: boolean; room_name: string | null })[] | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(() => rpc('room_candidates', { p_token: token, p_room: roomId, p_q: text }, { signal: ctl.signal }).then(setRows).catch(() => {}), 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [text, roomId, token]);
  return (
    <Dialog title="Start a startup out of order" onClose={onClose} wide>
      {busy && <Callout tone="warn">A pitch is running in this room. Finish or cancel it before starting another.</Callout>}
      <SearchInput autoFocus placeholder="Search name or Eureka! ID" value={text} onChange={e => setText(e.target.value)} aria-label="Search startups" />
      <div className="panel list" style={{ maxHeight: '50vh', overflow: 'auto' }}>
        {rows === null ? <LoadingRows n={4} /> : rows.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No matching startup can pitch right now.</p> :
          rows.map(s => (
            <button key={s.id} className="list-item" onClick={() => onPick(s)} disabled={busy}>
              <div className="main">
                <span className="title truncate">{s.name}</span>
                <span className="meta">{s.eureka_id} · {s.track}{s.ticket_no ? ` · #${s.ticket_no}` : ''}{s.room_name ? ` · called to ${s.room_name}` : ''}{!s.serves ? ' · different track' : ''}</span>
              </div>
              <StartupStatus status={s.status} />
            </button>
          ))}
      </div>
    </Dialog>
  );
}

function OverrideDialog({ s, roomName, isFirst, onStart, onClose }: { s: Startup; roomName: string; isFirst: boolean; onStart: (reason?: string) => Promise<unknown>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setPending(true); setErr(null);
    try { await onStart(isFirst ? undefined : reason.trim()); onClose(); } catch (e) { setErr((e as Error).message); } finally { setPending(false); }
  };
  const blocked = !isFirst && !reason.trim();
  return (
    <Dialog title={`Start ${s.name} in ${roomName}?`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" pending={pending} disabled={blocked} onClick={go} icon={<Play size={16} />}>Start pitch now</Button></>}>
      <dl className="kv">
        <dt>Eureka! ID</dt><dd>{s.eureka_id}</dd>
        <dt>Track</dt><dd>{s.track}</dd>
        <dt>Status</dt><dd><StartupStatus status={s.status} /></dd>
        <dt>Ticket</dt><dd>{s.ticket_no ? `#${s.ticket_no}` : 'Not checked in'}</dd>
      </dl>
      {!isFirst && <>
        <Callout tone="info">This is a manual override. The original order is kept; this pitch is recorded with your name, the time and the reason.</Callout>
        <Field label="Reason" required>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why this startup now?" maxLength={200} onKeyDown={e => e.key === 'Enter' && !blocked && go()} />
        </Field>
        <div className="row wrap">{QUICK_REASONS.map(q => <Button key={q} size="sm" variant={reason === q ? 'primary' : 'default'} onClick={() => setReason(q)}>{q}</Button>)}</div>
      </>}
      {err && <Callout tone="danger">{err}</Callout>}
    </Dialog>
  );
}
