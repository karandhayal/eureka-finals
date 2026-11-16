import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, DoorOpen } from 'lucide-react';
import { rpc } from '../../lib/api';
import { useStaff } from '../../lib/auth';
import { useLive } from '../../lib/live';
import type { AdminState } from '../../lib/types';
import { StaffShell } from '../../shell/StaffShell';
import { LoadError, LoadingRows, RoomStatus, useAction } from '../../ui';

/** Where a coordinator chooses what they are doing: the desk, or one room. */
export default function Duty() {
  const { token, isAdmin, setMe } = useStaff();
  const nav = useNavigate();
  const { run } = useAction();
  const q = useLive(() => rpc<AdminState>('admin_state', { p_token: token }), [token]);
  const pick = async (duty: 'desk' | 'room', roomId?: number) => {
    if (!isAdmin) {
      const m = await run<any>('duty', 'staff_set_duty', { p_token: token, p_duty: duty, p_room_id: roomId ?? null });
      if (!m) return;
      setMe(m);
    }
    nav(duty === 'desk' ? '/desk' : `/room/${roomId}`);
  };
  return (
    <StaffShell title="Choose your post" narrow>
      <p className="muted">Pick where you are working. You can switch at any time from the top of the screen.</p>
      {!q.data ? (q.error ? <LoadError error={q.error} retry={q.refresh} /> : <LoadingRows />) : (
        <div className="panel list">
          <button className="list-item" onClick={() => pick('desk')}><ClipboardCheck size={20} /><div className="main"><span className="title">Registration desk</span><span className="meta">Check startups in as they arrive</span></div></button>
          {q.data.rooms.map(r => (
            <button key={r.id} className="list-item" onClick={() => pick('room', r.id)} disabled={r.status === 'closed'}>
              <DoorOpen size={20} />
              <div className="main"><span className="title">{r.name}</span><span className="meta">{r.tracks.join(', ') || 'No track yet'}</span></div>
              <RoomStatus status={r.status} />
            </button>
          ))}
        </div>
      )}
    </StaffShell>
  );
}
