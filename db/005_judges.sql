-- Pitch Day: judges and scoring

create or replace function judge_save(p_token text, p_req uuid, p_id int, p_name text, p_email text,
  p_phone text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; jid int;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  if coalesce(trim(p_name),'') = '' then perform _err('INVALID', 'Enter the judge''s name.'); end if;
  if coalesce(p_kind,'jury') not in ('jury','mentor','both') then perform _err('INVALID', 'Unknown type.'); end if;
  if p_id is null then
    insert into judges (name, email, phone, kind, added_by)
    values (trim(p_name), nullif(lower(trim(p_email)),''), nullif(trim(p_phone),''), coalesce(p_kind,'jury'), a->>'name')
    returning id into jid;
    perform _log(a, 'judge.add', null, null, jid, jsonb_build_object('name', p_name, 'kind', p_kind), null);
  else
    update judges set name = trim(p_name), email = nullif(lower(trim(p_email)),''),
      phone = nullif(trim(p_phone),''), kind = coalesce(p_kind, kind) where id = p_id returning id into jid;
    if jid is null then perform _err('NOT_FOUND', 'Judge not found.'); end if;
    perform _log(a, 'judge.edit', null, null, jid, jsonb_build_object('name', p_name, 'kind', p_kind), null);
  end if;
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('id', jid));
end $$;

create or replace function judges_import(p_token text, p_req uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; row jsonb; n int := 0; skipped int := 0; k text;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  for row in select * from jsonb_array_elements(coalesce(p_rows,'[]')) loop
    k := lower(coalesce(nullif(trim(row->>'kind'),''), 'jury'));
    if coalesce(trim(row->>'name'),'') = '' or k not in ('jury','mentor','both') then skipped := skipped + 1; continue; end if;
    if nullif(trim(row->>'email'),'') is not null and exists (select 1 from judges where email = lower(trim(row->>'email'))) then
      skipped := skipped + 1; continue;
    end if;
    insert into judges (name, email, phone, kind, added_by)
    values (trim(row->>'name'), nullif(lower(trim(row->>'email')),''), nullif(trim(row->>'phone'),''), k, a->>'name');
    n := n + 1;
  end loop;
  perform _log(a, 'judges.import', null, null, null, jsonb_build_object('added', n, 'skipped', skipped), null);
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('added', n, 'skipped', skipped));
end $$;

-- Attendance, room and certificate. Room changes are recorded so scoring rights follow the judge.
create or replace function judge_update(p_token text, p_req uuid, p_id int, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; j judges; newroom int;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  select * into j from judges where id = p_id for update;
  if not found then perform _err('NOT_FOUND', 'Judge not found.'); end if;
  if p_patch ? 'status' then
    if p_patch->>'status' not in ('not_arrived','arrived','left') then perform _err('INVALID', 'Unknown status.'); end if;
    update judges set status = p_patch->>'status' where id = p_id;
  end if;
  if p_patch ? 'certificate' then
    update judges set certificate = (p_patch->>'certificate')::boolean where id = p_id;
  end if;
  if p_patch ? 'room_id' then
    newroom := nullif(p_patch->>'room_id','')::int;
    if newroom is not null and not exists (select 1 from rooms where id = newroom) then
      perform _err('INVALID', 'Room not found.');
    end if;
    if newroom is distinct from j.room_id then
      update judge_assignments set to_at = now() where judge_id = p_id and to_at is null;
      if newroom is not null then insert into judge_assignments (judge_id, room_id) values (p_id, newroom); end if;
      update judges set room_id = newroom where id = p_id;
    end if;
  end if;
  perform _log(a, 'judge.update', null, coalesce(newroom, j.room_id), p_id, p_patch, null);
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
end $$;

create or replace function judge_reissue(p_token text, p_req uuid, p_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; tok text;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  tok := encode(gen_random_bytes(12), 'hex');
  update judges set token = tok where id = p_id;
  if not found then perform _err('NOT_FOUND', 'Judge not found.'); end if;
  perform _log(a, 'judge.reissue', null, null, p_id, '{}', null);
  return _idem_put(p_req, jsonb_build_object('token', tok));
end $$;

create or replace function judges_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
declare a jsonb;
begin
  a := _staff(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', j.id, 'name', j.name, 'email', j.email, 'phone', j.phone, 'kind', j.kind,
    'token', j.token, 'status', j.status, 'room_id', j.room_id, 'certificate', j.certificate,
    'added_by', j.added_by,
    'scored', (select count(*) from scores s where s.judge_id = j.id)) order by j.name)
    from judges j), '[]');
end $$;

