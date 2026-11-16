import { useEffect, useRef, useState } from 'react';
import { Copy, Download, FileUp, Plus, QrCode, Trash2 } from 'lucide-react';
import { downloadQrBadges } from '../../lib/qrpdf';
import { rpc } from '../../lib/api';
import { useStaff } from '../../lib/auth';
import { refreshAll, useLive } from '../../lib/live';
import { downloadCsv, parseStartupCsv } from '../../lib/csv';
import { hallLink, startupLink } from '../../lib/links';
import type { AdminState, Criterion } from '../../lib/types';
import { StaffShell } from '../../shell/StaffShell';
import { Badge, Button, Callout, Confirm, Dialog, Field, Input, LoadError, LoadingRows, Seg, Select, useAction, useToast } from '../../ui';

const SECTIONS = [['event', 'Event and timing'], ['startups', 'Startups and tracks'], ['rubric', 'Scoring rubric'], ['staff', 'Staff accounts'], ['screens', 'Screens and links'], ['exports', 'Exports'], ['reset', 'Reset']] as const;

export default function Setup() {
  const { token } = useStaff();
  const q = useLive(() => rpc<AdminState>('admin_state', { p_token: token }), [token]);
  const d = q.data;
  return (
    <StaffShell title="Setup" updatedAt={q.updatedAt}>
      {!d ? (q.error ? <LoadError error={q.error} retry={q.refresh} /> : <LoadingRows />) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 180px) minmax(0, 760px)', gap: 32, alignItems: 'start' }} className="setup-grid">
          <nav className="col hide-mobile" style={{ position: 'sticky', top: 80, gap: 2 }} aria-label="Setup sections">
            {SECTIONS.map(([id, label]) => <a key={id} href={`#/setup`} onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="nav-link">{label}</a>)}
          </nav>
          <div className="col-6">
            <EventSection d={d} />
            <StartupsSection d={d} />
            <RubricSection d={d} />
            <StaffSection d={d} />
            <ScreensSection d={d} />
            <ExportsSection />
            <ResetSection />
          </div>
        </div>
      )}
      <style>{`@media (max-width: 767px) { .setup-grid { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </StaffShell>
  );
}

function Section({ id, title, desc, children, action }: { id: string; title: string; desc?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} className="panel" style={{ scrollMarginTop: 72 }}>
      <div className="panel-head"><div className="col" style={{ gap: 2 }}><h2>{title}</h2>{desc && <span className="xsmall subtle">{desc}</span>}</div><div className="spacer" />{action}</div>
      <div className="panel-body col-4">{children}</div>
    </section>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const parseMmss = (v: string) => { const m = v.trim().match(/^(\d+)(?::(\d{1,2}))?$/); return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : NaN; };

function EventSection({ d }: { d: AdminState }) {
  const { token } = useStaff();
  const { must, pending } = useAction();
  const s = d.settings;
  const [f, setF] = useState({ event_name: s.event_name, pitch: mmss(s.pitch_s), qa: mmss(s.qa_s), changeover: mmss(s.changeover_s), on_deck: String(s.on_deck), skip_limit: String(s.skip_limit), overrun: mmss(s.overrun_alert_s) });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const bad = (v: string) => Number.isNaN(parseMmss(v));
  const save = async () => {
    setErr(null);
    try {
      await must('ev', 'settings_save', { p_token: token, p_settings: { event_name: f.event_name, pitch_s: parseMmss(f.pitch), qa_s: parseMmss(f.qa), changeover_s: parseMmss(f.changeover), on_deck: Number(f.on_deck), skip_limit: Number(f.skip_limit), overrun_alert_s: parseMmss(f.overrun) } }, 'Settings saved');
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Section id="event" title="Event and timing" desc="Room clocks, estimates and alerts use these values.">
      <Field label="Event name" required><Input value={f.event_name} onChange={set('event_name')} /></Field>
      <div className="form-grid">
        <Field label="Pitch time" help="Minutes:seconds" error={bad(f.pitch) ? 'Use m:ss' : null}><Input inputMode="numeric" value={f.pitch} onChange={set('pitch')} /></Field>
        <Field label="Q&A time" help="0:00 to skip Q&A" error={bad(f.qa) ? 'Use m:ss' : null}><Input inputMode="numeric" value={f.qa} onChange={set('qa')} /></Field>
        <Field label="Changeover" help="Between startups" error={bad(f.changeover) ? 'Use m:ss' : null}><Input inputMode="numeric" value={f.changeover} onChange={set('changeover')} /></Field>
      </div>
      <div className="form-grid">
        <Field label="Startups called ahead per room" help="How many each room keeps on deck"><Select value={f.on_deck} onChange={set('on_deck')}>{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</Select></Field>
        <Field label="Skips before no-show"><Select value={f.skip_limit} onChange={set('skip_limit')}>{[1, 2, 3].map(n => <option key={n}>{n}</option>)}</Select></Field>
        <Field label="Overrun alert after" help="Time past the limit" error={bad(f.overrun) ? 'Use m:ss' : null}><Input inputMode="numeric" value={f.overrun} onChange={set('overrun')} /></Field>
      </div>
      {err && <Callout tone="danger">{err}</Callout>}
      <div><Button variant="primary" pending={pending === 'ev'} disabled={[f.pitch, f.qa, f.changeover, f.overrun].some(bad)} onClick={save}>Save settings</Button></div>
    </Section>
  );
}

type Preview = { total: number; new: number; updated: number; unchanged: number; rejected: { row: number; eureka_id: string; reason: string }[]; new_tracks: string[] };

function StartupsSection({ d }: { d: AdminState }) {
  const { token } = useStaff();
  const toast = useToast();
  const { must, run, pending } = useAction();
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rename, setRename] = useState<{ id: number; name: string } | null>(null);

  const pick = async (f: File) => {
    setErr(null); setPreview(null); setFileName(f.name);
    const parsed = parseStartupCsv(await f.text());
    if (parsed.missing.length) { setErr(`Missing column(s): ${parsed.missing.join(', ')}. Found: ${parsed.headers.join(', ') || 'none'}.`); setRows(null); return; }
    if (!parsed.rows.length) { setErr('The file has no data rows.'); return; }
    setRows(parsed.rows);
    try { setPreview(await rpc<Preview>('startups_import', { p_token: token, p_req: null, p_rows: parsed.rows, p_commit: false })); }
    catch (e) { setErr((e as Error).message); }
  };
  const commit = async () => {
    try {
      const r = await must<Preview>('imp', 'startups_import', { p_token: token, p_rows: rows, p_commit: true });
      toast('ok', `Imported: ${r.new} new, ${r.updated} updated`);
      setRows(null); setPreview(null); setFileName(''); if (file.current) file.current.value = '';
    } catch (e) { setErr((e as Error).message); }
  };
  const total = d.startups.length;

  return (
    <Section id="startups" title="Startups and tracks" desc="Upload a CSV with Eureka! ID, email, startup_name and track."
      action={<Button size="sm" variant="quiet" icon={<Download size={16} />} onClick={() => downloadCsv('startups-template.csv', [{ 'Eureka! ID': 'EU2610001', email: 'founder@example.com', startup_name: 'Example Labs', track: 'Fintech' }])}>Template</Button>}>
      <div className="row wrap">
        <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" id="csv" onChange={e => e.target.files?.[0] && pick(e.target.files[0])} />
        <label htmlFor="csv" className="btn btn-primary" tabIndex={0} onKeyDown={e => e.key === 'Enter' && file.current?.click()}><FileUp size={16} />{fileName ? 'Choose another file' : 'Upload CSV'}</label>
        {fileName && <span className="small muted truncate">{fileName}</span>}
        <span className="spacer" />
        <span className="small muted num">{total} startups loaded</span>
      </div>
      {err && <Callout tone="danger">{err}</Callout>}
      {preview && (
        <div className="col-3">
          <div className="panel" style={{ display: 'flex', flexWrap: 'wrap' }}>
            {([['Rows', preview.total], ['New', preview.new], ['Updated', preview.updated], ['Unchanged', preview.unchanged], ['Rejected', preview.rejected.length]] as const).map(([k, v]) => (
              <div key={k} style={{ padding: '10px 16px', borderRight: '1px solid var(--border)' }}><div className="xsmall subtle">{k}</div><div className="strong num" style={{ fontSize: 18, color: k === 'Rejected' && v ? 'var(--danger)' : undefined }}>{v}</div></div>
            ))}
          </div>
          {preview.new_tracks.length > 0 && <Callout tone="info" title="New tracks will be created">{preview.new_tracks.join(', ')}</Callout>}
          {preview.rejected.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h2>Rejected rows</h2><div className="spacer" /><Button size="sm" variant="quiet" icon={<Download size={16} />} onClick={() => downloadCsv('rejected-rows.csv', preview.rejected)}>Download</Button></div>
              <div className="table-wrap" style={{ maxHeight: 200 }}><table className="table"><thead><tr><th className="w-0">Row</th><th>Eureka! ID</th><th>Reason</th></tr></thead>
                <tbody>{preview.rejected.map(r => <tr key={r.row}><td className="num">{r.row}</td><td className="mono">{r.eureka_id || '-'}</td><td>{r.reason}</td></tr>)}</tbody></table></div>
            </div>
          )}
          <Callout tone="info">Re-uploading is safe: startups are matched by Eureka! ID, only name, email and track are updated, and nothing is deleted. Attendance and pitch history are never touched.</Callout>
          <div className="row"><Button variant="primary" pending={pending === 'imp'} disabled={!preview.new && !preview.updated} onClick={commit}>Import {preview.new + preview.updated} startups</Button><Button onClick={() => { setPreview(null); setRows(null); setFileName(''); }}>Cancel</Button></div>
        </div>
      )}
      {d.tracks.length > 0 && (
        <div className="panel">
          <div className="table-wrap"><table className="table"><thead><tr><th>Track</th><th className="r">Startups</th><th>Rooms</th><th className="w-0" /></tr></thead>
            <tbody>{d.tracks.map(t => {
              const n = Object.values(t.counts ?? {}).reduce((a, b) => a + b, 0);
              const rooms = d.rooms.filter(r => r.track_ids.includes(t.id)).map(r => r.name);
              return <tr key={t.id}><td className="strong">{t.name}</td><td className="r num">{n}</td><td className="small">{rooms.length ? rooms.join(', ') : <span style={{ color: 'var(--warn)' }}>None</span>}</td>
                <td><div className="row"><Button size="sm" variant="quiet" onClick={() => setRename({ id: t.id, name: t.name })}>Rename</Button>{n === 0 && <Button size="sm" variant="quiet" iconOnly aria-label={`Delete ${t.name}`} onClick={() => run('td', 'track_delete', { p_token: token, p_id: t.id }, 'Track deleted')}><Trash2 size={16} /></Button>}</div></td></tr>;
            })}</tbody></table></div>
        </div>
      )}
      {rename && <Dialog title="Rename track" onClose={() => setRename(null)} footer={<><Button onClick={() => setRename(null)}>Cancel</Button><Button variant="primary" onClick={() => run('tr', 'track_save', { p_token: token, p_id: rename.id, p_name: rename.name }, 'Track renamed').then(() => setRename(null))}>Save</Button></>}>
        <Field label="Track name" required><Input value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })} /></Field>
      </Dialog>}
    </Section>
  );
}

function RubricSection({ d }: { d: AdminState }) {
  const { token } = useStaff();
  const { must, pending } = useAction();
  const [items, setItems] = useState<Partial<Criterion>[]>(() => d.criteria.length ? d.criteria : [{ name: 'Problem', max_score: 10, weight: 1 }, { name: 'Solution', max_score: 10, weight: 1 }, { name: 'Market', max_score: 10, weight: 1 }, { name: 'Team', max_score: 10, weight: 1 }, { name: 'Presentation', max_score: 10, weight: 1 }]);
  const [force, setForce] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (d.criteria.length) setItems(d.criteria); }, [JSON.stringify(d.criteria)]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (i: number, k: keyof Criterion, v: string) => setItems(xs => xs.map((x, j) => j === i ? { ...x, [k]: k === 'name' ? v : v === '' ? '' : Number(v) } : x));
  const save = async (f = false) => {
    setErr(null);
    try { await must('rub', 'criteria_save', { p_token: token, p_items: items, p_force: f }, 'Rubric saved'); }
    catch (e) { const m = (e as Error).message; if (/already scored/.test(m)) setForce(true); else setErr(m); }
  };
  const totalW = items.reduce((a, x) => a + Number(x.weight || 0), 0);
  return (
    <Section id="rubric" title="Scoring rubric" desc="Each judge's total is a weighted score out of 100." action={!d.criteria.length && <Badge tone="warn">Not saved yet</Badge>}>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Criterion</th><th style={{ width: 110 }}>Max score</th><th style={{ width: 110 }}>Weight</th><th className="r" style={{ width: 80 }}>Share</th><th className="w-0" /></tr></thead>
        <tbody>{items.map((c, i) => (
          <tr key={i}>
            <td><Input aria-label="Criterion name" value={c.name ?? ''} onChange={e => upd(i, 'name', e.target.value)} /></td>
            <td><Input aria-label="Max score" type="number" inputMode="numeric" min={1} max={100} value={c.max_score ?? ''} onChange={e => upd(i, 'max_score', e.target.value)} /></td>
            <td><Input aria-label="Weight" type="number" inputMode="decimal" min={0.1} step={0.5} value={c.weight ?? ''} onChange={e => upd(i, 'weight', e.target.value)} /></td>
            <td className="r num small">{totalW ? Math.round((Number(c.weight || 0) / totalW) * 100) : 0}%</td>
            <td><Button size="sm" variant="quiet" iconOnly aria-label="Remove criterion" disabled={items.length <= 1} onClick={() => setItems(xs => xs.filter((_, j) => j !== i))}><Trash2 size={16} /></Button></td>
          </tr>))}
        </tbody></table></div>
      <div className="row"><Button size="sm" icon={<Plus size={16} />} onClick={() => setItems(xs => [...xs, { name: '', max_score: 10, weight: 1 }])}>Add criterion</Button><span className="spacer" /><Button variant="primary" pending={pending === 'rub'} disabled={items.some(x => !x.name || !x.max_score || !x.weight)} onClick={() => save()}>Save rubric</Button></div>
      {err && <Callout tone="danger">{err}</Callout>}
      {force && <Confirm title="Judges have already scored" confirmLabel="Change rubric" danger body="Existing totals will be recalculated with the new weights. Scores for removed criteria are ignored. This is logged." onConfirm={() => must('rub', 'criteria_save', { p_token: token, p_items: items, p_force: true }, 'Rubric saved')} onClose={() => setForce(false)} />}
    </Section>
  );
}

type StaffRow = { id: number; name: string; email: string; role: 'admin' | 'coordinator'; duty: string | null; room_id: number | null; active: boolean };
function StaffSection({ d }: { d: AdminState }) {
  const { token } = useStaff();
  const q = useLive(() => rpc<StaffRow[]>('staff_list', { p_token: token }), [token]);
  const [edit, setEdit] = useState<StaffRow | 'new' | null>(null);
  const room = (id: number | null) => d.rooms.find(r => r.id === id)?.name;
  return (
    <Section id="staff" title="Staff accounts" desc="Admins control everything. Coordinators run the desk, a room, and judges." action={<Button size="sm" icon={<Plus size={16} />} onClick={() => setEdit('new')}>Add account</Button>}>
      {!q.data ? <LoadingRows n={3} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Name</th><th>Role</th><th>Post</th><th>Status</th><th className="w-0" /></tr></thead>
          <tbody>{q.data.map(s => (
            <tr key={s.id}>
              <td><div className="strong">{s.name}</div><div className="xsmall subtle">{s.email}</div></td>
              <td>{s.role === 'admin' ? 'Admin' : 'Coordinator'}</td>
              <td className="small">{s.duty === 'desk' ? 'Registration desk' : s.duty === 'room' ? room(s.room_id) ?? 'Room' : s.role === 'admin' ? 'Everywhere' : 'Not set'}</td>
              <td>{s.active ? <Badge tone="ok">Active</Badge> : <Badge>Disabled</Badge>}</td>
              <td><Button size="sm" variant="quiet" onClick={() => setEdit(s)}>Edit</Button></td>
            </tr>))}
          </tbody></table></div>
      )}
      {edit && <StaffEditor s={edit === 'new' ? null : edit} d={d} onClose={() => setEdit(null)} />}
    </Section>
  );
}

function StaffEditor({ s, d, onClose }: { s: StaffRow | null; d: AdminState; onClose: () => void }) {
  const { token } = useStaff();
  const { must, pending } = useAction();
  const [f, setF] = useState({ name: s?.name ?? '', email: s?.email ?? '', role: s?.role ?? 'coordinator', duty: s?.duty ?? 'desk', room_id: s?.room_id ? String(s.room_id) : '', active: s?.active ?? true, password: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try { await must('st', 'staff_save', { p_token: token, p_id: s?.id ?? null, p_name: f.name, p_email: f.email, p_role: f.role, p_duty: f.role === 'admin' ? null : f.duty, p_room_id: f.duty === 'room' && f.room_id ? Number(f.room_id) : null, p_active: f.active, p_password: f.password || null }, s ? 'Account saved' : 'Account created'); onClose(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Dialog title={s ? `Edit ${s.name}` : 'Add staff account'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" pending={pending === 'st'} onClick={save} disabled={!f.name || !f.email || (!s && f.password.length < 8)}>Save</Button></>}>
      <Field label="Name" required><Input value={f.name} onChange={set('name')} /></Field>
      <Field label="Email" required help="Used to sign in."><Input type="email" inputMode="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="Role"><Select value={f.role} onChange={set('role')}><option value="coordinator">Coordinator</option><option value="admin">Admin</option></Select></Field>
      {f.role === 'coordinator' && <div className="form-grid">
        <Field label="Starting post" help="They can switch later."><Select value={f.duty} onChange={set('duty')}><option value="desk">Registration desk</option><option value="room">A room</option><option value="floor">Floor (judges)</option></Select></Field>
        {f.duty === 'room' && <Field label="Room"><Select value={f.room_id} onChange={set('room_id')}><option value="">Choose</option>{d.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>}
      </div>}
      <Field label={s ? 'New password' : 'Password'} required={!s} help={s ? 'Leave blank to keep the current password.' : 'At least 8 characters. Share it with them in person.'}><Input type="text" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
      {s && <label className="checkbox"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} />Account active (unticking signs them out everywhere)</label>}
      {err && <Callout tone="danger">{err}</Callout>}
    </Dialog>
  );
}

function ScreensSection({ d }: { d: AdminState }) {
  const toast = useToast();
  const copy = (t: string, what: string) => navigator.clipboard?.writeText(t).then(() => toast('ok', `${what} copied`), () => toast('error', 'Could not copy'));
  return (
    <Section id="screens" title="Screens and links" desc="Open these on TVs and projectors. They need no sign-in and show no private data.">
      {d.hall_code && <div className="row"><span className="strong" style={{ width: 160 }}>Hall board</span><Input readOnly value={hallLink(d.hall_code)} onFocus={e => e.target.select()} aria-label="Hall board link" /><Button iconOnly aria-label="Copy hall board link" onClick={() => copy(hallLink(d.hall_code!), 'Hall board link')}><Copy size={16} /></Button></div>}
      <p className="small muted">Each room's projector link is on the Rooms page. Startups reach their own page from the sign-in screen with their Eureka! ID and email, or from a personal link in the startup links export below. Example: <span className="mono">{startupLink('…')}</span></p>
    </Section>
  );
}

function ExportsSection() {
  const { token } = useStaff();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const exp = async (kind: string, file: string) => {
    setBusy(kind);
    try {
      let rows = await rpc<Record<string, unknown>[]>('export_data', { p_token: token, p_kind: kind });
      if (kind === 'links') rows = rows.map((r: any) => ({ eureka_id: r.eureka_id, startup_name: r.startup_name, email: r.email, link: startupLink(r.token) }));
      if (kind === 'judges') rows = rows.map((r: any) => { const { token: t, ...rest } = r; return { ...rest, link: `${location.origin}${location.pathname}#/j/${t}` }; });
      if (!rows.length) toast('info', 'Nothing to export yet'); else downloadCsv(file, rows);
    } catch (e) { toast('error', (e as Error).message); } finally { setBusy(null); }
  };
  const [badges, setBadges] = useState(false);
  const items: [string, string, string][] = [['attendance', 'Attendance', 'Check-in time, ticket, status'], ['pitches', 'Pitch log', 'Actual order, rooms, timings, overrides'], ['scores', 'Scores', 'Every judge score'], ['links', 'Startup links', 'Personal page link for each startup, to mail out'], ['judges', 'Judges', 'Attendance, rooms, certificates, sign-in links'], ['log', 'Activity log', 'Every action, with who and why']];
  return (
    <Section id="exports" title="Exports" desc="CSV files, plus printable QR badges. Export regularly during the event as a backup.">
      <div className="list panel">
        <div className="list-item"><QrCode size={18} className="subtle" /><div className="main"><span className="title">QR badges (PDF)</span><span className="meta">Printable check-in QR code for every startup, 12 per A4 page or one per page</span></div><Button size="sm" icon={<Download size={16} />} onClick={() => setBadges(true)}>Download</Button></div>
        {items.map(([k, label, desc]) => (
        <div key={k} className="list-item"><Download size={18} className="subtle" /><div className="main"><span className="title">{label}</span><span className="meta">{desc}</span></div><Button size="sm" icon={<Download size={16} />} pending={busy === k} onClick={() => exp(k, `${k}.csv`)}>Download</Button></div>
      ))}</div>
      {badges && <BadgesDialog onClose={() => setBadges(false)} />}
    </Section>
  );
}

