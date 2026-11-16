import { asset } from '../../lib/asset';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, Clock, CloudOff, Lock } from 'lucide-react';
import { ApiError, newRequestId, rpc } from '../../lib/api';
import { useLive } from '../../lib/live';
import { fmtTime } from '../../lib/clock';
import { store } from '../../lib/session';
import type { Criterion } from '../../lib/types';
import { Badge, Button, Callout, Connection, Empty, LoadError, LoadingRows, OfflineBanner, Tabs, Textarea, useToast } from '../../ui';

type Item = { startup_id: number; name: string; eureka_id: string; track: string; track_locked: boolean; room: string; pitched_at: string; live: boolean;
  score: { vals: Record<string, number>; comment: string | null; recused: boolean; total: number | null; updated_at: string } | null };
type Me = { judge: { id: number; name: string; kind: string; status: string }; room: { id: number; name: string; status: string } | null;
  current: { session: any; startup: { id: number; name: string; eureka_id: string; track: string } } | null; criteria: Criterion[]; can_score: boolean; items: Item[] };
type Outbox = Record<string, { req: string; startup: number; vals: Record<string, number>; comment: string; recused: boolean }>;

export default function JudgeSheet() {
  const { token = '' } = useParams();
  const toast = useToast();
  const q = useLive(() => rpc<Me>('judge_me', { p_jtoken: token }), [token]);
  const [open, setOpen] = useState<number | null>(null);
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const outKey = `pd.outbox.${token}`;
  const [outbox, setOutbox] = useState<Outbox>(() => { try { return JSON.parse(store.get(outKey) || '{}'); } catch { return {}; } });
  const saveOutbox = (o: Outbox) => { setOutbox(o); store.set(outKey, JSON.stringify(o)); };

  // Scores that could not be sent are retried with the same request id, so they are never counted twice.
  const flush = useCallback(async () => {
    const o: Outbox = JSON.parse(store.get(outKey) || '{}');
    for (const [k, v] of Object.entries(o)) {
      try {
        await rpc('score_submit', { p_jtoken: token, p_req: v.req, p_startup: v.startup, p_vals: v.vals, p_comment: v.comment, p_recused: v.recused }, { retries: 0 });
        delete o[k]; toast('ok', 'Saved score sent');
      } catch (e) { if (e instanceof ApiError && e.code !== 'NETWORK') { delete o[k]; toast('error', e.message); } }
    }
    saveOutbox({ ...o }); q.refresh();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const i = setInterval(() => { if (Object.keys(JSON.parse(store.get(outKey) || '{}')).length) flush(); }, 10000);
    window.addEventListener('online', flush);
    return () => { clearInterval(i); window.removeEventListener('online', flush); };
  }, [flush, outKey]);

  const d = q.data;
  const pending = useMemo(() => (d?.items ?? []).filter(i => !i.score && !outbox[i.startup_id]), [d, outbox]);
  const done = useMemo(() => (d?.items ?? []).filter(i => i.score || outbox[i.startup_id]), [d, outbox]);
  // Open the live pitch's sheet automatically when nothing else is open.
  const liveItem = d?.items.find(i => i.live && !i.score && !outbox[i.startup_id]);
  useEffect(() => { if (open === null && liveItem) setOpen(liveItem.startup_id); }, [liveItem?.startup_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = d?.items.find(i => i.startup_id === open) ?? null;

  if (!d) return <div className="solo">{q.error ? <div className="solo-body"><LoadError error={q.error} retry={q.refresh} /></div> : <div className="solo-body"><LoadingRows /></div>}</div>;

  if (item && d.can_score) return (
    <ScoreForm key={item.startup_id} item={item} criteria={d.criteria} token={token}
      queued={outbox[item.startup_id]}
      onQueued={v => saveOutbox({ ...outbox, [item.startup_id]: v })}
      onBack={() => setOpen(null)} onDone={() => { setOpen(null); q.refresh(); }} />
  );

  return (
    <div className="solo">
      <OfflineBanner />
      <header className="solo-head"><img src={asset('ecell-mark.png')} alt="E-Cell" style={{ height: 22, width: 'auto' }} /><div className="col" style={{ gap: 0, minWidth: 0 }}><strong className="truncate">{d.judge.name}</strong><span className="xsmall subtle">{d.room ? d.room.name : 'No room assigned yet'}</span></div><div className="spacer" /><Connection updatedAt={q.updatedAt} /></header>
      <main className="solo-body">
        {!d.can_score && <Callout tone="info" title="You are registered as a mentor">Mentors do not score. Thank you for being here.</Callout>}
        {d.can_score && !d.criteria.length && <Callout tone="warn">The organisers have not set the scoring rubric yet.</Callout>}
        {!d.room && <Callout tone="warn" title="No room yet">A coordinator will assign your room. This page updates by itself.</Callout>}
        {Object.keys(outbox).length > 0 && <Callout tone="warn" title={`${Object.keys(outbox).length} score(s) waiting to send`}>They are saved on this phone and will send when the connection returns. <Button size="sm" onClick={flush}>Send now</Button></Callout>}
        {d.current ? (
          <section className="panel panel-body col">
            <div className="row"><Badge tone="info" live>Now pitching</Badge><span className="xsmall subtle">{d.room?.name}</span></div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{d.current.startup.name}</div>
            <div className="small muted">{d.current.startup.eureka_id} · {d.current.startup.track}</div>
            {d.can_score && <Button variant="primary" block size="lg" onClick={() => setOpen(d.current!.startup.id)}>{done.some(x => x.startup_id === d.current!.startup.id) ? 'Edit my score' : 'Score this startup'}</Button>}
          </section>
        ) : d.room && <section className="panel panel-body row"><Clock size={18} className="subtle" /><span className="small muted">No pitch running in {d.room.name}. The next one will appear here.</span></section>}
        {d.can_score && <>
          <Tabs value={tab} onChange={setTab} items={[{ value: 'pending', label: 'To score', count: pending.length }, { value: 'done', label: 'Submitted', count: done.length }]} />
          <section className="panel list">
            {(tab === 'pending' ? pending : done).length === 0
              ? <Empty title={tab === 'pending' ? 'Nothing to score' : 'No scores yet'}>{tab === 'pending' ? 'Startups appear here once they pitch in your room.' : ''}</Empty>
              : (tab === 'pending' ? pending : done).map(i => (
                <button key={i.startup_id} className="list-item" onClick={() => setOpen(i.startup_id)} disabled={i.track_locked && tab === 'done'}>
                  <div className="main"><span className="title truncate">{i.name}</span><span className="meta">{i.room} · {fmtTime(i.pitched_at)}{i.live ? ' · pitching now' : ''}</span></div>
                  {outbox[i.startup_id] ? <Badge tone="warn"><CloudOff size={12} /> Not sent</Badge>
                    : i.track_locked ? <Badge plain><Lock size={12} /> Locked</Badge>
                    : i.score ? (i.score.recused ? <Badge plain>Recused</Badge> : <span className="num strong">{i.score.total}</span>)
                    : <Badge tone="info" plain>Score</Badge>}
                </button>))}
          </section>
        </>}
      </main>
    </div>
  );
}

function ScoreForm({ item, criteria, token, queued, onQueued, onBack, onDone }: {
  item: Item; criteria: Criterion[]; token: string; queued?: Outbox[string]; onQueued: (v: Outbox[string]) => void; onBack: () => void; onDone: () => void }) {
  const toast = useToast();
  const draftKey = `pd.draft.${token}.${item.startup_id}`;
  const initial = queued ?? (() => { try { return JSON.parse(store.get(draftKey) || 'null'); } catch { return null; } })() ?? { vals: item.score?.vals ?? {}, comment: item.score?.comment ?? '', recused: item.score?.recused ?? false };
  const [vals, setVals] = useState<Record<string, number>>(initial.vals);
  const [comment, setComment] = useState<string>(initial.comment ?? '');
  const [recused, setRecused] = useState<boolean>(initial.recused);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [req] = useState(() => queued?.req ?? newRequestId());
  useEffect(() => { store.set(draftKey, JSON.stringify({ vals, comment, recused })); }, [vals, comment, recused, draftKey]);
  const complete = recused || criteria.every(c => vals[c.id] != null);
  const totalW = criteria.reduce((a, c) => a + Number(c.weight), 0);
  const total = criteria.every(c => vals[c.id] != null) ? Math.round(100 * criteria.reduce((a, c) => a + Number(c.weight) * vals[c.id] / c.max_score, 0) / totalW * 100) / 100 : null;
  const locked = item.track_locked;

  const submit = async () => {
    setPending(true); setErr(null);
    const payload = { req, startup: item.startup_id, vals, comment, recused };
    try {
      await rpc('score_submit', { p_jtoken: token, p_req: req, p_startup: item.startup_id, p_vals: vals, p_comment: comment, p_recused: recused });
      store.del(draftKey);
      toast('ok', item.score ? 'Score updated' : 'Score submitted');
      if (navigator.vibrate) navigator.vibrate(50);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NETWORK') { onQueued(payload); toast('info', 'No connection. Score saved on this phone and will send automatically.'); onBack(); }
      else setErr((e as Error).message);
    } finally { setPending(false); }
  };

  return (
    <div className="solo">
      <OfflineBanner />
      <header className="solo-head">
        <Button variant="quiet" size="sm" icon={<ChevronLeft size={18} />} onClick={onBack}>Back</Button>
        <div className="spacer" />
        {item.live && <Badge tone="info" live>Pitching now</Badge>}
      </header>
      <main className="solo-body">
        <div>
          <h1>{item.name}</h1>
          <p className="small muted">{item.eureka_id} · {item.track} · {item.room}</p>
        </div>
        {locked && <Callout tone="warn" title="Results are locked for this track">Scores can no longer change.</Callout>}
        {item.score && !locked && <Callout tone="ok">You scored this startup at {fmtTime(item.score.updated_at)}. Changes replace your earlier score.</Callout>}
        <fieldset disabled={locked || recused} style={{ border: 0, padding: 0, margin: 0 }} className="col-6">
          {criteria.map(c => (
            <div key={c.id} className="col" role="group" aria-labelledby={`c${c.id}`}>
              <div className="row"><span id={`c${c.id}`} className="strong">{c.name}</span><span className="spacer" /><span className="small muted num">{vals[c.id] != null ? `${vals[c.id]} / ${c.max_score}` : `out of ${c.max_score}`}</span></div>
              {c.description && <span className="xsmall subtle">{c.description}</span>}
              {c.max_score <= 10 ? (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(c.max_score, 5)}, 1fr)`, gap: 6 }}>
                  {Array.from({ length: c.max_score }, (_, i) => i + 1).map(n => (
                    <button key={n} type="button" className={`btn ${vals[c.id] === n ? 'btn-primary' : ''}`} style={{ height: 44, padding: 0 }} aria-pressed={vals[c.id] === n} onClick={() => setVals({ ...vals, [c.id]: n })}>{n}</button>
                  ))}
                </div>
              ) : (
                <input className="input" type="number" inputMode="numeric" min={0} max={c.max_score} value={vals[c.id] ?? ''} onChange={e => setVals({ ...vals, [c.id]: Math.max(0, Math.min(c.max_score, Number(e.target.value))) })} aria-label={c.name} />
              )}
            </div>
          ))}
        </fieldset>
        <div className="field"><label className="field-label" htmlFor="cm">Comment (optional)</label><Textarea id="cm" value={comment} onChange={e => setComment(e.target.value)} disabled={locked} maxLength={1000} placeholder="Private to the organisers" /></div>
        <label className="checkbox"><input type="checkbox" checked={recused} disabled={locked} onChange={e => setRecused(e.target.checked)} />I have a conflict of interest and will not score this startup</label>
        {err && <Callout tone="danger">{err}</Callout>}
      </main>
      <div className="sticky-foot">
        <div className="row" style={{ maxWidth: 560, margin: '0 auto' }}>
          <div className="col" style={{ gap: 0 }}><span className="xsmall subtle">Total</span><span className="num strong" style={{ fontSize: 20 }}>{recused ? '-' : total ?? '--'}<span className="small muted"> / 100</span></span></div>
          <div className="spacer" />
          <Button variant="primary" size="lg" icon={<CheckCircle2 size={18} />} pending={pending} disabled={!complete || locked} onClick={submit}>{recused ? 'Submit recusal' : item.score ? 'Update score' : 'Submit score'}</Button>
        </div>
      </div>
    </div>
  );
}