create or replace function criteria_list() returns jsonb
language sql security definer set search_path = public, extensions stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description,
    'max_score', max_score, 'weight', weight) order by sort, id), '[]') from criteria
$$;

-- Replace the rubric. Once any score exists, p_force is needed and existing totals are recomputed.
create or replace function criteria_save(p_token text, p_req uuid, p_items jsonb, p_force boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; it jsonb; i int := 0; keep int[] := '{}'; cid int;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  if exists (select 1 from scores) and not coalesce(p_force,false) then
    perform _err('SCORES_EXIST', 'Judges have already scored. Confirm to change the rubric.');
  end if;
  if jsonb_array_length(coalesce(p_items,'[]')) = 0 then perform _err('INVALID', 'Add at least one criterion.'); end if;
  for it in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    if coalesce(trim(it->>'name'),'') = '' then perform _err('INVALID', 'Criterion ' || i || ' needs a name.'); end if;
    if nullif(it->>'id','') is not null and exists (select 1 from criteria where id = (it->>'id')::int) then
      update criteria set name = trim(it->>'name'), description = nullif(trim(it->>'description'),''),
        max_score = (it->>'max_score')::int, weight = (it->>'weight')::numeric, sort = i
      where id = (it->>'id')::int returning id into cid;
    else
      insert into criteria (name, description, max_score, weight, sort)
      values (trim(it->>'name'), nullif(trim(it->>'description'),''), (it->>'max_score')::int, (it->>'weight')::numeric, i)
      returning id into cid;
    end if;
    keep := keep || cid;
  end loop;
  delete from criteria where not (id = any(keep));
  update scores set total = _score_total(vals) where not recused;
  perform _log(a, 'criteria.save', null, null, null, jsonb_build_object('items', p_items, 'forced', p_force), null);
  perform _bump();
  return _idem_put(p_req, criteria_list());
exception when check_violation or invalid_text_representation then
  perform _err('INVALID', 'Maximum must be 1-100 and weight above 0.');
end $$;

-- Startups this judge may score: pitched (not cancelled) in a room while the judge was assigned there.
create or replace function _judge_eligible(p_judge int) returns table (startup_id int, room_id int, started_at timestamptz)
language sql stable as $$
  select distinct on (ps.startup_id) ps.startup_id, ps.room_id, ps.pitch_started_at
  from pitch_sessions ps
  join judge_assignments ja on ja.room_id = ps.room_id and ja.judge_id = p_judge
   and ps.pitch_started_at >= ja.from_at - interval '2 minutes'
   and (ja.to_at is null or ps.pitch_started_at <= ja.to_at)
  where ps.status <> 'cancelled'
  order by ps.startup_id, ps.pitch_started_at desc
$$;

create or replace function judge_me(p_jtoken text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
declare j judges; cur jsonb; room jsonb;
begin
  select * into j from judges where token = p_jtoken;
  if not found then perform _err('AUTH', 'This judge link is no longer valid. Ask a coordinator for a new one.'); end if;
  select jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status) into room from rooms r where r.id = j.room_id;
  select jsonb_build_object('session', _session_json(ps), 'startup', jsonb_build_object('id', s.id, 'name', s.name,
           'eureka_id', s.eureka_id, 'track', t.name)) into cur
  from pitch_sessions ps join startups s on s.id = ps.startup_id join tracks t on t.id = s.track_id
  where ps.room_id = j.room_id and ps.status in ('pitch','qa');
  return jsonb_build_object(
    'judge', jsonb_build_object('id', j.id, 'name', j.name, 'kind', j.kind, 'status', j.status),
    'room', room, 'current', cur, 'criteria', criteria_list(), 'now', now(),
    'can_score', j.kind in ('jury','both'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('startup_id', s.id, 'name', s.name, 'eureka_id', s.eureka_id,
        'track', t.name, 'track_locked', t.results_locked, 'room', rm.name, 'pitched_at', e.started_at,
        'live', exists (select 1 from pitch_sessions p2 where p2.startup_id = s.id and p2.status in ('pitch','qa')),
        'score', case when sc.id is null then null else jsonb_build_object('vals', sc.vals, 'comment', sc.comment,
                  'recused', sc.recused, 'total', sc.total, 'updated_at', sc.updated_at) end)
        order by e.started_at desc)
      from _judge_eligible(j.id) e join startups s on s.id = e.startup_id join tracks t on t.id = s.track_id
      join rooms rm on rm.id = e.room_id
      left join scores sc on sc.judge_id = j.id and sc.startup_id = s.id), '[]'));
end $$;

