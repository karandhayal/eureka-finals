import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Copy, Pause, Pencil, Pin, Play, RotateCcw, UserX } from 'lucide-react';
import { rpc } from '../../lib/api';
import { useStaff } from '../../lib/auth';
import { useLive } from '../../lib/live';
import { fmtTime } from '../../lib/clock';
import { startupLink } from '../../lib/links';
import { useIsMobile } from '../../lib/useMedia';
import type { AdminState, Startup } from '../../lib/types';
import { StaffShell } from '../../shell/StaffShell';
import { Button, Callout, Confirm, Dialog, Empty, Field, Input, LoadError, LoadingRows, SearchInput, Select, StartupStatus, Tabs, useAction, useToast } from '../../ui';

type Filter = 'queue' | 'all' | 'absent' | 'done' | 'out';
const IN_QUEUE = ['waiting', 'on_deck', 'hold', 'pitching'];

export default function Queue() {
  const { token } = useStaff();
  const q = useLive(() => rpc<AdminState>('admin_state', { p_token: token }), [token]);
  const mobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>('queue');
  const [text, setText] = useState('');
  const [track, setTrack] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const d = q.data;
  const roomName = (id: number | null) => d?.rooms.find(r => r.id === id)?.name ?? '';

  const rows = useMemo(() => {
    if (!d) return [];
    const t = text.trim().toLowerCase();
    return d.startups.filter(s => {
      if (track && String(s.track_id) !== track) return false;
      if (t && !(s.name.toLowerCase().includes(t) || s.eureka_id.toLowerCase().includes(t) || s.email.toLowerCase().includes(t))) return false;
      if (filter === 'queue') return IN_QUEUE.includes(s.status);
      if (filter === 'absent') return s.status === 'registered';
      if (filter === 'done') return s.status === 'done';
      if (filter === 'out') return s.status === 'no_show' || s.status === 'withdrawn';
      return true;
    });
  }, [d, text, track, filter]);
  const n = (f: (s: Startup) => boolean) => d?.startups.filter(f).length ?? 0;
  const selected = d?.startups.find(s => s.id === sel) ?? null;
  // Position in the live queue (pitching first, then by queue position).
  const queueOrder = useMemo(() => (d?.startups ?? []).filter(s => ['waiting', 'on_deck', 'hold'].includes(s.status)), [d]);

  return (
    <StaffShell title="Queue" updatedAt={q.updatedAt}>
      {!d ? (q.error ? <LoadError error={q.error} retry={q.refresh} /> : <LoadingRows n={10} />) : <>
        <Tabs value={filter} onChange={setFilter} items={[
          { value: 'queue', label: 'In queue', count: n(s => IN_QUEUE.includes(s.status)) },
          { value: 'absent', label: 'Not arrived', count: n(s => s.status === 'registered') },
          { value: 'done', label: 'Done', count: n(s => s.status === 'done') },
          { value: 'out', label: 'No-show and withdrawn', count: n(s => s.status === 'no_show' || s.status === 'withdrawn') },
          { value: 'all', label: 'All', count: d.startups.length },
        ]} />
        <div className="row wrap">
          <div style={{ flex: '1 1 260px', maxWidth: 420 }}><SearchInput value={text} onChange={e => setText(e.target.value)} placeholder="Search name, Eureka! ID or email" aria-label="Search" /></div>
          <Select value={track} onChange={e => setTrack(e.target.value)} aria-label="Filter by track" style={{ width: 200 }}>
            <option value="">All tracks</option>{d.tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <span className="subtle small">{rows.length} shown</span>
        </div>
        <section className="panel">
          {rows.length === 0 ? <Empty title="No startups match">Try another tab, track or search.</Empty> : mobile ? (
            <div className="list">
              {rows.map(s => (
                <button key={s.id} className="list-item" onClick={() => setSel(s.id)}>
                  <span className="num subtle" style={{ width: 28 }}>{s.ticket_no ? `#${s.ticket_no}` : ''}</span>
                  <div className="main"><span className="title truncate">{s.name}</span><span className="meta">{s.eureka_id} · {s.track}{s.on_deck_room_id ? ` · ${roomName(s.on_deck_room_id)}` : ''}</span></div>
                  <StartupStatus status={s.status} />
                </button>
              ))}
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <table className="table">
                <thead><tr><th className="w-0">Pos</th><th className="w-0">Ticket</th><th>Startup</th><th>Track</th><th>Status</th><th>Room</th><th className="r">Skips</th><th>Checked in</th></tr></thead>
                <tbody>
                  {rows.map(s => {
                    const pos = queueOrder.findIndex(x => x.id === s.id);
                    return (
                      <tr key={s.id} className={`clickable ${sel === s.id ? 'is-selected' : ''}`} onClick={() => setSel(s.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setSel(s.id)}>
                        <td className="num subtle">{pos >= 0 ? pos + 1 : ''}</td>
                        <td className="num">{s.ticket_no ? `#${s.ticket_no}` : ''}</td>
                        <td><div className="strong truncate" style={{ maxWidth: 280 }}>{s.name}</div><div className="xsmall subtle">{s.eureka_id}</div></td>
                        <td>{s.track}</td>
                        <td><StartupStatus status={s.status} />{s.pinned_room_id ? <span className="xsmall subtle"> · pinned</span> : null}</td>
                        <td>{roomName(s.on_deck_room_id)}</td>
                        <td className="r num">{s.skip_count || ''}</td>
                        <td className="small">{s.checked_in_at ? fmtTime(s.checked_in_at) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {selected && <StartupPanel s={selected} d={d} queueOrder={queueOrder} onClose={() => setSel(null)} />}
      </>}
    </StaffShell>
  );
}

function StartupPanel({ s, d, queueOrder, onClose }: { s: Startup; d: AdminState; queueOrder: Startup[]; onClose: () => void }) {
  const { token } = useStaff();
  const toast = useToast();
  const { run, must, pending } = useAction();
  const [dlg, setDlg] = useState<null | 'withdraw' | 'edit' | 'pin' | 'position'>(null);
  const idx = queueOrder.findIndex(x => x.id === s.id);
  const movable = ['waiting', 'on_deck', 'hold'].includes(s.status);
  const move = (before: Startup | null, label: string) => run('move', 'queue_move', { p_token: token, p_startup: s.id, p_before: before?.id ?? null, p_reason: label }, `${s.name}: ${label.toLowerCase()}`);
  const roomName = (id: number | null) => d.rooms.find(r => r.id === id)?.name;
  const servingRooms = d.rooms.filter(r => r.track_ids.includes(s.track_id));

  const body = (
    <div className="col-6">
      <div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{s.name}</div>
        <div className="small muted">{s.eureka_id} · {s.email}</div>
      </div>
      <dl className="kv">
        <dt>Status</dt><dd><StartupStatus status={s.status} />{s.on_deck_room_id ? ` ${roomName(s.on_deck_room_id)}` : ''}</dd>
        <dt>Track</dt><dd>{s.track}</dd>
        <dt>Ticket</dt><dd>{s.ticket_no ? `#${s.ticket_no} (original order, never changes)` : 'Not checked in'}</dd>
        {idx >= 0 && <><dt>Queue position</dt><dd className="num">{idx + 1} of {queueOrder.length}</dd></>}
        {s.checked_in_at && <><dt>Checked in</dt><dd>{fmtTime(s.checked_in_at)} by {s.checked_in_by}</dd></>}
        {s.pinned_room_id && <><dt>Pinned to</dt><dd>{roomName(s.pinned_room_id)}</dd></>}
        {s.skip_count > 0 && <><dt>Skipped</dt><dd>{s.skip_count} time(s)</dd></>}
      </dl>
      {movable && (
        <div className="section">
          <div className="section-title">Order</div>
          <div className="row wrap">
            <Button size="sm" icon={<ChevronsUp size={16} />} disabled={idx <= 0} pending={pending === 'move'} onClick={() => move(queueOrder[0], 'Moved to top')}>Top</Button>
            <Button size="sm" icon={<ArrowUp size={16} />} disabled={idx <= 0} onClick={() => move(queueOrder[idx - 1], 'Moved up')}>Up</Button>
            <Button size="sm" icon={<ArrowDown size={16} />} disabled={idx < 0 || idx >= queueOrder.length - 1} onClick={() => move(queueOrder[idx + 2] ?? null, 'Moved down')}>Down</Button>
            <Button size="sm" icon={<ChevronsDown size={16} />} disabled={idx >= queueOrder.length - 1} onClick={() => move(null, 'Moved to end')}>End</Button>
            <Button size="sm" variant="quiet" onClick={() => setDlg('position')}>Move to position…</Button>
          </div>
          <p className="xsmall subtle">Moving changes the live order only. The ticket number keeps the original arrival order.</p>
        </div>
      )}
      <div className="section">
        <div className="section-title">Actions</div>
        <div className="row wrap">
          {(s.status === 'waiting' || s.status === 'on_deck') && <Button size="sm" icon={<Pause size={16} />} pending={pending === 'hold'} onClick={() => run('hold', 'startup_set_hold', { p_token: token, p_startup: s.id, p_hold: true, p_reason: null }, `${s.name} on hold`)}>Put on hold</Button>}
          {s.status === 'hold' && <Button size="sm" icon={<Play size={16} />} pending={pending === 'hold'} onClick={() => run('hold', 'startup_set_hold', { p_token: token, p_startup: s.id, p_hold: false, p_reason: null }, `${s.name} back in queue`)}>Release hold</Button>}
          {movable && <Button size="sm" icon={<Pin size={16} />} onClick={() => setDlg('pin')}>{s.pinned_room_id ? 'Change pinned room' : 'Pin to a room'}</Button>}
          {(s.status === 'no_show' || s.status === 'withdrawn') && <Button size="sm" icon={<RotateCcw size={16} />} pending={pending === 'restore'} onClick={() => run('restore', 'startup_set_active', { p_token: token, p_startup: s.id, p_active: true, p_reason: null }, `${s.name} restored`)}>Restore</Button>}
          <Button size="sm" icon={<Pencil size={16} />} onClick={() => setDlg('edit')}>Edit details</Button>
          <Button size="sm" variant="quiet" icon={<Copy size={16} />} onClick={async () => {
            const links = await rpc<{ eureka_id: string; token: string }[]>('export_data', { p_token: token, p_kind: 'links' });
            const t = links.find(l => l.eureka_id === s.eureka_id)?.token;
            if (t) navigator.clipboard?.writeText(startupLink(t)).then(() => toast('ok', 'Startup link copied'), () => toast('error', 'Could not copy'));
          }}>Copy startup link</Button>
          {!['pitching', 'done', 'withdrawn'].includes(s.status) && <Button size="sm" variant="danger" icon={<UserX size={16} />} onClick={() => setDlg('withdraw')}>Withdraw</Button>}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="sidepanel" aria-label={`${s.name} details`}>
        <div className="sidepanel-head"><h2 className="truncate">Startup</h2><div className="spacer" /><Button variant="quiet" size="sm" onClick={onClose}>Close</Button></div>
        <div className="sidepanel-body">{body}</div>
      </aside>
      {dlg === 'withdraw' && <Confirm title={`Withdraw ${s.name}?`} danger confirmLabel="Withdraw" reason reasonRequired body="They leave the queue and cannot be called. You can restore them later." onConfirm={r => must('w', 'startup_set_active', { p_token: token, p_startup: s.id, p_active: false, p_reason: r }, `${s.name} withdrawn`)} onClose={() => setDlg(null)} />}
      {dlg === 'pin' && <PinDialog s={s} rooms={servingRooms} onClose={() => setDlg(null)} />}
      {dlg === 'edit' && <EditStartup s={s} d={d} onClose={() => setDlg(null)} />}
      {dlg === 'position' && <PositionDialog s={s} order={queueOrder} onClose={() => setDlg(null)} />}
    </>
  );
}

function PositionDialog({ s, order, onClose }: { s: Startup; order: Startup[]; onClose: () => void }) {
  const { token } = useStaff();
  const { must, pending } = useAction();
  const [pos, setPos] = useState('1');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const others = order.filter(x => x.id !== s.id);
  const p = Math.max(1, Math.min(others.length + 1, Number(pos) || 1));
  const go = async () => {
    try { await must('pos', 'queue_move', { p_token: token, p_startup: s.id, p_before: others[p - 1]?.id ?? null, p_reason: reason || `Moved to position ${p}` }, `${s.name} moved to position ${p}`); onClose(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog title={`Move ${s.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" pending={pending === 'pos'} onClick={go}>Move</Button></>}>
      <Field label={`New position (1 to ${others.length + 1})`} required><Input type="number" inputMode="numeric" min={1} max={others.length + 1} value={pos} onChange={e => setPos(e.target.value)} /></Field>
      <p className="small muted">{others[p - 1] ? <>Will sit just before <strong>{others[p - 1].name}</strong>.</> : 'Will go to the end of the queue.'}</p>
      <Field label="Reason"><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional, for the activity log" /></Field>
      {err && <Callout tone="danger">{err}</Callout>}
    </Dialog>
  );
}

function PinDialog({ s, rooms, onClose }: { s: Startup; rooms: AdminState['rooms']; onClose: () => void }) {
  const { token } = useStaff();
  const { must, pending } = useAction();
  const [room, setRoom] = useState(s.pinned_room_id ? String(s.pinned_room_id) : '');
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    try { await must('pin', 'startup_pin', { p_token: token, p_startup: s.id, p_room: room ? Number(room) : null, p_reason: null }, room ? 'Pinned' : 'Pin removed'); onClose(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog title={`Pin ${s.name} to a room`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" pending={pending === 'pin'} onClick={go}>Save</Button></>}>
      <p className="small muted">A pinned startup is only called by that room. Only rooms that serve {s.track} are listed.</p>
      <Field label="Room"><Select value={room} onChange={e => setRoom(e.target.value)}><option value="">Any room (no pin)</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      {err && <Callout tone="danger">{err}</Callout>}
    </Dialog>
  );
}

export function EditStartup({ s, d, onClose }: { s: Startup; d: AdminState; onClose: () => void }) {
  const { token } = useStaff();
  const { must, pending } = useAction();
  const [f, setF] = useState({ eureka_id: s.eureka_id, name: s.name, email: s.email, track_id: String(s.track_id) });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const go = async () => {
    try { await must('edit', 'startup_save', { p_token: token, p_id: s.id, p_eureka_id: f.eureka_id, p_email: f.email, p_name: f.name, p_track_id: Number(f.track_id) }, 'Saved'); onClose(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog title="Edit startup" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" pending={pending === 'edit'} onClick={go}>Save</Button></>}>
      <Field label="Eureka! ID" required><Input value={f.eureka_id} onChange={set('eureka_id')} /></Field>
      <Field label="Startup name" required><Input value={f.name} onChange={set('name')} /></Field>
      <Field label="Email" required><Input type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="Track" required help={s.status === 'on_deck' ? 'Changing track returns them to the queue for the right rooms.' : undefined}>
        <Select value={f.track_id} onChange={set('track_id')}>{d.tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      </Field>
      {err && <Callout tone="danger">{err}</Callout>}
    </Dialog>
  );
}