function BadgesDialog({ onClose }: { onClose: () => void }) {
  const { token } = useStaff();
  const toast = useToast();
  const [rows, setRows] = useState<{ eureka_id: string; startup_name: string; track: string; status: string; checked_in_at: string | null }[] | null>(null);
  const [eventName, setEventName] = useState('Eureka! Finals');
  const [layout, setLayout] = useState<'sheet' | 'single'>('sheet');
  const [track, setTrack] = useState('');
  const [who, setWho] = useState<'all' | 'not_arrived'>('all');
  const [sort, setSort] = useState<'id' | 'name' | 'track'>('id');
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => {
    rpc<any[]>('export_data', { p_token: token, p_kind: 'attendance' }).then(setRows).catch(e => toast('error', (e as Error).message));
    rpc<{ event_name: string }>('setup_status').then(r => setEventName(r.event_name)).catch(() => {});
  }, [token, toast]);
  const tracks = Array.from(new Set((rows ?? []).map(r => r.track))).sort();
  const chosen = (rows ?? [])
    .filter(r => r.status !== 'withdrawn' && (!track || r.track === track) && (who === 'all' || !r.checked_in_at))
    .sort((a, b) => sort === 'name' ? a.startup_name.localeCompare(b.startup_name) : sort === 'track' ? a.track.localeCompare(b.track) || a.eureka_id.localeCompare(b.eureka_id) : a.eureka_id.localeCompare(b.eureka_id));
  const pages = layout === 'single' ? chosen.length : Math.ceil(chosen.length / 12);
  const go = async () => {
    setProgress(0);
    try {
      const n = await downloadQrBadges(chosen, { layout, eventName, title: `${eventName} QR badges${track ? ' ' + track : ''}`, onProgress: setProgress });
      toast('ok', `PDF with ${n} badges downloaded`);
      onClose();
    } catch (e) { toast('error', 'Could not create the PDF: ' + (e as Error).message); setProgress(null); }
  };
  return (
    <Dialog title="Download QR badges" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" icon={<Download size={16} />} pending={progress !== null} disabled={!chosen.length} onClick={go}>
        {progress !== null ? `Creating ${progress} of ${chosen.length}…` : `Download PDF (${chosen.length})`}</Button></>}>
      {!rows ? <LoadingRows n={3} /> : <>
        <Field label="Layout"><Seg label="Layout" value={layout} onChange={setLayout} options={[{ value: 'sheet', label: '12 per page, to cut' }, { value: 'single', label: 'One per page' }]} /></Field>
        <div className="form-grid">
          <Field label="Track"><Select value={track} onChange={e => setTrack(e.target.value)}><option value="">All tracks</option>{tracks.map(t => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Startups"><Select value={who} onChange={e => setWho(e.target.value as any)}><option value="all">Everyone</option><option value="not_arrived">Not checked in yet</option></Select></Field>
          <Field label="Order"><Select value={sort} onChange={e => setSort(e.target.value as any)}><option value="id">Eureka! ID</option><option value="name">Startup name</option><option value="track">Track, then ID</option></Select></Field>
        </div>
        <p className="small muted">{chosen.length} badges on {pages} A4 page{pages === 1 ? '' : 's'}. The registration desk scans these codes to check startups in. Withdrawn startups are left out.</p>
      </>}
    </Dialog>
  );
}

function ResetSection() {
  const { token } = useStaff();
  const toast = useToast();
  const [scope, setScope] = useState<null | 'floor' | 'all'>(null);
  return (
    <Section id="reset" title="Reset" desc="Use after a rehearsal, before the real event.">
      <div className="row wrap">
        <Button variant="danger" onClick={() => setScope('floor')}>Clear the day's activity</Button>
        <Button variant="danger" onClick={() => setScope('all')}>Remove everything</Button>
      </div>
      <p className="small muted">Clearing the day keeps startups, rooms, judges and the rubric, and removes check-ins, pitches, scores and the log. Removing everything also deletes startups, judges, rooms and tracks. Staff accounts and settings always stay.</p>
      {scope && <Confirm title={scope === 'floor' ? "Clear the day's activity?" : 'Remove everything?'} danger typeToConfirm="RESET" confirmLabel="Reset"
        body="This cannot be undone. Export anything you need first."
        onConfirm={() => rpc('event_reset', { p_token: token, p_confirm: 'RESET', p_scope: scope }).then(() => { refreshAll(); toast('ok', 'Event reset'); })}
        onClose={() => setScope(null)} />}
    </Section>
  );
}
