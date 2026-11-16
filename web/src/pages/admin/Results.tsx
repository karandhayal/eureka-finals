import { useMemo, useState } from 'react';
import { Download, Lock, Trophy, Unlock } from 'lucide-react';
import { rpc } from '../../lib/api';
import { useStaff } from '../../lib/auth';
import { useLive } from '../../lib/live';
import { downloadCsv } from '../../lib/csv';
import { useIsMobile } from '../../lib/useMedia';
import type { Criterion } from '../../lib/types';
import { StaffShell } from '../../shell/StaffShell';
import { Badge, Button, Confirm, Dialog, Empty, LoadError, LoadingRows, Select, StartupStatus, Tabs, useAction } from '../../ui';

type Row = { startup_id: number; name: string; eureka_id: string; track_id: number; status: string; raw: number | null; normalised: number | null; n: number; spread: number; recused: number; judges: { judge: string; total: number; vals: Record<string, number>; comment: string | null }[] };
type Res = { criteria: Criterion[]; tracks: { id: number; name: string; locked: boolean }[]; rows: Row[] };

export default function Results() {
  const { token } = useStaff();
  const mobile = useIsMobile();
  const q = useLive(() => rpc<Res>('results', { p_token: token }), [token]);
  const [track, setTrack] = useState<string>('');
  const [by, setBy] = useState<'raw' | 'normalised'>('raw');
  const [open, setOpen] = useState<Row | null>(null);
  const [lock, setLock] = useState<null | { id: number; name: string; locked: boolean }>(null);
  const { must } = useAction();
  const d = q.data;
  const tid = track || String(d?.tracks[0]?.id ?? '');
  const t = d?.tracks.find(x => String(x.id) === tid);
  const rows = useMemo(() => (d?.rows ?? []).filter(r => String(r.track_id) === tid).sort((a, b) => Number(b[by] ?? -1) - Number(a[by] ?? -1)), [d, tid, by]);

  const exportTrack = () => downloadCsv(`results-${t?.name ?? 'track'}.csv`, rows.map((r, i) => ({ rank: r.n ? i + 1 : '', eureka_id: r.eureka_id, startup: r.name, raw_average: r.raw, normalised: r.normalised, judges: r.n, spread: r.spread })));

  return (
    <StaffShell title="Results" updatedAt={q.updatedAt} actions={t && <>
      <Button icon={<Download size={16} />} onClick={exportTrack} disabled={!rows.length}>{mobile ? '' : 'Export'}</Button>
      <Button icon={t.locked ? <Unlock size={16} /> : <Lock size={16} />} onClick={() => setLock(t)}>{t.locked ? 'Unlock' : 'Lock results'}</Button>
    </>}>
      {!d ? (q.error ? <LoadError error={q.error} retry={q.refresh} /> : <LoadingRows />) : !d.tracks.length ? <div className="panel"><Empty icon={<Trophy size={28} />} title="No tracks yet" /></div> : <>
        {mobile ? <Select value={tid} onChange={e => setTrack(e.target.value)} aria-label="Track">{d.tracks.map(x => <option key={x.id} value={x.id}>{x.name}{x.locked ? ' (locked)' : ''}</option>)}</Select>
          : <Tabs value={tid} onChange={setTrack} items={d.tracks.map(x => ({ value: String(x.id), label: x.name + (x.locked ? ' (locked)' : ''), count: d.rows.filter(r => r.track_id === x.id && r.n > 0).length }))} />}
        <div className="row wrap">
          <span className="small muted">Rank by</span>
          <Select value={by} onChange={e => setBy(e.target.value as any)} style={{ width: 220 }} aria-label="Rank by">
            <option value="raw">Raw average (official)</option><option value="normalised">Normalised by judge</option>
          </Select>
          <span className="xsmall subtle" style={{ maxWidth: 520 }}>Normalised rescales each judge by their own average and spread, so a strict panel in one room does not sink its startups. Shown for comparison.</span>
        </div>
        <section className="panel">
          {!rows.length ? <Empty title="No scores in this track yet">Results appear as judges submit scores.</Empty> : mobile ? (
            <div className="list">{rows.map((r, i) => (
              <button key={r.startup_id} className="list-item" onClick={() => setOpen(r)}>
                <span className="num strong" style={{ width: 24 }}>{r.n ? i + 1 : ''}</span>
                <div className="main"><span className="title truncate">{r.name}</span><span className="meta">{r.n} judge(s){r.n < 2 ? ' · needs review' : ''}</span></div>
                <span className="num strong">{r[by] ?? '-'}</span>
              </button>))}
            </div>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th className="w-0">Rank</th><th>Startup</th><th>Status</th><th className="r">Raw avg</th><th className="r">Normalised</th><th className="r">Judges</th><th className="r">Spread</th><th>Flags</th></tr></thead>
              <tbody>{rows.map((r, i) => {
                const tie = i > 0 && rows[i - 1][by] === r[by] && r[by] != null;
                return (
                  <tr key={r.startup_id} className="clickable" onClick={() => setOpen(r)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpen(r)}>
                    <td className="num strong">{r.n ? i + 1 : ''}</td>
                    <td><div className="strong">{r.name}</div><div className="xsmall subtle">{r.eureka_id}</div></td>
                    <td><StartupStatus status={r.status} /></td>
                    <td className={`r num ${by === 'raw' ? 'strong' : ''}`}>{r.raw ?? '-'}</td>
                    <td className={`r num ${by === 'normalised' ? 'strong' : ''}`}>{r.normalised ?? '-'}</td>
                    <td className="r num">{r.n}</td>
                    <td className="r num">{r.spread}</td>
                    <td className="row">{r.n < 2 && <Badge tone="warn" plain>Fewer than 2 judges</Badge>}{tie && <Badge tone="warn" plain>Tie</Badge>}{r.recused > 0 && <Badge plain>{r.recused} recused</Badge>}</td>
                  </tr>);
              })}</tbody>
            </table></div>
          )}
        </section>
      </>}
      {open && d && (
        <Dialog title={open.name} onClose={() => setOpen(null)} wide>
          <p className="small muted">{open.eureka_id} · raw {open.raw ?? '-'} · normalised {open.normalised ?? '-'}</p>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Judge</th>{d.criteria.map(c => <th key={c.id} className="r">{c.name}</th>)}<th className="r">Total</th></tr></thead>
            <tbody>{open.judges.map(j => (
              <tr key={j.judge}><td>{j.judge}{j.comment && <div className="xsmall subtle">{j.comment}</div>}</td>{d.criteria.map(c => <td key={c.id} className="r num">{j.vals[c.id] ?? '-'}</td>)}<td className="r num strong">{j.total}</td></tr>
            ))}</tbody>
          </table></div>
        </Dialog>
      )}
      {lock && <Confirm title={`${lock.locked ? 'Unlock' : 'Lock'} results for ${lock.name}?`} confirmLabel={lock.locked ? 'Unlock' : 'Lock results'} danger={!lock.locked}
        body={lock.locked ? 'Judges will be able to change their scores again.' : 'After locking, no judge can submit or change a score in this track.'}
        onConfirm={() => must('lock', 'results_lock', { p_token: token, p_track: lock.id, p_lock: !lock.locked }, lock.locked ? 'Unlocked' : 'Results locked')} onClose={() => setLock(null)} />}
    </StaffShell>
  );
}
