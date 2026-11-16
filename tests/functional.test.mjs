// End-to-end API tests: every workflow and every exception path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpc, req, expectErr, TRACKS, ROOM_MAP, makeStartups } from './lib.mjs';

const ADMIN = { name: 'Test Admin', email: `admin@test.local`, password: 'admin-pass-123' };
let T; // admin token
let C; // coordinator token (room 1)
let D; // coordinator token (desk)
let rooms, tracks, st;
const inv = async () => { const v = await rpc('test_invariants'); assert.deepEqual(v, [], 'invariants: ' + JSON.stringify(v)); };
const state = () => rpc('admin_state', { p_token: T });
const byEid = (s, eid) => s.startups.find(x => x.eureka_id === eid);
const roomBy = (s, name) => s.rooms.find(r => r.name === name);

test('setup: first admin, sign-in, wrong password, second setup refused', async () => {
  const st0 = await rpc('setup_status');
  if (st0.needs_admin) await rpc('setup_first_admin', { p_name: ADMIN.name, p_email: ADMIN.email, p_password: ADMIN.password });
  await expectErr(rpc('setup_first_admin', { p_name: 'x', p_email: 'x@y.z', p_password: '12345678' }), 'EXISTS');
  await expectErr(rpc('staff_login', { p_email: ADMIN.email, p_password: 'wrong' }), 'AUTH');
  const r = await rpc('staff_login', { p_email: ADMIN.email.toUpperCase(), p_password: ADMIN.password });
  T = r.token; assert.equal(r.me.role, 'admin');
  await rpc('event_reset', { p_token: T, p_confirm: 'RESET', p_scope: 'all' });
  await expectErr(rpc('event_reset', { p_token: T, p_confirm: 'reset', p_scope: 'all' }), 'INVALID');
});

test('CSV import: preview, rejects, commit, safe re-import', async () => {
  const rows = makeStartups(170);
  const bad = [
    { eureka_id: '', email: 'a@b.co', startup_name: 'No id', track: 'Fintech' },
    { eureka_id: 'EU26X1', email: 'not-an-email', startup_name: 'Bad mail', track: 'Fintech' },
    { ...rows[0], startup_name: 'Duplicate of first' },
  ];
  const prev = await rpc('startups_import', { p_token: T, p_req: req(), p_rows: [...rows, ...bad], p_commit: false });
  assert.equal(prev.new, 170); assert.equal(prev.rejected.length, 3); assert.equal(prev.new_tracks.length, 8);
  let s = await state(); assert.equal(s.startups.length, 0, 'preview must not write');
  const id = req();
  const c1 = await rpc('startups_import', { p_token: T, p_req: id, p_rows: [...rows, ...bad], p_commit: true });
  const c1again = await rpc('startups_import', { p_token: T, p_req: id, p_rows: [...rows, ...bad], p_commit: true });
  assert.deepEqual(c1, c1again, 'retry returns first result');
  const changed = rows.map((r, i) => i === 5 ? { ...r, startup_name: 'Renamed Five' } : r);
  const c2 = await rpc('startups_import', { p_token: T, p_req: req(), p_rows: changed, p_commit: true });
  assert.equal(c2.new, 0); assert.equal(c2.updated, 1); assert.equal(c2.unchanged, 169);
  s = await state(); assert.equal(s.startups.length, 170); assert.equal(s.tracks.length, 8);
  tracks = Object.fromEntries(s.tracks.map(t => [t.name, t.id]));
});

