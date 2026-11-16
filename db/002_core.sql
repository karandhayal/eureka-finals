-- Pitch Day: internal helpers (not callable from the API)

create or replace function _err(code text, msg text) returns void
language plpgsql as $$
begin
  raise exception '%', code || ': ' || msg using errcode = 'P0001';
end $$;

-- Every write takes this lock first, so writes run one at a time.
-- At event scale (a few writes per second) this costs nothing and removes
-- every race and deadlock between actions.
create or replace function _write_lock() returns void
language sql as $$ select pg_advisory_xact_lock(424242) $$;

create or replace function _idem_get(p_req uuid) returns jsonb
language sql stable as $$
  select result from request_log where request_id = p_req
$$;

create or replace function _idem_put(p_req uuid, p_result jsonb) returns jsonb
language plpgsql as $$
begin
  if p_req is not null then
    insert into request_log (request_id, result) values (p_req, p_result)
    on conflict (request_id) do nothing;
  end if;
  return p_result;
end $$;

-- Tell every open screen that something changed.
create or replace function _bump() returns void
language plpgsql as $$
declare s bigint;
begin
  update settings set change_seq = change_seq + 1, updated_at = now() where id = 1
  returning change_seq into s;
  begin
    perform realtime.send(jsonb_build_object('seq', s), 'changed', 'pitchday', false);
  exception when others then
    null; -- realtime not available (local tests) or not configured: polling covers it
  end;
end $$;

create or replace function _log(p_actor jsonb, p_action text, p_startup int, p_room int,
                                p_judge int, p_details jsonb, p_reason text) returns void
language sql as $$
  insert into activity_log (actor, actor_role, action, startup_id, room_id, judge_id, details, reason)
  values (coalesce(p_actor->>'name','system'), coalesce(p_actor->>'role','system'), p_action,
          p_startup, p_room, p_judge, coalesce(p_details,'{}'::jsonb), nullif(trim(p_reason),''))
$$;

-- Resolve a staff token. Returns {id,name,role,duty,room_id}.
create or replace function _staff(p_token text, p_roles text[] default null) returns jsonb
language plpgsql as $$
declare r record;
begin
  select s.id, s.name, s.role, s.duty, s.room_id, s.email into r
  from staff_tokens t join staff s on s.id = t.staff_id
  where t.token = p_token and t.expires_at > now() and s.active;
  if not found then
    perform _err('AUTH', 'Your session has ended. Please sign in again.');
  end if;
  if p_roles is not null and not (r.role = any(p_roles)) then
    perform _err('FORBIDDEN', 'Your role cannot do this.');
  end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'role', r.role, 'duty', r.duty,
                            'room_id', r.room_id, 'email', r.email);
end $$;

-- A coordinator may operate a room only if assigned to it; admins anywhere.
create or replace function _can_run_room(p_actor jsonb, p_room int) returns void
language plpgsql as $$
begin
  if p_actor->>'role' = 'admin' then return; end if;
  if (p_actor->>'room_id')::int is distinct from p_room then
    perform _err('FORBIDDEN', 'You are assigned to a different room. Ask an admin to move you.');
  end if;
end $$;

-- Place a startup between two queue positions.
create or replace function _pos_between(a numeric, b numeric) returns numeric
language sql immutable as $$
  select case
    when a is null and b is null then 1000
    when a is null then b - 1
    when b is null then a + 1
    else (a + b) / 2 end
$$;

-- Fill every open room's on-deck list from the global queue.
-- Rooms with the fewest on deck pick first; ties by room order.
create or replace function _refill_all() returns void
language plpgsql as $$
declare
  rm record;
  need int;
  cap int;
  pick int;
  progress boolean := true;
begin
  select on_deck into cap from settings where id = 1;
  -- Rooms over capacity (a cancelled pitch returned to the front, or the size was lowered)
  -- send their last on-deck startups back to the queue.
  update startups s set status = 'waiting', on_deck_room_id = null, on_deck_at = null, version = version + 1
  from (select id, row_number() over (partition by on_deck_room_id order by queue_pos, id) rn
        from startups where status = 'on_deck') x
  where s.id = x.id and x.rn > cap;
  -- Round-robin one startup at a time so rooms share the queue fairly.
  while progress loop
    progress := false;
    for rm in
      select r.id,
             (select count(*) from startups s where s.on_deck_room_id = r.id and s.status = 'on_deck') as n
      from rooms r
      where r.status = 'open'
      order by 2, r.sort, r.id
    loop
      need := cap - rm.n;
      continue when need <= 0;
      select s.id into pick
      from startups s
      where s.status = 'waiting'
        and s.track_id in (select track_id from room_tracks where room_id = rm.id)
        and (s.pinned_room_id is null or s.pinned_room_id = rm.id)
      order by s.queue_pos, s.id
      limit 1
      for update skip locked;
      if pick is not null then
        update startups set status = 'on_deck', on_deck_room_id = rm.id, on_deck_at = now(),
               version = version + 1, updated_at = now()
        where id = pick;
        progress := true;
        pick := null;
        exit; -- re-rank rooms after every pick
      end if;
    end loop;
  end loop;
end $$;

-- Return a startup to the waiting queue (keeps its queue position).
create or replace function _to_waiting(p_startup int) returns void
language sql as $$
  update startups set status = 'waiting', on_deck_room_id = null, on_deck_at = null,
         version = version + 1, updated_at = now()
  where id = p_startup
$$;

create or replace function _startup_json(s startups) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', s.id, 'eureka_id', s.eureka_id, 'name', s.name, 'email', s.email,
    'track_id', s.track_id, 'track', (select name from tracks where id = s.track_id),
    'status', s.status, 'ticket_no', s.ticket_no, 'queue_pos', s.queue_pos,
    'checked_in_at', s.checked_in_at, 'checked_in_by', s.checked_in_by,
    'on_deck_room_id', s.on_deck_room_id, 'pinned_room_id', s.pinned_room_id,
    'skip_count', s.skip_count, 'version', s.version)
$$;

-- Live session clock in seconds, computed on the server.
create or replace function _session_json(ps pitch_sessions) returns jsonb
language sql stable as $$
  select case when ps.id is null then null else jsonb_build_object(
    'id', ps.id, 'startup_id', ps.startup_id, 'room_id', ps.room_id, 'actual_no', ps.actual_no,
    'status', ps.status, 'phase_started_at', ps.phase_started_at,
    'phase_paused_s', ps.phase_paused_s, 'paused_at', ps.paused_at,
    'pitch_started_at', ps.pitch_started_at, 'pitch_ended_at', ps.pitch_ended_at,
    'qa_ended_at', ps.qa_ended_at, 'started_by', ps.started_by,
    'is_override', ps.is_override, 'override_reason', ps.override_reason,
    'elapsed_s', round(extract(epoch from (coalesce(ps.paused_at, now()) - ps.phase_started_at)) - ps.phase_paused_s)
  ) end
$$;

-- Weighted total on a 0-100 scale.
create or replace function _score_total(p_vals jsonb) returns numeric
language sql stable as $$
  select case when sum(c.weight) filter (where p_vals ? c.id::text) is null then null
    else round(100 * sum(c.weight * least((p_vals->>c.id::text)::numeric, c.max_score) / c.max_score)
                     filter (where p_vals ? c.id::text)
               / sum(c.weight) filter (where p_vals ? c.id::text), 2) end
  from criteria c
$$;
