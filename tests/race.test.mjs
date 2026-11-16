// Concurrency tests: conflicting actions fired at the same instant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpc, req, TRACKS, ROOM_MAP, makeStartups } from './lib.mjs';

const ADMIN = { email: 'admin@test.local', password: 'admin-pass-123' };
let T, rooms, tracks;
const inv = async (label) => { const v = await rpc('test_invariants'); assert.deepEqual(v, [], label + ': ' + JSON.stringify(v)); };
const state = () => rpc('admin_state', { p_token: T });
const settle = ps => Promise.allSettled(ps);
const ok = rs => rs.filter(r => r.status === 'fulfilled');
const codes = rs => rs.filter(r => r.status === 'rejected').map(r => (r.reason.message || '').split(':')[0]);

test('setup fresh event', async () => {
  T = (await rpc('staff_login', { p_email: ADMIN.email, p_password: ADMIN.password })).token;
  await rpc('event_reset', { p_token: T, p_confirm: 'RESET', p_scope: 'all' });
  await rpc('startups_import', { p_token: T, p_req: req(), p_rows: makeStartups(170), p_commit: true });
  let s = await state(); tracks = Object.fromEntries(s.tracks.map(t => [t.name, t.id]));
  for (let i = 0; i < ROOM_MAP.length; i++)
    await rpc('room_save', { p_token: T, p_req: req(), p_id: null, p_name: `Room ${i + 1}`, p_track_ids: ROOM_MAP[i].map(n => tracks[n]) });
  s = await state(); rooms = s.rooms;
});

test('120 check-ins at once, 30 of them duplicates: one ticket each, no gaps', async () => {
  const s = await state();
  const targets = s.startups.slice(0, 90);
  const calls = [...targets, ...targets.slice(0, 30)].map(x => rpc('checkin', { p_token: T, p_req: req(), p_startup: x.id }));
  const rs = await settle(calls);
  assert.equal(ok(rs).length, 120, 'all calls answered: ' + codes(rs).join(','));
  assert.equal(ok(rs).filter(r => r.value.already === false).length, 90);
  const s2 = await state();
  const tickets = s2.startups.filter(x => x.ticket_no).map(x => x.ticket_no).sort((a, b) => a - b);
  assert.deepEqual(tickets, Array.from({ length: 90 }, (_, i) => i + 1));
  await inv('after mass check-in');
});

test('same button pressed 10 times at once (same request id): acts once', async () => {
  const s = await state();
  const x = s.startups.find(x => x.status === 'registered');
  const id = req();
  const rs = await settle(Array.from({ length: 10 }, () => rpc('checkin', { p_token: T, p_req: id, p_startup: x.id })));
  assert.equal(ok(rs).length, 10);
  const log = await rpc('activity_list', { p_token: T, p_filter: { action: 'checkin' } });
  assert.equal(log.filter(l => l.startup_id === x.id && l.action === 'checkin').length, 1);
});

test('two rooms start the same startup at the same instant (40 trials): never both', async () => {
  let wins = 0;
  for (let i = 0; i < 40; i++) {
    const s = await state();
    const fin = s.rooms.filter(r => r.status === 'open' && r.track_ids.includes(tracks['Fintech']) && !r.live);
    if (fin.length < 2) { // free both rooms
      for (const r of s.rooms.filter(r => r.live)) {
        await rpc('pitch_cancel', { p_token: T, p_req: req(), p_session: r.live.id, p_restart: false, p_reason: 'race reset' }).catch(() => {});
      }
      i--; continue;
    }
    const target = fin[0].on_deck[0] || s.startups.find(x => x.status === 'waiting' && x.track_id === tracks['Fintech']);
    if (!target) break;
    const rs = await settle(fin.slice(0, 2).map(r => rpc('pitch_start', { p_token: T, p_req: req(), p_room: r.id, p_startup: target.id, p_reason: 'race' })));
    assert.equal(ok(rs).length, 1, `trial ${i}: exactly one start wins, got ${ok(rs).length} (${codes(rs)})`);
    assert.ok(codes(rs).every(c => ['ALREADY_PITCHING', 'ROOM_BUSY', 'CONFLICT'].includes(c)), codes(rs).join());
    wins++;
    await inv('trial ' + i);
    const sid = ok(rs)[0].value.session_id;
    await rpc('pitch_cancel', { p_token: T, p_req: req(), p_session: sid, p_restart: false, p_reason: 'race reset' });
  }
  assert.ok(wins >= 30, 'ran trials: ' + wins);
});

test('double tap "next phase" from two devices (30 trials): advances once', async () => {
  for (let i = 0; i < 30; i++) {
    const s = await state();
    const r = s.rooms.find(r => r.status === 'open' && r.on_deck.length && !r.live);
    const st = await rpc('pitch_start', { p_token: T, p_req: req(), p_room: r.id, p_startup: r.on_deck[0].id });
    const rs = await settle([1, 2].map(() => rpc('pitch_advance', { p_token: T, p_req: req(), p_session: st.session_id, p_phase: 'pitch' })));
    assert.equal(ok(rs).length, 1); assert.deepEqual(codes(rs), ['STALE']);
    await rpc('pitch_cancel', { p_token: T, p_req: req(), p_session: st.session_id, p_restart: false, p_reason: 'race reset' });
  }
  await inv('after double taps');
});