test('rooms: 10 rooms over 8 tracks; staff accounts', async () => {
  for (let i = 0; i < ROOM_MAP.length; i++) {
    await rpc('room_save', { p_token: T, p_req: req(), p_id: null, p_name: `Room ${i + 1}`, p_track_ids: ROOM_MAP[i].map(n => tracks[n]) });
  }
  await expectErr(rpc('room_save', { p_token: T, p_req: req(), p_id: null, p_name: 'room 1', p_track_ids: [] }), 'EXISTS');
  const s = await state(); rooms = Object.fromEntries(s.rooms.map(r => [r.name, r.id]));
  assert.equal(s.rooms.length, 10);
  const staff = await rpc('staff_list', { p_token: T });
  const sid = e => staff.find(x => x.email === e)?.id ?? null;
  await rpc('staff_save', { p_token: T, p_req: req(), p_id: sid('c1@test.local'), p_name: 'Coord One', p_email: 'c1@test.local', p_role: 'coordinator', p_duty: 'room', p_room_id: rooms['Room 1'], p_active: true, p_password: 'coord-pass-1' });
  await rpc('staff_save', { p_token: T, p_req: req(), p_id: sid('d1@test.local'), p_name: 'Desk One', p_email: 'd1@test.local', p_role: 'coordinator', p_duty: 'desk', p_room_id: null, p_active: true, p_password: 'desk-pass-1' });
  await expectErr(rpc('staff_save', { p_token: T, p_req: req(), p_id: null, p_name: 'Dup', p_email: 'c1@test.local', p_role: 'coordinator', p_duty: 'desk', p_room_id: null, p_active: true, p_password: 'xxxxxxxx' }), 'EXISTS');
  C = (await rpc('staff_login', { p_email: 'c1@test.local', p_password: 'coord-pass-1' })).token;
  D = (await rpc('staff_login', { p_email: 'd1@test.local', p_password: 'desk-pass-1' })).token;
  await expectErr(rpc('room_save', { p_token: C, p_req: req(), p_id: null, p_name: 'Hack', p_track_ids: [] }), 'FORBIDDEN');
  await expectErr(rpc('admin_state', { p_token: 'nope' }), 'AUTH');
});

test('check-in: duplicates keep first timestamp; queue fills rooms two deep', async () => {
  const s0 = await state();
  const f = s0.startups.filter(x => x.track === 'Fintech').slice(0, 6);
  const r1 = await rpc('checkin', { p_token: D, p_req: req(), p_startup: f[0].id });
  assert.equal(r1.already, false); assert.equal(r1.startup.ticket_no, 1);
  const r2 = await rpc('checkin', { p_token: C, p_req: req(), p_startup: f[0].id });
  assert.equal(r2.already, true); assert.equal(r2.startup.checked_in_by, 'Desk One');
  for (const x of f.slice(1)) await rpc('checkin', { p_token: D, p_req: req(), p_startup: x.id });
  const s = await state();
  const deck1 = roomBy(s, 'Room 1').on_deck.map(x => x.eureka_id), deck2 = roomBy(s, 'Room 2').on_deck.map(x => x.eureka_id);
  assert.equal(deck1.length, 2); assert.equal(deck2.length, 2);
  assert.equal(new Set([...deck1, ...deck2]).size, 4, 'no startup on deck twice');
  // fair: tickets 1-4 are on deck, 5-6 wait
  const waiting = s.startups.filter(x => x.status === 'waiting' && x.track === 'Fintech').map(x => x.ticket_no).sort();
  assert.deepEqual(waiting, [5, 6]);
  await inv();
  // search by QR payload
  const hits = await rpc('startup_search', { p_token: D, p_q: 'PD:' + f[0].eureka_id });
  assert.equal(hits[0].eureka_id, f[0].eureka_id);
  // undo a wrong check-in
  await rpc('checkin_undo', { p_token: D, p_req: req(), p_startup: f[5].id, p_reason: 'scanned wrong badge' });
  await rpc('checkin', { p_token: D, p_req: req(), p_startup: f[5].id });
  await inv();
});

test('pitching: normal start, busy room, double start blocked, override needs reason', async () => {
  let s = await state();
  const r1 = roomBy(s, 'Room 1'), r2 = roomBy(s, 'Room 2');
  const first = r1.on_deck[0];
  // coordinator of room 1 cannot run room 2
  await expectErr(rpc('pitch_start', { p_token: C, p_req: req(), p_room: r2.id, p_startup: r2.on_deck[0].id }), 'FORBIDDEN');
  const a = await rpc('pitch_start', { p_token: C, p_req: req(), p_room: r1.id, p_startup: first.id, p_expected_version: first.version });
  assert.equal(a.override, false);
  await expectErr(rpc('pitch_start', { p_token: T, p_req: req(), p_room: r1.id, p_startup: r1.on_deck[1].id, p_reason: 'x' }), 'ROOM_BUSY');
  const e = await expectErr(rpc('pitch_start', { p_token: T, p_req: req(), p_room: r2.id, p_startup: first.id, p_reason: 'present' }), 'ALREADY_PITCHING');
  assert.match(e.message, /Room 1 by Coord One/);
  // Room 2: start a startup that is waiting (not first on deck) => override
  s = await state();
  const waiting = s.startups.find(x => x.status === 'waiting' && x.track === 'Fintech');
  await expectErr(rpc('pitch_start', { p_token: T, p_req: req(), p_room: r2.id, p_startup: waiting.id }), 'REASON_REQUIRED');
  const o = await rpc('pitch_start', { p_token: T, p_req: req(), p_room: r2.id, p_startup: waiting.id, p_reason: 'Startup A not here, B present' });
  assert.equal(o.override, true);
  s = await state();
  assert.equal(byEid(s, waiting.eureka_id).ticket_no, waiting.ticket_no, 'original order kept');
  const log = await rpc('activity_list', { p_token: T, p_filter: { overrides: true } });
  assert.equal(log[0].actor, 'Test Admin'); assert.equal(log[0].reason, 'Startup A not here, B present');
  await inv();
});

