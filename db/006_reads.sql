-- Pitch Day: read models for each screen

create or replace function _settings_json() returns jsonb
language sql stable as $$
  select jsonb_build_object('event_name', event_name, 'pitch_s', pitch_s, 'qa_s', qa_s,
    'changeover_s', changeover_s, 'on_deck', on_deck, 'skip_limit', skip_limit,
    'overrun_alert_s', overrun_alert_s, 'seq', change_seq) from settings where id = 1
$$;

-- Average real cycle (start to finish + changeover) from the last 12 finished pitches.
create or replace function _cycle_s() returns numeric
language sql stable as $$
  select coalesce(
    (select avg(extract(epoch from qa_ended_at - pitch_started_at)) from
       (select * from pitch_sessions where status = 'done' order by qa_ended_at desc limit 12) x
     having count(*) >= 3),
    (select (pitch_s + qa_s)::numeric from settings where id = 1))
  + (select changeover_s from settings where id = 1)
$$;

create or replace function _room_json(p_room int, p_detail boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', r.id, 'name', r.name, 'status', r.status, 'version', r.version, 'sort', r.sort,
    'display_code', r.display_code, 'last_ended_at', r.last_ended_at,
    'track_ids', coalesce((select jsonb_agg(track_id order by track_id) from room_tracks where room_id = r.id), '[]'),
    'tracks', coalesce((select jsonb_agg(t.name order by t.sort, t.id) from room_tracks rt join tracks t on t.id = rt.track_id where rt.room_id = r.id), '[]'),
    'live', (select _session_json(ps) || jsonb_build_object('startup', _startup_json(s))
             from pitch_sessions ps join startups s on s.id = ps.startup_id
             where ps.room_id = r.id and ps.status in ('pitch','qa')),
    'on_deck', coalesce((select jsonb_agg(_startup_json(s) order by s.queue_pos, s.id)
             from startups s where s.on_deck_room_id = r.id and s.status = 'on_deck'), '[]'),
    'judges', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'status', j.status, 'kind', j.kind) order by j.name)
             from judges j where j.room_id = r.id), '[]'),
    'last', (select jsonb_build_object('startup', s.name, 'startup_id', s.id, 'ended_at', ps.qa_ended_at,
               'scores_in', (select count(*) from scores sc where sc.startup_id = s.id),
               'scorers', (select count(*) from judges j where j.room_id = r.id and j.status = 'arrived' and j.kind <> 'mentor'))
             from pitch_sessions ps join startups s on s.id = ps.startup_id
             where ps.room_id = r.id and ps.status = 'done' order by ps.qa_ended_at desc limit 1),
    'done_count', (select count(*) from pitch_sessions ps where ps.room_id = r.id and ps.status = 'done'),
    'history', case when p_detail then coalesce((select jsonb_agg(h order by h->>'pitch_started_at' desc) from (
               select _session_json(ps) || jsonb_build_object('startup_name', s.name, 'eureka_id', s.eureka_id,
                 'cancel_reason', ps.cancel_reason, 'qa_ended_at', ps.qa_ended_at, 'ended_by', ps.ended_by) h
               from pitch_sessions ps join startups s on s.id = ps.startup_id
               where ps.room_id = r.id and ps.status in ('done','cancelled')
               order by ps.pitch_started_at desc limit 30) hh), '[]') end
  ) from rooms r where r.id = p_room
$$;