create or replace function score_submit(p_jtoken text, p_req uuid, p_startup int, p_vals jsonb,
  p_comment text, p_recused boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare j judges; r jsonb; s startups; c record; v numeric; tot numeric; existed boolean; rid int;
begin
  perform _write_lock();
  select * into j from judges where token = p_jtoken;
  if not found then perform _err('AUTH', 'This judge link is no longer valid.'); end if;
  r := _idem_get(p_req); if r is not null then return r; end if;
  if j.kind = 'mentor' then perform _err('FORBIDDEN', 'Mentors do not score.'); end if;
  select * into s from startups where id = p_startup;
  if not found then perform _err('NOT_FOUND', 'Startup not found.'); end if;
  if (select results_locked from tracks where id = s.track_id) then
    perform _err('LOCKED', 'Results for this track are locked. Scores can no longer change.');
  end if;
  select room_id into rid from _judge_eligible(j.id) where startup_id = p_startup;
  if rid is null then
    perform _err('FORBIDDEN', 'You can only score startups that pitched in your room while you were assigned to it.');
  end if;
  if not coalesce(p_recused, false) then
    for c in select * from criteria loop
      if not (p_vals ? c.id::text) then perform _err('INCOMPLETE', 'Score every criterion before submitting.'); end if;
      v := (p_vals->>c.id::text)::numeric;
      if v < 0 or v > c.max_score then perform _err('INVALID', c.name || ' must be between 0 and ' || c.max_score || '.'); end if;
    end loop;
    if not exists (select 1 from criteria) then perform _err('INVALID', 'No scoring rubric has been set yet.'); end if;
    tot := _score_total(p_vals);
  end if;
  existed := exists (select 1 from scores where judge_id = j.id and startup_id = p_startup);
  insert into scores (judge_id, startup_id, room_id, vals, comment, recused, total)
  values (j.id, p_startup, rid, case when coalesce(p_recused,false) then '{}' else p_vals end,
          nullif(trim(p_comment),''), coalesce(p_recused,false), tot)
  on conflict (judge_id, startup_id) do update set vals = excluded.vals, comment = excluded.comment,
    recused = excluded.recused, total = excluded.total, updated_at = now();
  perform _log(jsonb_build_object('name', j.name, 'role', 'judge'),
    case when p_recused then 'score.recuse' when existed then 'score.update' else 'score.submit' end,
    p_startup, rid, j.id, jsonb_build_object('total', tot), null);
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('total', tot, 'updated', existed));
end $$;

create or replace function results_lock(p_token text, p_req uuid, p_track int, p_lock boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  update tracks set results_locked = p_lock where id = p_track;
  perform _log(a, case when p_lock then 'results.lock' else 'results.unlock' end, null, null, null,
    jsonb_build_object('track_id', p_track), null);
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
end $$;

-- Results per track: raw average of judge totals, and a normalised score per judge (z-score -> 50 +/- 10).
create or replace function results(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
begin
  perform _staff(p_token, array['admin']);
  return jsonb_build_object(
    'criteria', criteria_list(),
    'tracks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'locked', results_locked) order by sort, id) from tracks), '[]'),
    'rows', coalesce((
      with js as (
        select judge_id, avg(total) m, stddev_samp(total) sd, count(*) n
        from scores where not recused and total is not null group by judge_id),
      sc as (
        select s.*, case when js.n >= 3 and js.sd > 0 then 50 + 10 * (s.total - js.m) / js.sd else 50 end z
        from scores s join js on js.judge_id = s.judge_id where not s.recused and s.total is not null)
      select jsonb_agg(x order by x->>'track_id', (x->>'raw')::numeric desc nulls last)
      from (
        select jsonb_build_object(
          'startup_id', st.id, 'name', st.name, 'eureka_id', st.eureka_id, 'track_id', st.track_id,
          'status', st.status,
          'raw', round(avg(sc.total), 2), 'normalised', round(avg(sc.z), 2),
          'n', count(sc.id), 'spread', round(coalesce(max(sc.total) - min(sc.total), 0), 2),
          'recused', (select count(*) from scores r2 where r2.startup_id = st.id and r2.recused),
          'judges', coalesce(jsonb_agg(jsonb_build_object('judge', jg.name, 'total', sc.total, 'vals', sc.vals,
                     'comment', sc.comment) order by jg.name) filter (where sc.id is not null), '[]')
        ) x
        from startups st
        left join sc on sc.startup_id = st.id
        left join judges jg on jg.id = sc.judge_id
        where st.status = 'done' or exists (select 1 from scores s3 where s3.startup_id = st.id)
        group by st.id
      ) q), '[]'));
end $$;