test('pitching: phases, stale taps, pause and resume, finish', async () => {
  let s = await state();
  const live = roomBy(s, 'Room 1').live;
  await rpc('pitch_pause', { p_token: C, p_req: req(), p_session: live.id, p_pause: true });
  s = await state(); assert.ok(roomBy(s, 'Room 1').live.paused_at);
  await rpc('pitch_pause', { p_token: C, p_req: req(), p_session: live.id, p_pause: false });
  const id = req();
  await rpc('pitch_advance', { p_token: C, p_req: id, p_session: live.id, p_phase: 'pitch' });
  await rpc('pitch_advance', { p_token: C, p_req: id, p_session: live.id, p_phase: 'pitch' }); // retried tap: no double advance
  s = await state(); assert.equal(roomBy(s, 'Room 1').live.status, 'qa');
  await expectErr(rpc('pitch_advance', { p_token: C, p_req: req(), p_session: live.id, p_phase: 'pitch' }), 'STALE');
  await rpc('pitch_advance', { p_token: C, p_req: req(), p_session: live.id, p_phase: 'qa' });
  s = await state();
  assert.equal(roomBy(s, 'Room 1').live, null);
  assert.equal(byEid(s, live.startup.eureka_id).status, 'done');
  await expectErr(rpc('pitch_advance', { p_token: C, p_req: req(), p_session: live.id, p_phase: 'qa' }), 'STALE');
  await inv();
});

test('pitching: cancel returns to front of on-deck; restart keeps one live session', async () => {
  let s = await state();
  const r1 = roomBy(s, 'Room 1');
  const x = r1.on_deck[0];
  const st1 = await rpc('pitch_start', { p_token: C, p_req: req(), p_room: r1.id, p_startup: x.id });
  await expectErr(rpc('pitch_cancel', { p_token: C, p_req: req(), p_session: st1.session_id, p_restart: false, p_reason: '' }), 'REASON_REQUIRED');
  await rpc('pitch_cancel', { p_token: C, p_req: req(), p_session: st1.session_id, p_restart: false, p_reason: 'wrong startup' });
  s = await state();
  assert.equal(roomBy(s, 'Room 1').on_deck[0].id, x.id, 'back at front of on-deck');
  const st2 = await rpc('pitch_start', { p_token: C, p_req: req(), p_room: r1.id, p_startup: x.id });
  const rs = await rpc('pitch_cancel', { p_token: C, p_req: req(), p_session: st2.session_id, p_restart: true, p_reason: 'mic failed' });
  s = await state();
  assert.equal(roomBy(s, 'Room 1').live.id, rs.session_id);
  await inv();
});

