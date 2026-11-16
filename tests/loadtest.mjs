// 200+ simulated users running a compressed live event: 170 startups, 10 rooms, 4 desks, 3 admins, 30 judges.
// Usage: API=<url> ANON=<key> ADMIN_EMAIL=.. ADMIN_PASSWORD=.. node loadtest.mjs [minutes] [label]
// It wipes the event (startups, rooms, judges) at the start: run it on a staging copy, never on the live event.
import { rpc as rawRpc, req, makeStartups, ROOM_MAP } from './lib.mjs';
import fs from 'fs';

const MIN = Number(process.argv[2] || 3);
const LABEL = process.argv[3] || 'run';
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@test.local', password: process.env.ADMIN_PASSWORD || 'admin-pass-123' };
const PITCH_S = 20, QA_S = 10; // compressed so one run covers many full cycles

const stats = new Map(); // fn -> { n, err, lat: [] }
const errors = new Map();
async function rpc(fn, args) {
  const t0 = performance.now();
  const s = stats.get(fn) ?? stats.set(fn, { n: 0, biz: 0, err: 0, lat: [] }).get(fn);
  try { const r = await rawRpc(fn, args); s.lat.push(performance.now() - t0); s.n++; return r; }
  catch (e) {
    s.lat.push(performance.now() - t0); s.n++;
    // Business refusals (STALE, ROOM_BUSY...) are correct answers to conflicting actions, not failures.
    if (e.status === 400) s.biz++; else { s.err++; const k = `${fn}: ${e.message}`.slice(0, 120); errors.set(k, (errors.get(k) ?? 0) + 1); }
    throw e;
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (ms, f = 0.3) => ms * (1 - f + Math.random() * 2 * f);
let running = true;
const invariantViolations = [];
const propagation = [];

// ---------- setup ----------
const T = (await rpc('staff_login', { p_email: ADMIN.email, p_password: ADMIN.password })).token;
await rpc('event_reset', { p_token: T, p_confirm: 'RESET', p_scope: 'all' });
await rpc('settings_save', { p_token: T, p_req: req(), p_settings: { pitch_s: 30, qa_s: QA_S, changeover_s: 5, on_deck: 2 } });
await rpc('startups_import', { p_token: T, p_req: req(), p_rows: makeStartups(170), p_commit: true });
await rpc('criteria_save', { p_token: T, p_req: req(), p_force: true, p_items: [{ name: 'Problem', max_score: 10, weight: 1 }, { name: 'Solution', max_score: 10, weight: 1 }, { name: 'Team', max_score: 10, weight: 1 }] });
let st = await rpc('admin_state', { p_token: T });
const tracks = Object.fromEntries(st.tracks.map(t => [t.name, t.id]));
for (let i = 0; i < ROOM_MAP.length; i++) await rpc('room_save', { p_token: T, p_req: req(), p_id: null, p_name: `Room ${i + 1}`, p_track_ids: ROOM_MAP[i].map(n => tracks[n]) });
st = await rpc('admin_state', { p_token: T });
const rooms = st.rooms;
const links = await rpc('export_data', { p_token: T, p_kind: 'links' });
const startupIds = st.startups.map(s => s.id);
const judgeTokens = [];
for (let i = 0; i < 30; i++) {
  const j = await rpc('judge_save', { p_token: T, p_req: req(), p_id: null, p_name: `Judge ${i + 1}`, p_email: `j${i}@x.co`, p_phone: '', p_kind: 'jury' });
  await rpc('judge_update', { p_token: T, p_req: req(), p_id: j.id, p_patch: { status: 'arrived', room_id: rooms[i % rooms.length].id } });
}
for (const j of await rpc('judges_list', { p_token: T })) judgeTokens.push(j.token);
const crit = await rpc('criteria_list', {});
for (const s of stats.values()) { s.lat = []; s.n = 0; s.err = 0; s.biz = 0; }
console.log(`setup done: ${startupIds.length} startups, ${rooms.length} rooms, ${judgeTokens.length} judges; running ${MIN} min`);

// ---------- virtual users ----------
const t0 = Date.now();
const phase = () => { const m = (Date.now() - t0) / 60000; return m < MIN * 0.5 ? 'normal' : m < MIN * 0.65 ? 'spike' : 'peak'; };

async function seqWatcher(onChange) { // what every staff screen does without push: poll the change counter
  let seen = -1;
  while (running) {
    try { const p = await rpc('poll', {}); if (p.seq !== seen) { if (seen !== -1) await onChange(p.seq); seen = p.seq; } } catch {}
    await sleep(jitter(phase() === 'normal' ? 3000 : 1500));
  }
}

async function startupUser(token) { // phone on the startup page
  await sleep(Math.random() * 15000);
  while (running) { try { await rpc('startup_me', { p_stoken: token }); } catch {} await sleep(jitter(15000, 0.15)); }
}

async function deskUser(k) { // checks in a startup every few seconds; sometimes scans twice
  const mine = startupIds.filter((_, i) => i % 4 === k);
  for (const id of mine) {
    if (!running) return;
    try {
      await rpc('startup_search', { p_token: T, p_q: 'EU26' + String(10001 + startupIds.indexOf(id)) });
      await rpc('checkin', { p_token: T, p_req: req(), p_startup: id });
      if (Math.random() < 0.1) await rpc('checkin', { p_token: T, p_req: req(), p_startup: id }); // duplicate scan
    } catch {}
    await sleep(jitter(phase() === 'spike' ? 400 : 2500));
  }
}

async function roomUser(room) { // the room coordinator: start, end pitch, finish; sometimes skip, override, cancel
  let state = null;
  const refresh = async () => { try { state = await rpc('room_state', { p_token: T, p_room: room.id }); } catch {} };
  const seenProbe = new Set();
  seqWatcher(async seq => {
    const now = Date.now();
    for (const pr of probes) if (seq >= pr.seq && !seenProbe.has(pr.seq)) { seenProbe.add(pr.seq); propagation.push(now - pr.at); }
    await refresh();
  });
  while (running) {
    await refresh();
    const r = state?.room;
    try {
      if (r?.live) {
        const el = (Date.now() - Date.parse(r.live.phase_started_at)) / 1000;
        if (r.live.status === 'pitch' && el > PITCH_S) await rpc('pitch_advance', { p_token: T, p_req: req(), p_session: r.live.id, p_phase: 'pitch' });
        else if (r.live.status === 'qa' && el > QA_S) {
          // two devices tapping the same button at once, sometimes
          const calls = [rpc('pitch_advance', { p_token: T, p_req: req(), p_session: r.live.id, p_phase: 'qa' })];
          if (Math.random() < 0.15) calls.push(rpc('pitch_advance', { p_token: T, p_req: req(), p_session: r.live.id, p_phase: 'qa' }));
          await Promise.allSettled(calls);
        } else if (Math.random() < 0.01) await rpc('pitch_cancel', { p_token: T, p_req: req(), p_session: r.live.id, p_restart: true, p_reason: 'load test restart' });
      } else if (r?.status === 'open' && r.on_deck.length) {
        const x = Math.random();
        if (x < 0.06) await rpc('startup_skip', { p_token: T, p_req: req(), p_room: room.id, p_startup: r.on_deck[0].id, p_reason: 'not here' });
        else if (x < 0.12 && r.on_deck[1]) await rpc('pitch_start', { p_token: T, p_req: req(), p_room: room.id, p_startup: r.on_deck[1].id, p_reason: 'override: first not present' });
        else {
          // a retry after a dropped connection: same request id sent twice
          const id = req();
          const a = rpc('pitch_start', { p_token: T, p_req: id, p_room: room.id, p_startup: r.on_deck[0].id, p_expected_version: r.on_deck[0].version });
          if (Math.random() < 0.1) await Promise.allSettled([a, rpc('pitch_start', { p_token: T, p_req: id, p_room: room.id, p_startup: r.on_deck[0].id, p_expected_version: r.on_deck[0].version })]);
          else await a;
        }
      }
    } catch {}
    await sleep(jitter(2000));
  }
}

async function adminUser(k) { // dashboards plus disruptive changes
  seqWatcher(async () => { try { await rpc('admin_state', { p_token: T }); } catch {} });
  while (running) {
    await sleep(jitter(phase() === 'peak' ? 4000 : 9000));
    try {
      const s = await rpc('admin_state', { p_token: T });
      const q = s.startups.filter(x => ['waiting', 'on_deck'].includes(x.status));
      const x = Math.random();
      if (q.length > 3 && x < 0.4) await rpc('queue_move', { p_token: T, p_req: req(), p_startup: q.at(-1).id, p_before: q[1].id, p_reason: 'load test' });
      else if (q.length && x < 0.55) { const h = q[Math.floor(Math.random() * q.length)]; await rpc('startup_set_hold', { p_token: T, p_req: req(), p_startup: h.id, p_hold: true, p_reason: 'lt' }); await sleep(3000); await rpc('startup_set_hold', { p_token: T, p_req: req(), p_startup: h.id, p_hold: false, p_reason: 'lt' }); }
      else if (x < 0.65 && k === 0) { const r = rooms[Math.floor(Math.random() * rooms.length)]; await rpc('room_set_status', { p_token: T, p_req: req(), p_room: r.id, p_status: 'break' }); await sleep(5000); await rpc('room_set_status', { p_token: T, p_req: req(), p_room: r.id, p_status: 'open' }); }
      else if (x < 0.7 && k === 1) { const r = rooms[Math.floor(Math.random() * rooms.length)]; await rpc('room_set_status', { p_token: T, p_req: req(), p_room: r.id, p_status: 'closed', p_live_mode: 'cancel', p_reason: 'load test' }); await sleep(6000); await rpc('room_set_status', { p_token: T, p_req: req(), p_room: r.id, p_status: 'open' }); }
      else if (x < 0.8) { for (const s2 of s.startups.filter(y => y.status === 'no_show').slice(0, 2)) await rpc('startup_set_active', { p_token: T, p_req: req(), p_startup: s2.id, p_active: true, p_reason: 'arrived late' }); }
    } catch {}
  }
}

async function judgeUser(tok) { // follows their room; scores each finished pitch
  const scored = new Set();
  const look = async () => {
    try {
      const me = await rpc('judge_me', { p_jtoken: tok });
      for (const it of me.items.filter(i => !i.score && !scored.has(i.startup_id)).slice(0, 2)) {
        scored.add(it.startup_id);
        const vals = Object.fromEntries(crit.map(c => [c.id, 1 + Math.floor(Math.random() * 10)]));
        await rpc('score_submit', { p_jtoken: tok, p_req: req(), p_startup: it.startup_id, p_vals: vals, p_comment: '', p_recused: false }).catch(() => scored.delete(it.startup_id));
      }
    } catch {}
  };
  seqWatcher(look);
  while (running) { await sleep(jitter(20000)); await look(); }
}

async function spikeRefresh() { // everyone hits refresh at the same moment, then the desk receives a rush
  while (running && phase() !== 'spike') await sleep(500);
  if (!running) return;
  const t = Date.now();
  await Promise.allSettled([
    ...links.map(l => rpc('startup_me', { p_stoken: l.token })),
    ...rooms.map(r => rpc('room_state', { p_token: T, p_room: r.id })),
    ...judgeTokens.map(j => rpc('judge_me', { p_jtoken: j })),
    ...[0, 1, 2].map(() => rpc('admin_state', { p_token: T })),
  ]);
  console.log(`spike: ${links.length + rooms.length + judgeTokens.length + 3} simultaneous refreshes answered in ${Date.now() - t} ms`);
}

async function invariantChecker() {
  while (running) {
    await sleep(5000);
    try { const v = await rawRpc('test_invariants', {}); if (v.length) invariantViolations.push({ at: Math.round((Date.now() - t0) / 1000), v }); } catch {}
  }
}
// Probe: an admin change at a known moment; each room screen records when it first sees it.
const probes = [];
async function prober() {
  while (running) {
    await sleep(10000);
    try {
      await rawRpc('settings_save', { p_token: T, p_req: req(), p_settings: { overrun_alert_s: 60 } });
      const at = Date.now();
      const p = await rawRpc('poll', {});
      probes.push({ seq: p.seq, at });
    } catch {}
  }
}

const vus = [
  ...links.map(l => startupUser(l.token)),
  ...[0, 1, 2, 3].map(deskUser),
  ...rooms.map(roomUser),
  ...[0, 1, 2].map(adminUser),
  ...judgeTokens.map(judgeUser),
  spikeRefresh(), invariantChecker(), prober(),
];
console.log(`virtual users: ${links.length} startups + 4 desks + ${rooms.length} rooms + 3 admins + ${judgeTokens.length} judges = ${links.length + 4 + rooms.length + 3 + judgeTokens.length}`);
const tick = setInterval(() => {
  const n = [...stats.values()].reduce((a, s) => a + s.n, 0);
  console.log(`  ${Math.round((Date.now() - t0) / 1000)}s [${phase()}] requests=${n} rps=${(n / ((Date.now() - t0) / 1000)).toFixed(1)}`);
}, 30000);
await sleep(MIN * 60000);
running = false;
clearInterval(tick);
await sleep(4000);

// ---------- report ----------
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const all = [...stats.values()].flatMap(s => s.lat);
const total = [...stats.values()].reduce((a, s) => a + s.n, 0);
const errs = [...stats.values()].reduce((a, s) => a + s.err, 0);
const dur = (Date.now() - t0 - 4000) / 1000;
const final = await rawRpc('admin_state', { p_token: T });
const finalInv = await rawRpc('test_invariants', {});
const report = {
  label: LABEL, minutes: MIN, virtual_users: links.length + 4 + rooms.length + 3 + judgeTokens.length,
  requests: total, rps: +(total / dur).toFixed(1), server_errors: errs, error_rate_pct: +(100 * errs / Math.max(total, 1)).toFixed(3),
  latency_ms: { p50: +pct(all, 50).toFixed(1), p95: +pct(all, 95).toFixed(1), p99: +pct(all, 99).toFixed(1), max: +Math.max(...all).toFixed(1) },
  by_function: Object.fromEntries([...stats.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, s]) => [k, { n: s.n, refused_by_rules: s.biz, errors: s.err, p50: +pct(s.lat, 50).toFixed(1), p95: +pct(s.lat, 95).toFixed(1), p99: +pct(s.lat, 99).toFixed(1) }])),
  change_to_screen_ms: { p50: pct(propagation, 50), p95: pct(propagation, 95), note: 'admin change committed -> each room screen has refetched; screens poll every 1.5-3 s here (no push in this test)' },
  event_outcome: final.counts, invariant_violations_during_run: invariantViolations, invariant_violations_at_end: finalInv,
  error_samples: Object.fromEntries([...errors.entries()].slice(0, 10)),
};
fs.writeFileSync(`/home/claude/pd/tests/load-${LABEL}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, by_function: undefined }, null, 2));
process.exit(0);
