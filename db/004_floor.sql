-- Pitch Day: check-in, queue control, pitching

-- ---------- Check-in ----------

create or replace function startup_search(p_token text, p_q text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
declare q text;
begin
  perform _staff(p_token);
  q := trim(coalesce(p_q,''));
  -- QR codes carry "PD:<eureka id>".
  if upper(q) like 'PD:%' then q := substr(q, 4); end if;
  if q = '' then return '[]'; end if;
  return coalesce((
    select jsonb_agg(_startup_json(s) order by (upper(s.eureka_id) = upper(q)) desc, s.name)
    from (select * from startups
          where upper(eureka_id) = upper(q) or eureka_id ilike '%' || q || '%'
             or name ilike '%' || q || '%' or email ilike '%' || q || '%'
          limit 25) s), '[]');
end $$;

create or replace function checkin(p_token text, p_req uuid, p_startup int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; s startups; t int;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  select * into s from startups where id = p_startup for update;
  if not found then perform _err('NOT_FOUND', 'Startup not found.'); end if;
  if s.status = 'withdrawn' then perform _err('WITHDRAWN', s.name || ' was withdrawn. An admin can restore them.'); end if;
  if s.checked_in_at is not null then
    -- Never overwrite the first check-in.
    return _idem_put(p_req, jsonb_build_object('already', true, 'startup', _startup_json(s)));
  end if;
  t := nextval('ticket_seq');
  update startups set status = 'waiting', checked_in_at = now(), checked_in_by = a->>'name',
    ticket_no = t, queue_pos = coalesce(queue_pos, t), version = version + 1, updated_at = now()
  where id = p_startup returning * into s;
  perform _log(a, 'checkin', p_startup, null, null, jsonb_build_object('ticket_no', t), null);
  perform _refill_all();
  perform _bump();
  select * into s from startups where id = p_startup;
  return _idem_put(p_req, jsonb_build_object('already', false, 'startup', _startup_json(s)));
end $$;

create or replace function checkin_undo(p_token text, p_req uuid, p_startup int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; s startups;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  select * into s from startups where id = p_startup for update;
  if not found then perform _err('NOT_FOUND', 'Startup not found.'); end if;
  if s.checked_in_at is null then perform _err('INVALID', 'This startup is not checked in.'); end if;
  if s.status in ('pitching','done') or exists (select 1 from pitch_sessions where startup_id = p_startup and status <> 'cancelled') then
    perform _err('INVALID', 'This startup has already pitched. Check-in cannot be undone.');
  end if;
  update startups set status = 'registered', checked_in_at = null, checked_in_by = null,
    ticket_no = null, queue_pos = null, on_deck_room_id = null, on_deck_at = null,
    skip_count = 0, version = version + 1, updated_at = now() where id = p_startup;
  perform _log(a, 'checkin.undo', p_startup, null, null,
    jsonb_build_object('ticket_no', s.ticket_no, 'checked_in_by', s.checked_in_by), p_reason);
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
end $$;

-- ---------- Queue control (admin) ----------

-- Move a startup so it sits just before p_before (or to the end when null).
create or replace function queue_move(p_token text, p_req uuid, p_startup int, p_before int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; s startups; b numeric; prev numeric; newpos numeric;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  select * into s from startups where id = p_startup for update;
  if not found or s.queue_pos is null then perform _err('INVALID', 'Only checked-in startups can be moved.'); end if;
  if s.status not in ('waiting','hold','on_deck') then
    perform _err('INVALID', 'This startup is ' || replace(s.status,'_',' ') || ' and cannot be moved.');
  end if;
  if p_before is null then
    newpos := coalesce((select max(queue_pos) from startups where queue_pos is not null and id <> p_startup), 0) + 1;
  else
    select queue_pos into b from startups where id = p_before;
    if b is null then perform _err('INVALID', 'Target position not found.'); end if;
    select max(queue_pos) into prev from startups where queue_pos < b and id <> p_startup;
    newpos := _pos_between(prev, b);
  end if;
  update startups set queue_pos = newpos, version = version + 1, updated_at = now() where id = p_startup;
  -- A startup moved behind others gives up its on-deck spot.
  if s.status = 'on_deck' and newpos > s.queue_pos then perform _to_waiting(p_startup); end if;
  perform _log(a, 'queue.move', p_startup, null, null,
    jsonb_build_object('from', s.queue_pos, 'to', newpos, 'before', p_before), p_reason);
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('queue_pos', newpos));
end $$;

create or replace function startup_set_hold(p_token text, p_req uuid, p_startup int, p_hold boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; s startups;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  select * into s from startups where id = p_startup for update;
  if not found then perform _err('NOT_FOUND', 'Startup not found.'); end if;
  if p_hold then
    if s.status not in ('waiting','on_deck') then perform _err('INVALID', 'Only waiting or on-deck startups can be held.'); end if;
    update startups set status = 'hold', on_deck_room_id = null, on_deck_at = null, version = version + 1 where id = p_startup;
  else
    if s.status <> 'hold' then perform _err('INVALID', 'This startup is not on hold.'); end if;
    perform _to_waiting(p_startup);
  end if;
  perform _log(a, case when p_hold then 'queue.hold' else 'queue.release' end, p_startup, s.on_deck_room_id, null, '{}', p_reason);
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
end $$;

create or replace function startup_pin(p_token text, p_req uuid, p_startup int, p_room int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; s startups;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  select * into s from startups where id = p_startup for update;
  if not found then perform _err('NOT_FOUND', 'Startup not found.'); end if;
  if p_room is not null and not exists (select 1 from room_tracks where room_id = p_room and track_id = s.track_id) then
    perform _err('INVALID', 'That room does not serve this startup''s track. Add the track to the room first.');
  end if;
  update startups set pinned_room_id = p_room, version = version + 1 where id = p_startup;
  if s.status = 'on_deck' and p_room is not null and s.on_deck_room_id <> p_room then perform _to_waiting(p_startup); end if;
  perform _log(a, 'queue.pin', p_startup, p_room, null, jsonb_build_object('from', s.pinned_room_id), p_reason);
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
end $$;

-- Withdraw a startup, or restore a withdrawn or no-show startup to the queue.
create or replace function startup_set_active(p_token text, p_req uuid, p_startup int, p_active boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; s startups;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  select * into s from startups where id = p_startup for update;
  if not found then perform _err('NOT_FOUND', 'Startup not found.'); end if;
  if not p_active then
    if a->>'role' <> 'admin' then perform _err('FORBIDDEN', 'Only admins can withdraw a startup.'); end if;
    if s.status in ('pitching','done') then perform _err('INVALID', 'This startup has pitched and cannot be withdrawn.'); end if;
    update startups set status = 'withdrawn', on_deck_room_id = null, on_deck_at = null, version = version + 1 where id = p_startup;
    perform _log(a, 'startup.withdraw', p_startup, null, null, jsonb_build_object('from', s.status), p_reason);
  else
    if s.status not in ('withdrawn','no_show') then perform _err('INVALID', 'This startup is already active.'); end if;
    if s.checked_in_at is null then
      update startups set status = 'registered', skip_count = 0, version = version + 1 where id = p_startup;
    else
      update startups set status = 'waiting', skip_count = 0,
        queue_pos = _pos_between(null, (select min(queue_pos) from startups where status = 'waiting')),
        version = version + 1 where id = p_startup;
    end if;
    perform _log(a, 'startup.restore', p_startup, null, null, jsonb_build_object('from', s.status), p_reason);
  end if;
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
end $$;

-- ---------- Pitching ----------

-- Start a pitch. When p_startup is not first on deck for this room, it is a manual override.
create or replace function pitch_start(p_token text, p_req uuid, p_room int, p_startup int,
  p_expected_version int default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; rm rooms; s startups; first_id int; is_ovr boolean; live pitch_sessions; sid int; other text;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  perform _can_run_room(a, p_room);
  select * into rm from rooms where id = p_room for update;
  if not found then perform _err('NOT_FOUND', 'Room not found.'); end if;
  if rm.status <> 'open' then perform _err('ROOM_NOT_OPEN', rm.name || ' is ' || rm.status || '. Open it first.'); end if;
  select * into live from pitch_sessions where room_id = p_room and status in ('pitch','qa');
  if live.id is not null then
    perform _err('ROOM_BUSY', 'A pitch is already running in ' || rm.name || '. End or cancel it first.');
  end if;
  select * into s from startups where id = p_startup for update;
  if not found then perform _err('NOT_FOUND', 'Startup not found.'); end if;
  if p_expected_version is not null and s.version <> p_expected_version then
    perform _err('STALE', s.name || ' changed a moment ago. The screen has been refreshed; check and try again.');
  end if;
  if s.status = 'pitching' then
    select r2.name || ' by ' || ps.started_by || ', ' ||
           round(extract(epoch from now() - ps.pitch_started_at)) || ' seconds ago' into other
    from pitch_sessions ps join rooms r2 on r2.id = ps.room_id
    where ps.startup_id = s.id and ps.status in ('pitch','qa');
    perform _err('ALREADY_PITCHING', s.name || ' is already pitching in ' || coalesce(other, 'another room') || '.');
  end if;
  if s.status = 'done' then perform _err('INVALID', s.name || ' has already pitched.'); end if;
  if s.status in ('registered') then perform _err('NOT_CHECKED_IN', s.name || ' has not checked in at the desk yet.'); end if;
  if s.status in ('withdrawn') then perform _err('INVALID', s.name || ' was withdrawn.'); end if;
  if s.pinned_room_id is not null and s.pinned_room_id <> p_room then
    perform _err('PINNED', s.name || ' is pinned to another room.');
  end if;
  select id into first_id from startups
   where status = 'on_deck' and on_deck_room_id = p_room order by queue_pos, id limit 1;
  is_ovr := first_id is distinct from p_startup;
  if is_ovr and coalesce(trim(p_reason),'') = '' then
    perform _err('REASON_REQUIRED', 'Starting a startup out of order needs a short reason.');
  end if;
  insert into pitch_sessions (startup_id, room_id, actual_no, status, started_by, is_override, override_reason)
  values (s.id, p_room, nextval('actual_seq'), 'pitch', a->>'name', is_ovr, case when is_ovr then trim(p_reason) end)
  returning id into sid;
  update startups set status = 'pitching', on_deck_room_id = p_room, version = version + 1, updated_at = now()
  where id = s.id;
  perform _log(a, case when is_ovr then 'pitch.override' else 'pitch.start' end, s.id, p_room, null,
    jsonb_build_object('session_id', sid, 'ticket_no', s.ticket_no, 'from_status', s.status,
                       'expected_first', first_id), p_reason);
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('session_id', sid, 'override', is_ovr));
exception
  when unique_violation then
    perform _err('CONFLICT', 'Someone else started a pitch at the same moment. The screen has been refreshed.');
end $$;

create or replace function _live_session(p_session int, p_actor jsonb) returns pitch_sessions
language plpgsql as $$
declare ps pitch_sessions;
begin
  select * into ps from pitch_sessions where id = p_session for update;
  if not found then perform _err('NOT_FOUND', 'Session not found.'); end if;
  perform _can_run_room(p_actor, ps.room_id);
  if ps.status not in ('pitch','qa') then
    perform _err('STALE', 'This pitch has already ended. The screen has been refreshed.');
  end if;
  return ps;
end $$;

-- Move to the next phase: pitch -> Q&A -> done. p_phase must match the current phase.
create or replace function pitch_advance(p_token text, p_req uuid, p_session int, p_phase text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; ps pitch_sessions; paused numeric; qa int;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  ps := _live_session(p_session, a);
  if ps.status <> p_phase then
    perform _err('STALE', 'This pitch already moved on. The screen has been refreshed.');
  end if;
  paused := ps.phase_paused_s + coalesce(extract(epoch from now() - ps.paused_at), 0);
  select qa_s into qa from settings where id = 1;
  if ps.status = 'pitch' and qa > 0 then
    update pitch_sessions set status = 'qa', pitch_ended_at = now(), phase_started_at = now(),
      phase_paused_s = 0, total_paused_s = total_paused_s + paused, paused_at = null where id = ps.id;
    perform _log(a, 'pitch.end', ps.startup_id, ps.room_id, null, jsonb_build_object('session_id', ps.id), null);
  else
    update pitch_sessions set status = 'done',
      pitch_ended_at = coalesce(pitch_ended_at, now()), qa_ended_at = now(),
      total_paused_s = total_paused_s + paused, paused_at = null, ended_by = a->>'name' where id = ps.id;
    update startups set status = 'done', on_deck_room_id = null, version = version + 1, updated_at = now()
      where id = ps.startup_id;
    update rooms set last_ended_at = now() where id = ps.room_id;
    perform _log(a, 'pitch.finish', ps.startup_id, ps.room_id, null, jsonb_build_object('session_id', ps.id), null);
  end if;
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
end $$;

create or replace function pitch_pause(p_token text, p_req uuid, p_session int, p_pause boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; ps pitch_sessions;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  ps := _live_session(p_session, a);
  if p_pause then
    if ps.paused_at is not null then return _idem_put(p_req, '{"ok":true}'); end if;
    update pitch_sessions set paused_at = now() where id = ps.id;
  else
    if ps.paused_at is null then return _idem_put(p_req, '{"ok":true}'); end if;
    update pitch_sessions set phase_paused_s = phase_paused_s + extract(epoch from now() - paused_at),
      paused_at = null where id = ps.id;
  end if;
  perform _log(a, case when p_pause then 'pitch.pause' else 'pitch.resume' end, ps.startup_id, ps.room_id, null,
    jsonb_build_object('session_id', ps.id, 'phase', ps.status), null);
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
end $$;

-- Cancel (wrong startup, or stop) or restart (void this attempt, begin a new one).
create or replace function pitch_cancel(p_token text, p_req uuid, p_session int, p_restart boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; ps pitch_sessions; sid int;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  ps := _live_session(p_session, a);
  if coalesce(trim(p_reason),'') = '' then perform _err('REASON_REQUIRED', 'Add a short reason.'); end if;
  update pitch_sessions set status = 'cancelled', cancel_reason = trim(p_reason), ended_by = a->>'name',
    paused_at = null where id = ps.id;
  if p_restart then
    insert into pitch_sessions (startup_id, room_id, actual_no, status, started_by, is_override, override_reason)
    select startup_id, room_id, actual_no, 'pitch', a->>'name', is_override, override_reason
    from pitch_sessions where id = ps.id returning id into sid;
    perform _log(a, 'pitch.restart', ps.startup_id, ps.room_id, null,
      jsonb_build_object('voided_session', ps.id, 'session_id', sid), p_reason);
  else
    -- Back to the front of this room's on-deck list.
    update startups set status = 'on_deck', on_deck_room_id = ps.room_id, on_deck_at = now(),
      queue_pos = _pos_between(null, (select min(queue_pos) from startups where status in ('waiting','on_deck','hold'))),
      version = version + 1, updated_at = now()
    where id = ps.startup_id;
    perform _log(a, 'pitch.cancel', ps.startup_id, ps.room_id, null, jsonb_build_object('session_id', ps.id), p_reason);
  end if;
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('session_id', sid));
end $$;

-- Skip an on-deck startup who is not in the room. Second skip (by setting) = no-show.
create or replace function startup_skip(p_token text, p_req uuid, p_room int, p_startup int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; s startups; lim int; p3 numeric; p4 numeric; newpos numeric; outcome text;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  perform _can_run_room(a, p_room);
  select * into s from startups where id = p_startup for update;
  if not found then perform _err('NOT_FOUND', 'Startup not found.'); end if;
  if s.status <> 'on_deck' or s.on_deck_room_id is distinct from p_room then
    perform _err('STALE', s.name || ' is no longer on deck here. The screen has been refreshed.');
  end if;
  select skip_limit into lim from settings where id = 1;
  if s.skip_count + 1 >= lim then
    update startups set status = 'no_show', skip_count = skip_count + 1, on_deck_room_id = null,
      on_deck_at = null, version = version + 1, updated_at = now() where id = p_startup;
    outcome := 'no_show';
  else
    -- Three places further back in the same track.
    select max(queue_pos) filter (where rn = 3), max(queue_pos) filter (where rn = 4) into p3, p4
    from (select queue_pos, row_number() over (order by queue_pos) rn
          from startups where status = 'waiting' and track_id = s.track_id and id <> s.id) x;
    if p3 is null then
      newpos := coalesce((select max(queue_pos) from startups where status = 'waiting' and track_id = s.track_id and id <> s.id), s.queue_pos) + 0.5;
    else
      newpos := _pos_between(p3, p4);
    end if;
    update startups set status = 'waiting', skip_count = skip_count + 1, on_deck_room_id = null,
      on_deck_at = null, queue_pos = greatest(newpos, s.queue_pos), version = version + 1, updated_at = now()
    where id = p_startup;
    outcome := 'requeued';
  end if;
  perform _log(a, 'pitch.skip', p_startup, p_room, null,
    jsonb_build_object('outcome', outcome, 'skip_count', s.skip_count + 1), p_reason);
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('outcome', outcome));
end $$;