test('skip: first skip requeues, second is no-show, restore brings back', async () => {
  // check in more Fintech so there is a queue behind
  let s = await state();
  for (const x of s.startups.filter(x => x.track === 'Fintech' && x.status === 'registered').slice(0, 6))
    await rpc('checkin', { p_token: D, p_req: req(), p_startup: x.id });
  s = await state();
  const r2 = roomBy(s, 'Room 2');
  // finish room 2's live override pitch first
  await rpc('pitch_advance', { p_token: T, p_req: req(), p_session: r2.live.id, p_phase: 'pitch' });
  await rpc('pitch_advance', { p_token: T, p_req: req(), p_session: r2.live.id, p_phase: 'qa' });
  s = await state();
  const victim = roomBy(s, 'Room 2').on_deck[0];
  const k1 = await rpc('startup_skip', { p_token: T, p_req: req(), p_room: r2.id, p_startup: victim.id, p_reason: 'not in room' });
  assert.equal(k1.outcome, 'requeued');
  s = await state();
  const v = byEid(s, victim.eureka_id);
  assert.equal(v.skip_count, 1); assert.ok(v.queue_pos > victim.queue_pos);
  await inv();
  // bring it back on deck by moving it to the front, then skip again
  const front = s.startups.filter(x => ['waiting', 'on_deck'].includes(x.status)).sort((a, b) => a.queue_pos - b.queue_pos)[0];
  await rpc('queue_move', { p_token: T, p_req: req(), p_startup: v.id, p_before: front.id, p_reason: 'test' });
  // free a deck slot in a Fintech room: hold everything else on deck in Room 2
  s = await state();
  let inDeck = s.rooms.flatMap(r => r.on_deck.map(d => ({ room: r.id, ...d }))).find(d => d.id === v.id);
  if (!inDeck) {
    for (const d of roomBy(s, 'Room 2').on_deck) await rpc('startup_set_hold', { p_token: T, p_req: req(), p_startup: d.id, p_hold: true, p_reason: 'test' });
    s = await state();
    inDeck = s.rooms.flatMap(r => r.on_deck.map(d => ({ room: r.id, ...d }))).find(d => d.id === v.id);
  }
  assert.ok(inDeck, 'moved startup is on deck');
  const k2 = await rpc('startup_skip', { p_token: T, p_req: req(), p_room: inDeck.room, p_startup: v.id, p_reason: 'still missing' });
  assert.equal(k2.outcome, 'no_show');
  await rpc('startup_set_active', { p_token: D, p_req: req(), p_startup: v.id, p_active: true, p_reason: 'arrived late' });
  s = await state(); assert.notEqual(byEid(s, v.eureka_id).status, 'no_show');
  for (const x of s.startups.filter(x => x.status === 'hold')) await rpc('startup_set_hold', { p_token: T, p_req: req(), p_startup: x.id, p_hold: false, p_reason: 'release' });
  await inv();
});

test('rooms: close refused during pitch, close+cancel, other rooms untouched, reopen', async () => {
  let s = await state();
  const r1 = roomBy(s, 'Room 1');
  assert.ok(r1.live, 'room 1 has a live pitch');
  const r2before = JSON.stringify(roomBy(s, 'Room 2').on_deck.map(x => x.id));
  await expectErr(rpc('room_set_status', { p_token: T, p_req: req(), p_room: r1.id, p_status: 'closed' }), 'LIVE_SESSION');
  await expectErr(rpc('room_set_status', { p_token: C, p_req: req(), p_room: r1.id, p_status: 'closed' }), 'FORBIDDEN');
  const res = await rpc('room_set_status', { p_token: T, p_req: req(), p_room: r1.id, p_status: 'closed', p_live_mode: 'cancel', p_reason: 'projector died' });
  assert.ok(res.returned_to_queue >= 0);
  s = await state();
  const nr1 = roomBy(s, 'Room 1');
  assert.equal(nr1.status, 'closed'); assert.equal(nr1.live, null); assert.equal(nr1.on_deck.length, 0);
  // Room 2 keeps its on-deck startups; it may only gain (refill), never lose them.
  const r2after = roomBy(s, 'Room 2').on_deck.map(x => x.id);
  for (const id of JSON.parse(r2before)) assert.ok(r2after.includes(id), 'room 2 not affected');
  await expectErr(rpc('pitch_start', { p_token: T, p_req: req(), p_room: r1.id, p_startup: r2after[0], p_reason: 'x' }), 'ROOM_NOT_OPEN');
  await inv();
  await rpc('room_set_status', { p_token: T, p_req: req(), p_room: r1.id, p_status: 'open' });
  s = await state(); assert.equal(roomBy(s, 'Room 1').status, 'open');
  await inv();
  // Break: keeps on-deck, takes no pitch
  await rpc('room_set_status', { p_token: T, p_req: req(), p_room: r1.id, p_status: 'break' });
  await expectErr(rpc('pitch_start', { p_token: C, p_req: req(), p_room: r1.id, p_startup: roomBy(s, 'Room 1').on_deck[0]?.id ?? 1 }), 'ROOM_NOT_OPEN');
  await rpc('room_set_status', { p_token: T, p_req: req(), p_room: r1.id, p_status: 'open' });
  await inv();
});

