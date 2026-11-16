import { useMemo, useRef, useState } from 'react';
import { Copy, Plus, QrCode, RefreshCw, Scale, Upload } from 'lucide-react';
import { rpc } from '../../lib/api';
import { useStaff } from '../../lib/auth';
import { useLive } from '../../lib/live';
import { parseJudgeCsv } from '../../lib/csv';
import { judgeLink } from '../../lib/links';
import { useIsMobile } from '../../lib/useMedia';
import type { AdminState, Judge } from '../../lib/types';
import { StaffShell } from '../../shell/StaffShell';
import { Badge, Button, Callout, Confirm, Dialog, Empty, Field, Input, LoadError, LoadingRows, SearchInput, Select, Seg, useAction, useToast } from '../../ui';
import { QrImage } from '../../ui/qr';

const KIND: Record<string, string> = { jury: 'Jury', mentor: 'Mentor', both: 'Jury and mentor' };
const STATUS: Record<string, [string, 'neutral' | 'ok' | 'warn']> = { not_arrived: ['Not arrived', 'neutral'], arrived: ['Arrived', 'ok'], left: ['Left', 'warn'] };

export default function Judges() {
  const { token } = useStaff();
  const mobile = useIsMobile();
  const judges = useLive(() => rpc<Judge[]>('judges_list', { p_token: token }), [token]);
  const st = useLive(() => rpc<AdminState>('admin_state', { p_token: token }), [token]);
  const { run } = useAction();
  const [text, setText] = useState('');
  const [add, setAdd] = useState(false);
  const [imp, setImp] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const rooms = st.data?.rooms ?? [];
  const list = useMemo(() => (judges.data ?? []).filter(j => !text || j.name.toLowerCase().includes(text.toLowerCase()) || (j.email ?? '').includes(text.toLowerCase())), [judges.data, text]);
  const selected = judges.data?.find(j => j.id === sel) ?? null;
  const update = (j: Judge, patch: Record<string, unknown>, msg: string) => run('u' + j.id, 'judge_update', { p_token: token, p_id: j.id, p_patch: patch }, msg);
  const arrived = (judges.data ?? []).filter(j => j.status === 'arrived').length;

  return (
    <StaffShell title="Judges" updatedAt={judges.updatedAt} actions={<>
      {!mobile && <Button icon={<Upload size={16} />} onClick={() => setImp(true)}>Import CSV</Button>}
      <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdd(true)}>{mobile ? 'Add' : 'Add judge'}</Button>
    </>}>
      {!judges.data ? (judges.error ? <LoadError error={judges.error} retry={judges.refresh} /> : <LoadingRows />) : !judges.data.length ? (
        <div className="panel"><Empty icon={<Scale size={28} />} title="No judges yet" action={<div className="row"><Button variant="primary" onClick={() => setAdd(true)}>Add a judge</Button><Button onClick={() => setImp(true)}>Import CSV</Button></div>}>
          Add each judge, assign their room, and show them their sign-in QR code. They score from their own phone.
        </Empty></div>
      ) : <>
        <div className="row wrap">
          <div style={{ flex: '1 1 240px', maxWidth: 360 }}><SearchInput value={text} onChange={e => setText(e.target.value)} placeholder="Search judges" aria-label="Search judges" /></div>
          <span className="small muted num">{arrived} of {judges.data.length} arrived</span>
        </div>
        <section className="panel">
          {mobile ? (
            <div className="list">
              {list.map(j => (
                <button key={j.id} className="list-item" onClick={() => setSel(j.id)}>
                  <div className="main"><span className="title truncate">{j.name}</span><span className="meta">{KIND[j.kind]} · {rooms.find(r => r.id === j.room_id)?.name ?? 'No room'} · {j.scored} scored</span></div>
                  <Badge tone={STATUS[j.status][1]}>{STATUS[j.status][0]}</Badge>
                </button>
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Type</th><th>Attendance</th><th>Room</th><th className="r">Scored</th><th>Certificate</th><th className="w-0" /></tr></thead>
                <tbody>
                  {list.map(j => (
                    <tr key={j.id}>
                      <td><div className="strong">{j.name}</div><div className="xsmall subtle">{j.email || j.phone || ''}</div></td>
                      <td className="small">{KIND[j.kind]}</td>
                      <td><Select value={j.status} onChange={e => update(j, { status: e.target.value }, `${j.name}: ${STATUS[e.target.value][0].toLowerCase()}`)} aria-label={`${j.name} attendance`} style={{ width: 140, height: 32 }}>
                        <option value="not_arrived">Not arrived</option><option value="arrived">Arrived</option><option value="left">Left</option></Select></td>
                      <td><Select value={j.room_id ?? ''} onChange={e => update(j, { room_id: e.target.value || null }, `${j.name} assigned`)} aria-label={`${j.name} room`} style={{ width: 150, height: 32 }}>
                        <option value="">No room</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></td>
                      <td className="r num">{j.kind === 'mentor' ? <span className="subtle">-</span> : j.scored}</td>
                      <td><label className="checkbox"><input type="checkbox" checked={j.certificate} onChange={e => update(j, { certificate: e.target.checked }, e.target.checked ? 'Certificate marked given' : 'Certificate unmarked')} />Given</label></td>
                      <td><Button size="sm" icon={<QrCode size={16} />} onClick={() => setSel(j.id)}>Sign-in QR</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>}
      {add && <AddJudge onClose={() => setAdd(false)} onAdded={id => { setAdd(false); setSel(id); }} />}
      {imp && <ImportJudges onClose={() => setImp(false)} />}
      {selected && <JudgeSheet j={selected} rooms={rooms} onClose={() => setSel(null)} update={update} />}
    </StaffShell>
  );
}

function JudgeSheet({ j, rooms, onClose, update }: { j: Judge; rooms: AdminState['rooms']; onClose: () => void; update: (j: Judge, p: Record<string, unknown>, m: string) => void }) {
  const { token } = useStaff();
  const toast = useToast();
  const { must } = useAction();
  const [reissue, setReissue] = useState(false);
  const link = judgeLink(j.token);
  return (
    <Dialog title={j.name} onClose={onClose}>
      {j.kind !== 'mentor' ? <>
        <div className="col" style={{ alignItems: 'center', gap: 12 }}>
          <div className="panel" style={{ padding: 12 }}><QrImage value={link} size={220} label={`Sign-in QR code for ${j.name}`} /></div>
          <p className="small muted" style={{ textAlign: 'center' }}>Ask {j.name} to scan this with their phone camera. It opens their score sheet. No password needed.</p>
        </div>
        <div className="row"><Input readOnly value={link} aria-label="Judge link" onFocus={e => e.target.select()} /><Button iconOnly aria-label="Copy link" onClick={() => navigator.clipboard?.writeText(link).then(() => toast('ok', 'Link copied'), () => toast('error', 'Could not copy'))}><Copy size={16} /></Button></div>
      </> : <Callout tone="info">Mentors are tracked for attendance and certificates. They do not score.</Callout>}
      <Field label="Attendance"><Seg label="Attendance" value={j.status} onChange={v => update(j, { status: v }, `${j.name}: ${STATUS[v][0].toLowerCase()}`)} options={[{ value: 'not_arrived', label: 'Not arrived' }, { value: 'arrived', label: 'Arrived' }, { value: 'left', label: 'Left' }]} /></Field>
      <Field label="Room"><Select value={j.room_id ?? ''} onChange={e => update(j, { room_id: e.target.value || null }, `${j.name} assigned`)}><option value="">No room</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      <label className="checkbox"><input type="checkbox" checked={j.certificate} onChange={e => update(j, { certificate: e.target.checked }, 'Saved')} />Certificate given</label>
      {j.kind !== 'mentor' && <Button variant="quiet" size="sm" icon={<RefreshCw size={16} />} onClick={() => setReissue(true)}>Issue a new link (stops the old one)</Button>}
      {reissue && <Confirm title="Issue a new sign-in link?" confirmLabel="Issue new link" body="The old link stops working immediately. Use this if a phone was lost or the link was shared by mistake."
        onConfirm={() => must('re', 'judge_reissue', { p_token: token, p_id: j.id }, 'New link issued')} onClose={() => setReissue(false)} />}
    </Dialog>
  );
}

function AddJudge({ onClose, onAdded }: { onClose: () => void; onAdded: (id: number) => void }) {
  const { token } = useStaff();
  const { must, pending } = useAction();
  const [f, setF] = useState({ name: '', email: '', phone: '', kind: 'jury' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try { const r = await must<{ id: number }>('add', 'judge_save', { p_token: token, p_id: null, p_name: f.name, p_email: f.email, p_phone: f.phone, p_kind: f.kind }, `${f.name} added`); onAdded(r.id); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog title="Add judge" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" pending={pending === 'add'} disabled={!f.name.trim()} onClick={save}>Add judge</Button></>}>
      <Field label="Name" required><Input value={f.name} onChange={set('name')} autoComplete="off" /></Field>
      <div className="form-grid">
        <Field label="Email"><Input type="email" inputMode="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><Input type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
      </div>
      <Field label="Type"><Select value={f.kind} onChange={set('kind')}><option value="jury">Jury (scores)</option><option value="both">Jury and mentor (scores)</option><option value="mentor">Mentor (does not score)</option></Select></Field>
      {err && <Callout tone="danger">{err}</Callout>}
    </Dialog>
  );
}

function ImportJudges({ onClose }: { onClose: () => void }) {
  const { token } = useStaff();
  const { must, pending } = useAction();
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ReturnType<typeof parseJudgeCsv> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const read = async (f: File) => { setErr(null); const r = parseJudgeCsv(await f.text()); if (!r.length) setErr('No rows found. The file needs a "name" column.'); setRows(r); };
  const go = async () => {
    try { await must('imp', 'judges_import', { p_token: token, p_rows: rows }, undefined).then((r: any) => r); onClose(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog title="Import judges from CSV" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" pending={pending === 'imp'} disabled={!rows?.length} onClick={go}>Import {rows?.length ?? ''}</Button></>}>
      <p className="small muted">Columns: <span className="mono">name</span> (required), <span className="mono">email</span>, <span className="mono">phone</span>, <span className="mono">type</span> (jury, mentor or both; default jury). Judges whose email already exists are skipped.</p>
      <input ref={file} type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && read(e.target.files[0])} className="input" style={{ paddingTop: 6 }} />
      {rows && rows.length > 0 && <Callout tone="info">{rows.length} judges found. First: {rows[0].name}{rows[0].email ? ` (${rows[0].email})` : ''}.</Callout>}
      {err && <Callout tone="danger">{err}</Callout>}
    </Dialog>
  );
}
