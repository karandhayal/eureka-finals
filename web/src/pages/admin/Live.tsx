import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Copy, DoorOpen, ExternalLink, MonitorPlay, XCircle } from 'lucide-react';
import { rpc } from '../../lib/api';
import { useStaff } from '../../lib/auth';
import { useLive } from '../../lib/live';
import { fmtAgo } from '../../lib/clock';
import { actionLabel } from '../../lib/actions';
import { displayLink, hallLink } from '../../lib/links';
import { useIsMobile } from '../../lib/useMedia';
import type { AdminState, Room } from '../../lib/types';
import { StaffShell } from '../../shell/StaffShell';
import { Badge, Button, Confirm, Empty, LoadError, LoadingRows, RoomStatus, Tabs, useAction, useToast } from '../../ui';
import { PhaseClock, phaseLabel, roomNow } from './shared';

export default function Live() {
  const { token } = useStaff();
  const q = useLive(() => rpc<AdminState>('admin_state', { p_token: token }), [token]);
  const mobile = useIsMobile();
  const [tab, setTab] = useState<'rooms' | 'alerts' | 'activity'>('rooms');
  const [sel, setSel] = useState<number | null>(null);
  const d = q.data;
  const room = d?.rooms.find(r => r.id === sel) ?? null;

  return (
    <StaffShell title="Live" updatedAt={q.updatedAt}>
      {!d ? (q.error ? <LoadError error={q.error} retry={q.refresh} /> : <LoadingRows n={8} />) : <>
        <Summary d={d} />
        {mobile ? <>
          <Tabs value={tab} onChange={setTab} items={[{ value: 'rooms', label: 'Rooms', count: d.rooms.length }, { value: 'alerts', label: 'Alerts', count: d.alerts.length }, { value: 'activity', label: 'Activity' }]} />
          {tab === 'rooms' && <RoomList d={d} onPick={setSel} />}
          {tab === 'alerts' && <Alerts d={d} />}
          {tab === 'activity' && <ActivityFeed d={d} />}
        </> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 24, alignItems: 'start' }}>
            <section className="panel" aria-label="Rooms">
              <div className="panel-head"><h2>Rooms</h2><span className="subtle small">{d.rooms.filter(r => r.status === 'open').length} open of {d.rooms.length}</span><div className="spacer" /><Link to="/rooms" className="small">Manage rooms</Link></div>
              <RoomTable d={d} onPick={setSel} selected={sel} />
            </section>
            <div className="col-6">
              <section className="panel" aria-label="Alerts"><div className="panel-head"><h2>Needs attention</h2><Badge tone={d.alerts.length ? 'warn' : 'ok'}>{d.alerts.length || 'None'}</Badge></div><Alerts d={d} /></section>
              <section className="panel" aria-label="Recent activity"><div className="panel-head"><h2>Recent activity</h2><div className="spacer" /><Link to="/activity" className="small">Full log</Link></div><ActivityFeed d={d} /></section>
            </div>
          </div>
        )}
        {room && <RoomPanel room={room} d={d} onClose={() => setSel(null)} />}
      </>}
    </StaffShell>
  );
}