test('rooms: track change returns on-deck startups; a track with no room raises an alert', async () => {
  let s = await state();
  const r2 = roomBy(s, 'Room 2');
  await rpc('room_save', { p_token: T, p_req: req(), p_id: r2.id, p_name: 'Room 2', p_track_ids: [tracks['Healthtech']] });
  await rpc('room_save', { p_token: T, p_req: req(), p_id: roomBy(s, 'Room 1').id, p_name: 'Room 1', p_track_ids: [tracks['Healthtech']] });
  s = await state();
  assert.ok(s.alerts.some(a => a.kind === 'no_room'), 'alert raised: ' + JSON.stringify(s.alerts));
  await inv();
  await rpc('room_save', { p_token: T, p_req: req(), p_id: r2.id, p_name: 'Room 2', p_track_ids: [tracks['Fintech']] });
  await rpc('room_save', { p_token: T, p_req: req(), p_id: roomBy(s, 'Room 1').id, p_name: 'Room 1', p_track_ids: [tracks['Fintech']] });
  await inv();
});

test('pin to room, hold and release', async () => {
  let s = await state();
  const w = s.startups.find(x => x.status === 'waiting' || x.status === 'on_deck');
  const other = s.rooms.find(r => r.track_ids.includes(w.track_id) && r.status === 'open');
  await expectErr(rpc('startup_pin', { p_token: T, p_req: req(), p_startup: w.id, p_room: roomBy(s, 'Room 4').id, p_reason: '' }), 'INVALID');
  await rpc('startup_pin', { p_token: T, p_req: req(), p_startup: w.id, p_room: other.id, p_reason: 'asked for this room' });
  await inv();
  await rpc('startup_set_hold', { p_token: T, p_req: req(), p_startup: w.id, p_hold: true, p_reason: 'requested later slot' });
  s = await state(); assert.equal(byEid(s, w.eureka_id).status, 'hold');
  await inv();
  await rpc('startup_set_hold', { p_token: T, p_req: req(), p_startup: w.id, p_hold: false, p_reason: '' });
  await rpc('startup_pin', { p_token: T, p_req: req(), p_startup: w.id, p_room: null, p_reason: '' });
  await inv();
});

test('judges: add, assign, score only own room, resubmit updates, mentor cannot, lock', async () => {
  await rpc('criteria_save', { p_token: T, p_req: req(), p_force: false, p_items: [
    { name: 'Problem', max_score: 10, weight: 1 }, { name: 'Solution', max_score: 10, weight: 1 },
    { name: 'Market', max_score: 10, weight: 1 }, { name: 'Team', max_score: 10, weight: 1 }, { name: 'Presentation', max_score: 10, weight: 1 }] });
  const crit = await rpc('criteria_list');
  let s = await state();
  const r1 = roomBy(s, 'Room 1'), r3 = roomBy(s, 'Room 3');
  const j1 = await rpc('judge_save', { p_token: C, p_req: req(), p_id: null, p_name: 'Judge A', p_email: 'ja@x.co', p_phone: '', p_kind: 'jury' });
  const j2 = await rpc('judge_save', { p_token: C, p_req: req(), p_id: null, p_name: 'Judge B', p_email: 'jb@x.co', p_phone: '', p_kind: 'jury' });
  const m1 = await rpc('judge_save', { p_token: C, p_req: req(), p_id: null, p_name: 'Mentor M', p_email: '', p_phone: '', p_kind: 'mentor' });
  for (const [j, r] of [[j1, r1], [j2, r3], [m1, r1]]) {
    await rpc('judge_update', { p_token: C, p_req: req(), p_id: j.id, p_patch: { status: 'arrived', room_id: r.id } });
  }
  const list = await rpc('judges_list', { p_token: C });
  const tok = Object.fromEntries(list.map(j => [j.name, j.token]));
  // a pitch in room 1 now
  s = await state();
  const live = roomBy(s, 'Room 1').live || null;
  let target;
  if (live) target = live.startup.id; else {
    const d = roomBy(s, 'Room 1').on_deck[0];
    await rpc('pitch_start', { p_token: C, p_req: req(), p_room: r1.id, p_startup: d.id });
    target = d.id;
  }
  const me = await rpc('judge_me', { p_jtoken: tok['Judge A'] });
  assert.equal(me.room.name, 'Room 1'); assert.equal(me.current.startup.id, target);
  const vals = Object.fromEntries(crit.map((c, i) => [c.id, 6 + (i % 3)]));
  await expectErr(rpc('score_submit', { p_jtoken: tok['Judge A'], p_req: req(), p_startup: target, p_vals: { [crit[0].id]: 5 }, p_comment: '', p_recused: false }), 'INCOMPLETE');
  const sub = await rpc('score_submit', { p_jtoken: tok['Judge A'], p_req: req(), p_startup: target, p_vals: vals, p_comment: 'good', p_recused: false });
  assert.equal(sub.updated, false);
  const sub2 = await rpc('score_submit', { p_jtoken: tok['Judge A'], p_req: req(), p_startup: target, p_vals: { ...vals, [crit[0].id]: 10 }, p_comment: 'better', p_recused: false });
  assert.equal(sub2.updated, true);
  await expectErr(rpc('score_submit', { p_jtoken: tok['Judge B'], p_req: req(), p_startup: target, p_vals: vals, p_comment: '', p_recused: false }), 'FORBIDDEN');
  await expectErr(rpc('score_submit', { p_jtoken: tok['Mentor M'], p_req: req(), p_startup: target, p_vals: vals, p_comment: '', p_recused: false }), 'FORBIDDEN');
  await expectErr(rpc('score_submit', { p_jtoken: tok['Judge A'], p_req: req(), p_startup: target, p_vals: { ...vals, [crit[0].id]: 11 }, p_comment: '', p_recused: false }), 'INVALID');
  await expectErr(rpc('criteria_save', { p_token: T, p_req: req(), p_force: false, p_items: crit }), 'SCORES_EXIST');
  const res = await rpc('results', { p_token: T });
  const row = res.rows.find(r => r.startup_id === target);
  assert.equal(row.n, 1); assert.equal(Number(row.raw), Math.round(100 * (10 + 7 + 8 + 6 + 7) / 50 * 100) / 100);
  const trackId = row.track_id;
  await rpc('results_lock', { p_token: T, p_req: req(), p_track: trackId, p_lock: true });
  await expectErr(rpc('score_submit', { p_jtoken: tok['Judge A'], p_req: req(), p_startup: target, p_vals: vals, p_comment: '', p_recused: false }), 'LOCKED');
  await rpc('results_lock', { p_token: T, p_req: req(), p_track: trackId, p_lock: false });
  // reissued link stops the old one
  const old = tok['Judge B'];
  await rpc('judge_reissue', { p_token: C, p_req: req(), p_id: j2.id });
  await expectErr(rpc('judge_me', { p_jtoken: old }), 'AUTH');
  await inv();
});