test('room closed while a pitch is being started there (30 trials)', async () => {
  for (let i = 0; i < 30; i++) {
    const s = await state();
    const r = s.rooms.find(r => r.status === 'open' && r.on_deck.length && !r.live);
    const rs = await settle([
      rpc('pitch_start', { p_token: T, p_req: req(), p_room: r.id, p_startup: r.on_deck[0].id }),
      rpc('room_set_status', { p_token: T, p_req: req(), p_room: r.id, p_status: 'closed', p_live_mode: 'cancel', p_reason: 'race' }),
    ]);
    // Either order is valid; the room must end closed, nothing live there, nothing on deck there.
    const s2 = await state();
    const r2 = s2.rooms.find(x => x.id === r.id);
    assert.equal(r2.status, 'closed', codes(rs).join());
    assert.equal(r2.live, null); assert.equal(r2.on_deck.length, 0);
    await inv('close race ' + i);
    await rpc('room_set_status', { p_token: T, p_req: req(), p_room: r.id, p_status: 'open' });
  }
});

test('admin changes a room\'s tracks while the operator starts a pitch (20 trials)', async () => {
  for (let i = 0; i < 20; i++) {
    const s = await state();
    const r = s.rooms.find(r => r.status === 'open' && r.on_deck.length && !r.live && r.track_ids.length === 1);
    const other = s.tracks.find(t => t.id !== r.track_ids[0]).id;
    await settle([
      rpc('pitch_start', { p_token: T, p_req: req(), p_room: r.id, p_startup: r.on_deck[0].id }),
      rpc('room_save', { p_token: T, p_req: req(), p_id: r.id, p_name: r.name, p_track_ids: [other] }),
    ]);
    await inv('track change race ' + i);
    const s2 = await state(); const r2 = s2.rooms.find(x => x.id === r.id);
    if (r2.live) await rpc('pitch_cancel', { p_token: T, p_req: req(), p_session: r2.live.id, p_restart: false, p_reason: 'reset' });
    await rpc('room_save', { p_token: T, p_req: req(), p_id: r.id, p_name: r.name, p_track_ids: r.track_ids });
    await inv('track restore ' + i);
  }
});

test('two admins reorder the same startup while rooms refill (20 trials)', async () => {
  for (let i = 0; i < 20; i++) {
    const s = await state();
    const q = s.startups.filter(x => ['waiting', 'on_deck'].includes(x.status)).sort((a, b) => a.queue_pos - b.queue_pos);
    const mover = q.at(-1), a = q[0], b = q[3];
    const r = s.rooms.find(r => r.status === 'open' && r.on_deck.length && !r.live);
    await settle([
      rpc('queue_move', { p_token: T, p_req: req(), p_startup: mover.id, p_before: a.id, p_reason: 'race A' }),
      rpc('queue_move', { p_token: T, p_req: req(), p_startup: mover.id, p_before: b.id, p_reason: 'race B' }),
      rpc('pitch_start', { p_token: T, p_req: req(), p_room: r.id, p_startup: r.on_deck[0].id }),
    ]);
    await inv('reorder race ' + i);
    const s2 = await state();
    for (const rr of s2.rooms.filter(x => x.live)) await rpc('pitch_cancel', { p_token: T, p_req: req(), p_session: rr.live.id, p_restart: false, p_reason: 'reset' });
  }
});

test('operator overrides a startup the moment another room calls it (20 trials)', async () => {
  for (let i = 0; i < 20; i++) {
    const s = await state();
    const fin = s.rooms.filter(r => r.status === 'open' && r.track_ids.includes(tracks['Fintech']) && !r.live);
    const victim = fin[1].on_deck[0];
    if (!victim) break;
    const rs = await settle([
      rpc('pitch_start', { p_token: T, p_req: req(), p_room: fin[0].id, p_startup: victim.id, p_reason: 'present in room' }),
      rpc('startup_skip', { p_token: T, p_req: req(), p_room: fin[1].id, p_startup: victim.id, p_reason: 'race' }),
    ]);
    await inv('override vs skip ' + i);
    const s2 = await state();
    for (const rr of s2.rooms.filter(x => x.live)) await rpc('pitch_cancel', { p_token: T, p_req: req(), p_session: rr.live.id, p_restart: false, p_reason: 'reset' });
    for (const x of s2.startups.filter(x => x.status === 'no_show')) await rpc('startup_set_active', { p_token: T, p_req: req(), p_startup: x.id, p_active: true, p_reason: 'reset' });
  }
});

test('10 rooms change status at the same moment', async () => {
  const s = await state();
  await settle(s.rooms.map((r, i) => rpc('room_set_status', { p_token: T, p_req: req(), p_room: r.id, p_status: i % 2 ? 'break' : 'closed', p_live_mode: 'cancel', p_reason: 'race' })));
  await inv('mass close');
  await settle(s.rooms.map(r => rpc('room_set_status', { p_token: T, p_req: req(), p_room: r.id, p_status: 'open' })));
  await inv('mass reopen');
  const s2 = await state();
  assert.ok(s2.rooms.every(r => r.status === 'open'));
});
