import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { rpc } from '../../lib/api';
import { useStaff } from '../../lib/auth';
import { useLive } from '../../lib/live';
import { actionLabel } from '../../lib/actions';
import { downloadCsv } from '../../lib/csv';
import { useIsMobile } from '../../lib/useMedia';
import type { LogEntry } from '../../lib/types';
import { StaffShell } from '../../shell/StaffShell';
import { Button, Empty, LoadError, LoadingRows, SearchInput, Seg } from '../../ui';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function Activity() {
  const { token } = useStaff();
  const mobile = useIsMobile();
  const [text, setText] = useState('');
  const [deb, setDeb] = useState('');
  const [kind, setKind] = useState<'all' | 'overrides' | 'pitch' | 'checkin' | 'queue' | 'room'>('all');
  useEffect(() => { const t = setTimeout(() => setDeb(text), 250); return () => clearTimeout(t); }, [text]);
  const filter = { q: deb || undefined, ...(kind === 'overrides' ? { overrides: true } : kind !== 'all' ? { action: kind } : {}) };
  const q = useLive(() => rpc<LogEntry[]>('activity_list', { p_token: token, p_filter: filter }), [token, deb, kind]);

  return (
    <StaffShell title="Activity log" updatedAt={q.updatedAt} actions={<Button icon={<Download size={16} />} onClick={async () => downloadCsv('activity-log.csv', await rpc('export_data', { p_token: token, p_kind: 'log' }))}>{mobile ? '' : 'Export all'}</Button>}>
      <div className="row wrap">
        <div style={{ flex: '1 1 240px', maxWidth: 360 }}><SearchInput value={text} onChange={e => setText(e.target.value)} placeholder="Search person, startup or reason" aria-label="Search log" /></div>
        <Seg label="Filter" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'overrides', label: 'Overrides' }, { value: 'pitch', label: 'Pitching' }, { value: 'checkin', label: 'Check-in' }, { value: 'queue', label: 'Queue' }, { value: 'room', label: 'Rooms' }]} />
      </div>
      <section className="panel">
        {!q.data ? (q.error ? <LoadError error={q.error} retry={q.refresh} /> : <LoadingRows n={8} />) : !q.data.length ? <Empty title="Nothing logged for this filter" /> : mobile ? (
          <div className="list">{q.data.map(l => (
            <div key={l.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <div className="main"><span className="small"><strong>{actionLabel(l.action)}</strong>{l.startup ? ` · ${l.startup}` : ''}{l.room ? ` · ${l.room}` : ''}</span>
                <span className="meta">{time(l.at)} · {l.actor}{l.reason ? ` · "${l.reason}"` : ''}</span></div>
            </div>))}
          </div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 200px)' }}>
            <table className="table">
              <thead><tr><th className="w-0">Time</th><th>Action</th><th>Startup</th><th>Room</th><th>By</th><th>Reason</th></tr></thead>
              <tbody>{q.data.map(l => (
                <tr key={l.id}>
                  <td className="num small">{time(l.at)}</td>
                  <td className="strong small">{actionLabel(l.action)}</td>
                  <td className="small">{l.startup ? <>{l.startup} <span className="subtle">{l.eureka_id}</span></> : l.judge ?? ''}</td>
                  <td className="small">{l.room ?? ''}</td>
                  <td className="small">{l.actor} <span className="subtle">({l.actor_role})</span></td>
                  <td className="small muted">{l.reason ?? ''}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </StaffShell>
  );
}
