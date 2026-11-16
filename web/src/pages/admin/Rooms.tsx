import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, DoorOpen, MonitorPlay, Plus } from 'lucide-react';
import { rpc } from '../../lib/api';
import { useStaff } from '../../lib/auth';
import { useLive } from '../../lib/live';
import { displayLink } from '../../lib/links';
import { useIsMobile } from '../../lib/useMedia';
import type { AdminState, Room } from '../../lib/types';
import { StaffShell } from '../../shell/StaffShell';
import { Button, Callout, Confirm, Dialog, Empty, Field, Input, LoadError, LoadingRows, RoomStatus, useAction, useToast } from '../../ui';

export default function Rooms() {
  const { token } = useStaff();
  const q = useLive(() => rpc<AdminState>('admin_state', { p_token: token }), [token]);
  const mobile = useIsMobile();
  const nav = useNavigate();
  const toast = useToast();
  const { run, must, pending } = useAction();
  const [edit, setEdit] = useState<Room | 'new' | null>(null);
  const [closing, setClosing] = useState<Room | null>(null);
  const d = q.data;
  const copy = (r: Room) => navigator.clipboard?.writeText(displayLink(r.display_code)).then(() => toast('ok', `${r.name} screen link copied`), () => toast('error', 'Could not copy'));
  const status = (r: Room, s: string) => run('st' + r.id, 'room_set_status', { p_token: token, p_room: r.id, p_status: s }, `${r.name}: ${s === 'open' ? 'opened' : s === 'break' ? 'on break' : 'closed'}`);

  return (
    <StaffShell title="Rooms" updatedAt={q.updatedAt} actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit('new')}>{mobile ? 'Add' : 'Add room'}</Button>}>
      {!d ? (q.error ? <LoadError error={q.error} retry={q.refresh} /> : <LoadingRows />) : !d.rooms.length ? (
        <div className="panel"><Empty icon={<DoorOpen size={28} />} title="No rooms yet" action={<Button variant="primary" onClick={() => setEdit('new')}>Add the first room</Button>}>{d.tracks.length ? 'Each room serves one or more tracks and calls startups from the shared queue.' : 'Import startups first so their tracks exist, then add rooms.'}</Empty></div>
      ) : <>
        <TrackCoverage d={d} />
        <section className="panel">
          {mobile ? (
            <div className="list">
              {d.rooms.map(r => (
                <div key={r.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                  <div className="main"><div className="row"><span className="title">{r.name}</span><RoomStatus status={r.status} /></div><span className="meta">{r.tracks.join(', ') || 'No track'}</span></div>
                  <div className="row" style={{ width: '100%' }}>
                    <Button size="sm" onClick={() => setEdit(r)}>Edit</Button>
                    {r.status !== 'open' ? <Button size="sm" pending={pending === 'st' + r.id} onClick={() => status(r, 'open')}>Open</Button> : <Button size="sm" pending={pending === 'st' + r.id} onClick={() => status(r, 'break')}>Break</Button>}
                    {r.status !== 'closed' && <Button size="sm" variant="danger" onClick={() => setClosing(r)}>Close</Button>}
                    <span className="spacer" />
                    <Button size="sm" variant="quiet" iconOnly aria-label="Copy screen link" onClick={() => copy(r)}><Copy size={16} /></Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Room</th><th>Tracks</th><th>Status</th><th className="r">Done</th><th>Judges</th><th className="w-0" /></tr></thead>
              <tbody>
                {d.rooms.map(r => (
                  <tr key={r.id}>
                    <td className="strong">{r.name}</td>
                    <td className="small">{r.tracks.join(', ') || <span style={{ color: 'var(--warn)' }}>No track</span>}</td>
                    <td><RoomStatus status={r.status} /></td>
                    <td className="r num">{r.done_count}</td>
                    <td className="small">{r.judges.filter(j => j.status === 'arrived').length} present{r.judges.length ? ` of ${r.judges.length}` : ''}</td>
                    <td>
                      <div className="row">
                        <Button size="sm" onClick={() => nav(`/room/${r.id}`)}>Console</Button>
                        <Button size="sm" onClick={() => setEdit(r)}>Edit</Button>
                        {r.status !== 'open' && <Button size="sm" pending={pending === 'st' + r.id} onClick={() => status(r, 'open')}>Open</Button>}
                        {r.status === 'open' && <Button size="sm" pending={pending === 'st' + r.id} onClick={() => status(r, 'break')}>Break</Button>}
                        {r.status !== 'closed' && <Button size="sm" variant="danger" onClick={() => setClosing(r)}>Close</Button>}
                        <Button size="sm" variant="quiet" iconOnly aria-label={`Open ${r.name} projector screen`} title="Projector screen" onClick={() => window.open(displayLink(r.display_code), '_blank')}><MonitorPlay size={16} /></Button>
                        <Button size="sm" variant="quiet" iconOnly aria-label={`Copy ${r.name} screen link`} title="Copy screen link" onClick={() => copy(r)}><Copy size={16} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      </>}
      {edit && d && <RoomEditor room={edit === 'new' ? null : edit} d={d} onClose={() => setEdit(null)} />}
      {closing && <Confirm title={`Close ${closing.name}?`} danger confirmLabel={closing.live ? 'Close and cancel pitch' : 'Close room'} reason reasonRequired={!!closing.live}
        body={closing.live ? `${closing.live.startup.name} is pitching. Closing cancels that pitch and returns them to the front of the queue.` : 'Startups on deck here return to the queue and will be called by other rooms.'}
        onConfirm={reason => must('close', 'room_set_status', { p_token: token, p_room: closing.id, p_status: 'closed', p_live_mode: closing.live ? 'cancel' : null, p_reason: reason || null }, `${closing.name} closed`)}
        onClose={() => setClosing(null)} />}
    </StaffShell>
  );
}

function TrackCoverage({ d }: { d: AdminState }) {
  const uncovered = d.tracks.filter(t => !d.rooms.some(r => r.status === 'open' && r.track_ids.includes(t.id)));
  if (!uncovered.length) return null;
  return <Callout tone="warn" title="Tracks with no open room">{uncovered.map(t => t.name).join(', ')}. Startups in these tracks will wait until a room serves them.</Callout>;
}

function RoomEditor({ room, d, onClose }: { room: Room | null; d: AdminState; onClose: () => void }) {
  const { token } = useStaff();
  const { must, pending } = useAction();
  const [name, setName] = useState(room?.name ?? `Room ${d.rooms.length + 1}`);
  const [tracks, setTracks] = useState<number[]>(room?.track_ids ?? []);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const toggle = (id: number) => setTracks(t => t.includes(id) ? t.filter(x => x !== id) : [...t, id]);
  const save = async () => {
    try { await must('save', 'room_save', { p_token: token, p_id: room?.id ?? null, p_name: name, p_track_ids: tracks }, room ? 'Room saved' : `${name} added`); onClose(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog title={room ? `Edit ${room.name}` : 'Add room'} onClose={onClose} footer={<>
      {room && <Button variant="danger" onClick={() => setDel(true)} style={{ marginRight: 'auto' }}>Delete</Button>}
      <Button onClick={onClose}>Cancel</Button><Button variant="primary" pending={pending === 'save'} disabled={!name.trim()} onClick={save}>Save</Button></>}>
      <Field label="Room name" required><Input value={name} onChange={e => setName(e.target.value)} /></Field>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label" style={{ marginBottom: 6 }}>Tracks this room serves</legend>
        {d.tracks.length ? <div className="form-grid" style={{ gap: 8 }}>{d.tracks.map(t => <label key={t.id} className="checkbox"><input type="checkbox" checked={tracks.includes(t.id)} onChange={() => toggle(t.id)} />{t.name}</label>)}</div>
          : <p className="small muted">No tracks yet. They are created when you import startups.</p>}
        <span className="field-help">On-deck startups whose track you remove go back to the queue.</span>
      </fieldset>
      {err && <Callout tone="danger">{err}</Callout>}
      {del && room && <Confirm title={`Delete ${room.name}?`} danger confirmLabel="Delete room" body="Only rooms with no pitch history can be deleted. Otherwise close the room instead."
        onConfirm={() => must('del', 'room_delete', { p_token: token, p_room: room.id }, 'Room deleted').then(onClose)} onClose={() => setDel(false)} />}
    </Dialog>
  );
}