create or replace function _alerts() returns jsonb
language sql stable as $$
  with st as (select * from settings where id = 1)
  select coalesce(jsonb_agg(a), '[]') from (
    -- Waiting startups with no open room for their track
    select jsonb_build_object('level','critical','kind','no_room','track_id', t.id,
      'text', count(*) || ' waiting in ' || t.name || ' but no open room serves this track') a
    from startups s join tracks t on t.id = s.track_id
    where s.status = 'waiting'
      and not exists (select 1 from room_tracks rt join rooms r on r.id = rt.room_id
                      where rt.track_id = t.id and r.status = 'open')
    group by t.id, t.name
    union all
    -- Pitch running long
    select jsonb_build_object('level','warning','kind','overrun','room_id', r.id,
      'text', r.name || ': ' || s.name || ' is ' ||
        round((extract(epoch from (coalesce(ps.paused_at, now()) - ps.phase_started_at)) - ps.phase_paused_s
               - case ps.status when 'pitch' then st.pitch_s else st.qa_s end) / 60.0, 1) || ' min over')
    from pitch_sessions ps join rooms r on r.id = ps.room_id join startups s on s.id = ps.startup_id, st
    where ps.status in ('pitch','qa') and ps.paused_at is null
      and extract(epoch from (now() - ps.phase_started_at)) - ps.phase_paused_s
          > case ps.status when 'pitch' then st.pitch_s else st.qa_s end + st.overrun_alert_s
    union all
    -- Room idle with someone on deck
    select jsonb_build_object('level','warning','kind','idle','room_id', r.id,
      'text', r.name || ' has been idle ' || round(extract(epoch from now() - coalesce(r.last_ended_at, min(s.on_deck_at)))/60) || ' min with startups on deck')
    from rooms r join startups s on s.on_deck_room_id = r.id and s.status = 'on_deck', st
    where r.status = 'open'
      and not exists (select 1 from pitch_sessions ps where ps.room_id = r.id and ps.status in ('pitch','qa'))
    group by r.id, r.name, r.last_ended_at, st.changeover_s
    having extract(epoch from now() - coalesce(r.last_ended_at, min(s.on_deck_at))) > st.changeover_s + 60
    union all
    -- Open room with no judge present
    select jsonb_build_object('level','warning','kind','no_judge','room_id', r.id,
      'text', r.name || ' is open with no judge marked arrived')
    from rooms r where r.status = 'open'
      and exists (select 1 from judges)
      and not exists (select 1 from judges j where j.room_id = r.id and j.status = 'arrived' and j.kind <> 'mentor')
    union all
    -- Open room serving no track
    select jsonb_build_object('level','warning','kind','no_tracks','room_id', r.id,
      'text', r.name || ' is open but serves no track')
    from rooms r where r.status = 'open' and not exists (select 1 from room_tracks rt where rt.room_id = r.id)
  ) x
$$;

create or replace function admin_state(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
declare a jsonb;
begin
  a := _staff(p_token);
  return jsonb_build_object(
    'now', now(), 'me', a, 'settings', _settings_json(),
    'cycle_s', round(_cycle_s()),
    'tracks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'locked', t.results_locked,
        'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from startups where track_id = t.id group by status) c))
        order by t.sort, t.id) from tracks t), '[]'),
    'rooms', coalesce((select jsonb_agg(_room_json(r.id, false) order by r.sort, r.id) from rooms r), '[]'),
    'startups', coalesce((select jsonb_agg(_startup_json(s) order by s.queue_pos nulls last, s.name) from startups s), '[]'),
    'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from startups group by status) c),
    'alerts', _alerts(),
    'judges', jsonb_build_object(
       'total', (select count(*) from judges),
       'arrived', (select count(*) from judges where status = 'arrived')),
    'criteria', criteria_list(),
    'hall_code', case when a->>'role' = 'admin' then (select hall_code from settings where id = 1) end,
    'activity', coalesce((select jsonb_agg(l order by (l->>'id')::bigint desc) from (
       select to_jsonb(al) || jsonb_build_object('startup', s.name, 'room', r.name) l
       from activity_log al left join startups s on s.id = al.startup_id left join rooms r on r.id = al.room_id
       order by al.id desc limit 40) x), '[]'));
end $$;

-- Room console: one room, plus who may be overridden in.
create or replace function room_state(p_token text, p_room int) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
declare a jsonb;
begin
  a := _staff(p_token);
  if not exists (select 1 from rooms where id = p_room) then perform _err('NOT_FOUND', 'Room not found.'); end if;
  return jsonb_build_object('now', now(), 'me', a, 'settings', _settings_json(),
    'room', _room_json(p_room, true),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'status', status) order by sort, id) from rooms), '[]'),
    'queue_ahead', (select count(*) from startups s where s.status = 'waiting'
                      and s.track_id in (select track_id from room_tracks where room_id = p_room)));
end $$;

-- Override search: any startup that could pitch now.
create or replace function room_candidates(p_token text, p_room int, p_q text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
declare q text := trim(coalesce(p_q,''));
begin
  perform _staff(p_token);
  return coalesce((select jsonb_agg(_startup_json(s) || jsonb_build_object(
      'serves', exists (select 1 from room_tracks rt where rt.room_id = p_room and rt.track_id = s.track_id),
      'room_name', (select name from rooms where id = s.on_deck_room_id))
      order by (s.on_deck_room_id = p_room) desc nulls last, s.queue_pos nulls last)
    from (select * from startups s
          where s.status in ('waiting','on_deck','hold','no_show','registered')
            and (q = '' or s.eureka_id ilike '%' || q || '%' or s.name ilike '%' || q || '%')
          order by s.queue_pos nulls last limit 40) s), '[]');
end $$;

-- Projector screen for a room; opened by its display code, no sign-in.
create or replace function room_display(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
declare rid int;
begin
  select id into rid from rooms where display_code = p_code;
  if rid is null then perform _err('NOT_FOUND', 'This display link is not valid.'); end if;
  return jsonb_build_object('now', now(), 'settings', _settings_json() - 'seq',
    'room', (select jsonb_build_object('id', id, 'name', name, 'status', status, 'last_ended_at', last_ended_at) from rooms where id = rid),
    'live', (select _session_json(ps) || jsonb_build_object('name', s.name, 'eureka_id', s.eureka_id,
               'track', (select name from tracks where id = s.track_id))
             from pitch_sessions ps join startups s on s.id = ps.startup_id
             where ps.room_id = rid and ps.status in ('pitch','qa')),
    'next', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'eureka_id', s.eureka_id) order by s.queue_pos)
             from startups s where s.on_deck_room_id = rid and s.status = 'on_deck'), '[]'));