function Summary({ d }: { d: AdminState }) {
  const c = d.counts ?? {};
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const arrived = total - (c.registered ?? 0) - (c.withdrawn ?? 0);
  const items: [string, number | string, string?][] = [
    ['Arrived', `${arrived} / ${total - (c.withdrawn ?? 0)}`],
    ['In queue', c.waiting ?? 0], ['Called', c.on_deck ?? 0], ['Pitching', c.pitching ?? 0],
    ['Done', c.done ?? 0], ['On hold', c.hold ?? 0], ['No-show', c.no_show ?? 0, (c.no_show ?? 0) ? 'var(--danger)' : undefined],
    ['Judges in', `${d.judges.arrived} / ${d.judges.total}`],
  ];
  return (
    <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 1, background: 'var(--border)', overflow: 'hidden' }} role="list" aria-label="Event summary">
      {items.map(([k, v, color]) => (
        <div key={k} role="listitem" style={{ padding: '10px 16px', background: 'var(--surface)' }}>
          <div className="xsmall subtle">{k}</div>
          <div className="num strong" style={{ fontSize: 18, color }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function NowCell({ r, d }: { r: Room; d: AdminState }) {
  if (r.live) return (
    <div className="row" style={{ minWidth: 0 }}>
      <Badge tone="info" live>{phaseLabel(r.live)}</Badge>
      <span className="truncate strong">{r.live.startup.name}</span>
      {r.live.is_override && <Badge tone="warn" plain>Override</Badge>}
      <span className="spacer" />
      <PhaseClock s={r.live} settings={d.settings} />
    </div>
  );
  return <span className="subtle">{roomNow(r)}</span>;
}

function RoomTable({ d, onPick, selected }: { d: AdminState; onPick: (id: number) => void; selected: number | null }) {
  if (!d.rooms.length) return <Empty icon={<DoorOpen size={28} />} title="No rooms yet" action={<Link to="/setup#rooms" className="btn btn-primary">Add rooms</Link>}>Create rooms and choose which tracks each one serves.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Room</th><th>Status</th><th style={{ width: '38%' }}>Now</th><th>On deck</th><th className="r">Done</th><th className="r">Scores</th></tr></thead>
        <tbody>
          {d.rooms.map(r => (
            <tr key={r.id} className={`clickable ${selected === r.id ? 'is-selected' : ''}`} onClick={() => onPick(r.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onPick(r.id)} aria-label={`Open ${r.name}`}>
              <td><div className="strong">{r.name}</div><div className="xsmall subtle truncate" style={{ maxWidth: 180 }}>{r.tracks.join(', ') || 'No track'}</div></td>
              <td><RoomStatus status={r.status} /></td>
              <td><NowCell r={r} d={d} /></td>
              <td className="small">{r.on_deck.length ? r.on_deck.map(s => s.name).join(', ') : <span className="subtle">None</span>}</td>
              <td className="r num">{r.done_count}</td>
              <td className="r num small">{r.last ? <span style={{ color: r.last.scores_in < r.last.scorers ? 'var(--warn)' : undefined }}>{r.last.scores_in}/{r.last.scorers}</span> : <span className="subtle">-</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoomList({ d, onPick }: { d: AdminState; onPick: (id: number) => void }) {
  return (
    <div className="panel list">
      {d.rooms.map(r => (
        <button key={r.id} className="list-item" onClick={() => onPick(r.id)}>
          <div className="main">
            <div className="row"><span className="title">{r.name}</span><RoomStatus status={r.status} /></div>
            {r.live
              ? <div className="row small"><span className="truncate">{r.live.startup.name}</span><span className="spacer" /><span className="subtle">{phaseLabel(r.live)}</span><PhaseClock s={r.live} settings={d.settings} /></div>
              : <span className="meta">{roomNow(r)}{r.on_deck[0] ? ` · next ${r.on_deck[0].name}` : ''}</span>}
          </div>
          <ArrowRight size={16} className="subtle" />
        </button>
      ))}
    </div>
  );
}

function Alerts({ d }: { d: AdminState }) {
  if (!d.alerts.length) return <p className="small muted" style={{ padding: 16 }}>Nothing needs attention right now.</p>;
  return (
    <div className="list">
      {d.alerts.map((a, i) => (
        <div key={i} className="list-item" style={{ alignItems: 'flex-start', minHeight: 0 }}>
          {a.level === 'critical' ? <XCircle size={16} color="var(--danger)" style={{ marginTop: 2, flexShrink: 0 }} /> : <AlertTriangle size={16} color="var(--warn)" style={{ marginTop: 2, flexShrink: 0 }} />}
          <span className="small">{a.text}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityFeed({ d }: { d: AdminState }) {
  if (!d.activity.length) return <p className="small muted" style={{ padding: 16 }}>No activity yet.</p>;
  return (
    <div className="list" style={{ maxHeight: 420, overflow: 'auto' }}>
      {d.activity.slice(0, 25).map(l => (
        <div key={l.id} className="list-item" style={{ minHeight: 0, alignItems: 'flex-start' }}>
          <div className="main">
            <span className="small"><strong>{actionLabel(l.action)}</strong>{l.startup ? ` · ${l.startup}` : ''}{l.room ? ` · ${l.room}` : ''}</span>
            <span className="meta">{l.actor} · {fmtAgo(l.at)}{l.reason ? ` · "${l.reason}"` : ''}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RoomPanel({ room, d, onClose }: { room: Room; d: AdminState; onClose: () => void }) {
  const { token } = useStaff();
  const nav = useNavigate();
  const toast = useToast();
  const { run, must, pending } = useAction();
  const [confirm, setConfirm] = useState<null | 'close' | 'close-cancel'>(null);
  const setStatus = (status: string, extra: Record<string, unknown> = {}) =>
    run('status', 'room_set_status', { p_token: token, p_room: room.id, p_status: status, ...extra }, `${room.name}: ${status === 'open' ? 'opened' : status === 'break' ? 'on break' : 'closed'}`);
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast('ok', 'Link copied'), () => toast('error', 'Could not copy. Select the link and copy it manually.'));
  return (
    <aside className="sidepanel" aria-label={`${room.name} details`}>
      <div className="sidepanel-head"><h2 className="truncate">{room.name}</h2><RoomStatus status={room.status} /><div className="spacer" /><Button variant="quiet" size="sm" onClick={onClose}>Close</Button></div>
      <div className="sidepanel-body">
        <div className="section">
          <div className="section-title">Now</div>
          {room.live ? (
            <div className="col">
              <div className="row"><Badge tone="info" live>{phaseLabel(room.live)}</Badge><span className="spacer" /><PhaseClock s={room.live} settings={d.settings} size="lg" /></div>
              <div className="strong">{room.live.startup.name}</div>
              <div className="small muted">{room.live.startup.eureka_id} · started by {room.live.started_by}{room.live.is_override ? ` · override: ${room.live.override_reason}` : ''}</div>
            </div>
          ) : <p className="muted small">{roomNow(room)}</p>}
          <Button variant="primary" icon={<DoorOpen size={16} />} onClick={() => nav(`/room/${room.id}`)}>Open room console</Button>
        </div>
        <div className="section">
          <div className="section-title">On deck</div>
          {room.on_deck.length ? <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{room.on_deck.map(s => <li key={s.id}>{s.name} <span className="subtle">#{s.ticket_no}</span></li>)}</ol> : <p className="small muted">Nobody called.</p>}
        </div>
        <div className="section">
          <div className="section-title">Judges</div>
          {room.judges.length ? <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{room.judges.map(j => <li key={j.id}>{j.name} <span className="subtle">({j.status.replace('_', ' ')})</span></li>)}</ul> : <p className="small muted">No judges assigned. <Link to="/judges">Assign judges</Link></p>}
        </div>
        <div className="section">
          <div className="section-title">Room status</div>
          <div className="row wrap">
            {room.status !== 'open' && <Button pending={pending === 'status'} onClick={() => setStatus('open')}>Open</Button>}
            {room.status === 'open' && <Button pending={pending === 'status'} onClick={() => setStatus('break')}>Start break</Button>}
            {room.status !== 'closed' && <Button variant="danger" onClick={() => setConfirm(room.live ? 'close-cancel' : 'close')}>Close room</Button>}
          </div>
          <p className="xsmall subtle">Closing returns this room's on-deck startups to the queue. Other rooms are not affected.</p>
        </div>
        <div className="section">
          <div className="section-title">Screens</div>
          <div className="row"><Button size="sm" icon={<MonitorPlay size={16} />} onClick={() => window.open(displayLink(room.display_code), '_blank')}>Open projector screen</Button><Button size="sm" variant="quiet" icon={<Copy size={16} />} onClick={() => copy(displayLink(room.display_code))}>Copy link</Button></div>
          {d.hall_code && <div className="row"><Button size="sm" icon={<ExternalLink size={16} />} onClick={() => window.open(hallLink(d.hall_code!), '_blank')}>Hall board</Button><Button size="sm" variant="quiet" icon={<Copy size={16} />} onClick={() => copy(hallLink(d.hall_code!))}>Copy link</Button></div>}
        </div>
      </div>
      {confirm && (
        <Confirm
          title={`Close ${room.name}?`}
          danger
          confirmLabel={confirm === 'close-cancel' ? 'Close and cancel pitch' : 'Close room'}
          reason reasonRequired={confirm === 'close-cancel'}
          body={confirm === 'close-cancel'
            ? <>A pitch is running ({room.live?.startup.name}). Closing cancels it and returns the startup to the front of the queue. Usually it is better to let it finish first.</>
            : <>{room.on_deck.length} startup(s) on deck return to the queue and will be called by other rooms.</>}
          onConfirm={reason => must('status', 'room_set_status', { p_token: token, p_room: room.id, p_status: 'closed', p_live_mode: confirm === 'close-cancel' ? 'cancel' : null, p_reason: reason || null }, `${room.name} closed`)}
          onClose={() => setConfirm(null)}
        />
      )}
    </aside>
  );
}