test('startup self-service: lookup, status, estimate, displays', async () => {
  let s = await state();
  const w = s.startups.find(x => x.status === 'waiting');
  const reg = s.startups.find(x => x.status === 'registered');
  await expectErr(rpc('startup_access', { p_eureka_id: reg.eureka_id, p_email: 'wrong@x.co' }), 'NOT_FOUND');
  const a = await rpc('startup_access', { p_eureka_id: reg.eureka_id.toLowerCase(), p_email: reg.email.toUpperCase() });
  const me = await rpc('startup_me', { p_stoken: a.token });
  assert.equal(me.startup.status, 'registered'); assert.equal(me.qr, 'PD:' + reg.eureka_id);
  if (w) {
    const links = await rpc('export_data', { p_token: T, p_kind: 'links' });
    const tk = links.find(l => l.eureka_id === w.eureka_id).token;
    const m2 = await rpc('startup_me', { p_stoken: tk });
    assert.equal(m2.startup.status, 'waiting'); assert.ok(m2.eta_s > 0); assert.ok(m2.ahead >= 0);
  }
  const disp = await rpc('room_display', { p_code: roomBy(s, 'Room 1').display_code });
  assert.equal(disp.room.name, 'Room 1');
  const hall = await rpc('hall_board', { p_code: s.hall_code });
  assert.ok(hall.rooms.length >= 9);
  await expectErr(rpc('hall_board', { p_code: 'nope' }), 'NOT_FOUND');
  await expectErr(rpc('admin_state', { p_token: a.token }), 'AUTH');
});

test('exports and activity log', async () => {
  for (const k of ['attendance', 'pitches', 'scores', 'log', 'links', 'judges']) {
    const rows = await rpc('export_data', { p_token: T, p_kind: k });
    assert.ok(Array.isArray(rows), k);
  }
  await expectErr(rpc('export_data', { p_token: C, p_kind: 'links' }), 'FORBIDDEN');
  const log = await rpc('activity_list', { p_token: T, p_filter: {} });
  assert.ok(log.length > 30);
  assert.ok(log.some(l => l.action === 'pitch.override'));
});