end $$;

-- Waiting-area board.
create or replace function hall_board(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
begin
  if not exists (select 1 from settings where hall_code = p_code) then
    perform _err('NOT_FOUND', 'This board link is not valid.');
  end if;
  return jsonb_build_object('now', now(), 'settings', _settings_json() - 'seq',
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'status', r.status,
       'live', (select jsonb_build_object('name', s.name, 'eureka_id', s.eureka_id, 'phase', ps.status)
                from pitch_sessions ps join startups s on s.id = ps.startup_id
                where ps.room_id = r.id and ps.status in ('pitch','qa')),
       'next', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'eureka_id', s.eureka_id) order by s.queue_pos)
                from startups s where s.on_deck_room_id = r.id and s.status = 'on_deck'), '[]'))
       order by r.sort, r.id) from rooms r where r.status <> 'closed'), '[]'));
end $$;

-- ---------- Startup self-service ----------

create or replace function startup_access(p_eureka_id text, p_email text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  select token into tok from startups
  where eureka_id = upper(regexp_replace(coalesce(p_eureka_id,''), '\s', '', 'g'))
    and email = lower(trim(coalesce(p_email,'')));
  if tok is null then
    perform pg_sleep(0.3);
    perform _err('NOT_FOUND', 'No startup matches that Eureka! ID and email.');
  end if;
  return jsonb_build_object('token', tok);
end $$;

create or replace function startup_me(p_stoken text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
declare s startups; ahead int; nrooms int; room jsonb; sess jsonb;
begin
  select * into s from startups where token = p_stoken;
  if not found then perform _err('AUTH', 'This link is not valid. Look up your startup again.'); end if;
  if s.status = 'waiting' then
    select count(*) into ahead from startups x
    where x.track_id = s.track_id and ((x.status = 'waiting' and x.queue_pos < s.queue_pos) or x.status = 'on_deck');
    select count(*) into nrooms from rooms r join room_tracks rt on rt.room_id = r.id
    where rt.track_id = s.track_id and r.status = 'open';
  end if;
  if s.on_deck_room_id is not null and s.status in ('on_deck','pitching') then
    select jsonb_build_object('id', id, 'name', name) into room from rooms where id = s.on_deck_room_id;
  end if;
  select jsonb_build_object('status', ps.status, 'room', r.name, 'actual_no', ps.actual_no,
           'started_at', ps.pitch_started_at, 'ended_at', ps.qa_ended_at) into sess
  from pitch_sessions ps join rooms r on r.id = ps.room_id
  where ps.startup_id = s.id and ps.status <> 'cancelled' order by ps.id desc limit 1;
  return jsonb_build_object('now', now(),
    'event_name', (select event_name from settings where id = 1),
    'startup', jsonb_build_object('name', s.name, 'eureka_id', s.eureka_id,
       'track', (select name from tracks where id = s.track_id), 'status', s.status,
       'ticket_no', s.ticket_no, 'checked_in_at', s.checked_in_at, 'on_deck_at', s.on_deck_at),
    'room', room, 'session', sess,
    'ahead', ahead, 'rooms_for_track', nrooms,
    'eta_s', case when s.status = 'waiting' and nrooms > 0 then round(ceil((ahead + 1)::numeric / nrooms) * _cycle_s()) end,
    'qr', 'PD:' || s.eureka_id);
end $$;

-- ---------- Admin: activity, export, reset ----------

create or replace function activity_list(p_token text, p_filter jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
declare q text := nullif(trim(coalesce(p_filter->>'q','')),'');
begin
  perform _staff(p_token, array['admin']);
  return coalesce((select jsonb_agg(l order by (l->>'id')::bigint desc) from (
    select to_jsonb(al) || jsonb_build_object('startup', s.name, 'eureka_id', s.eureka_id, 'room', r.name, 'judge', j.name) l
    from activity_log al
    left join startups s on s.id = al.startup_id
    left join rooms r on r.id = al.room_id
    left join judges j on j.id = al.judge_id
    where (p_filter->>'action' is null or al.action like (p_filter->>'action') || '%')
      and (p_filter->>'room_id' is null or al.room_id = (p_filter->>'room_id')::int)
      and (p_filter->>'overrides' is null or al.action = 'pitch.override')
      and (q is null or al.actor ilike '%'||q||'%' or s.name ilike '%'||q||'%' or s.eureka_id ilike '%'||q||'%'
           or coalesce(al.reason,'') ilike '%'||q||'%' or al.action ilike '%'||q||'%')
    order by al.id desc limit 500) x), '[]');
end $$;

create or replace function export_data(p_token text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
begin
  perform _staff(p_token, array['admin']);
  if p_kind = 'attendance' then
    return (select coalesce(jsonb_agg(jsonb_build_object('eureka_id', s.eureka_id, 'startup_name', s.name, 'email', s.email,
      'track', t.name, 'status', s.status, 'ticket_no', s.ticket_no, 'checked_in_at', s.checked_in_at,
      'checked_in_by', s.checked_in_by, 'skips', s.skip_count) order by s.ticket_no nulls last, s.name), '[]')
      from startups s join tracks t on t.id = s.track_id);
  elsif p_kind = 'pitches' then
    return (select coalesce(jsonb_agg(jsonb_build_object('actual_no', ps.actual_no, 'eureka_id', s.eureka_id,
      'startup_name', s.name, 'track', t.name, 'room', r.name, 'status', ps.status, 'ticket_no', s.ticket_no,
      'override', ps.is_override, 'override_reason', ps.override_reason, 'started_by', ps.started_by,
      'pitch_started_at', ps.pitch_started_at, 'pitch_ended_at', ps.pitch_ended_at, 'qa_ended_at', ps.qa_ended_at,
      'paused_s', round(ps.total_paused_s), 'cancel_reason', ps.cancel_reason) order by ps.id), '[]')
      from pitch_sessions ps join startups s on s.id = ps.startup_id join tracks t on t.id = s.track_id
      join rooms r on r.id = ps.room_id);
  elsif p_kind = 'scores' then
    return (select coalesce(jsonb_agg(jsonb_build_object('eureka_id', s.eureka_id, 'startup_name', s.name,
      'track', t.name, 'judge', j.name, 'room', r.name, 'total', sc.total, 'recused', sc.recused,
      'values', sc.vals, 'comment', sc.comment, 'updated_at', sc.updated_at) order by t.name, s.name, j.name), '[]')
      from scores sc join startups s on s.id = sc.startup_id join tracks t on t.id = s.track_id
      join judges j on j.id = sc.judge_id left join rooms r on r.id = sc.room_id);
  elsif p_kind = 'log' then
    return (select coalesce(jsonb_agg(jsonb_build_object('at', al.at, 'actor', al.actor, 'role', al.actor_role,
      'action', al.action, 'startup', s.eureka_id, 'room', r.name, 'reason', al.reason, 'details', al.details) order by al.id), '[]')
      from activity_log al left join startups s on s.id = al.startup_id left join rooms r on r.id = al.room_id);
  elsif p_kind = 'links' then
    return (select coalesce(jsonb_agg(jsonb_build_object('eureka_id', s.eureka_id, 'startup_name', s.name,
      'email', s.email, 'token', s.token) order by s.eureka_id), '[]') from startups s);
  elsif p_kind = 'judges' then
    return (select coalesce(jsonb_agg(jsonb_build_object('name', j.name, 'email', j.email, 'phone', j.phone, 'kind', j.kind,
      'status', j.status, 'room', r.name, 'certificate', j.certificate, 'token', j.token) order by j.name), '[]')
      from judges j left join rooms r on r.id = j.room_id);
  end if;
  perform _err('INVALID', 'Unknown export.');
end $$;

-- p_scope: 'floor' clears the day's activity but keeps startups, rooms, judges and rubric;
--          'all' also removes startups, judges, rooms and tracks (staff, settings and rubric stay).
create or replace function event_reset(p_token text, p_confirm text, p_scope text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  if p_confirm <> 'RESET' then perform _err('INVALID', 'Type RESET to confirm.'); end if;
  delete from scores where true;
  delete from pitch_sessions where true;
  delete from judge_assignments where true;
  delete from request_log where true;
  delete from activity_log where true;
  if p_scope = 'all' then
    delete from startups where true;
    delete from judges where true;
    delete from rooms where true;
    delete from tracks where true;
  else
    update startups set status = 'registered', checked_in_at = null, checked_in_by = null, ticket_no = null,
      queue_pos = null, on_deck_room_id = null, on_deck_at = null, pinned_room_id = null, skip_count = 0,
      version = version + 1 where true;
    update judges set status = 'not_arrived', room_id = null, certificate = false where true;
  end if;
  update tracks set results_locked = false where true;
  update rooms set last_ended_at = null where true;
  perform setval('ticket_seq', 1, false);
  perform setval('actual_seq', 1, false);
  perform _log(a, 'event.reset', null, null, null, jsonb_build_object('scope', p_scope), null);
  perform _bump();
  return '{"ok":true}';
end $$;
