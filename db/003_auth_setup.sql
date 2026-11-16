-- Pitch Day: sign-in, staff, setup, CSV import

create or replace function setup_status() returns jsonb
language sql security definer set search_path = public, extensions stable as $$
  select jsonb_build_object('needs_admin', not exists (select 1 from staff),
                            'event_name', (select event_name from settings where id = 1))
$$;

-- Works only once, on an empty event.
create or replace function setup_first_admin(p_name text, p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare sid int; tok text;
begin
  perform _write_lock();
  if exists (select 1 from staff) then
    perform _err('EXISTS', 'An admin already exists. Sign in instead.');
  end if;
  if length(coalesce(p_password,'')) < 8 then
    perform _err('INVALID', 'Password must be at least 8 characters.');
  end if;
  if coalesce(trim(p_name),'') = '' or position('@' in coalesce(p_email,'')) = 0 then
    perform _err('INVALID', 'Enter a name and a valid email.');
  end if;
  insert into staff (name, email, pass_hash, role)
  values (trim(p_name), lower(trim(p_email)), crypt(p_password, gen_salt('bf', 8)), 'admin')
  returning id into sid;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into staff_tokens (token, staff_id) values (tok, sid);
  perform _log(jsonb_build_object('name', trim(p_name), 'role', 'admin'), 'setup.first_admin', null, null, null, '{}', null);
  return jsonb_build_object('token', tok, 'me', _staff(tok));
end $$;

create or replace function staff_login(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r staff; tok text;
begin
  select * into r from staff where email = lower(trim(p_email)) and active;
  if not found or r.pass_hash <> crypt(p_password, r.pass_hash) then
    perform pg_sleep(0.3);
    perform _err('AUTH', 'Email or password is incorrect.');
  end if;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into staff_tokens (token, staff_id) values (tok, r.id);
  delete from staff_tokens where expires_at < now();
  return jsonb_build_object('token', tok, 'me', _staff(tok));
end $$;

create or replace function staff_logout(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from staff_tokens where token = p_token
$$;

create or replace function staff_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
begin
  return _staff(p_token);
end $$;

-- Cheap change counter every screen polls.
create or replace function poll() returns jsonb
language sql security definer set search_path = public, extensions stable as $$
  select jsonb_build_object('seq', change_seq, 'now', now()) from settings where id = 1
$$;

-- ---------- Staff management (admin) ----------

create or replace function staff_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions stable as $$
begin
  perform _staff(p_token, array['admin']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'email', email,
          'role', role, 'duty', duty, 'room_id', room_id, 'active', active) order by role, name)
          from staff), '[]');
end $$;

create or replace function staff_save(p_token text, p_req uuid, p_id int, p_name text, p_email text,
  p_role text, p_duty text, p_room_id int, p_active boolean, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; sid int;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  if coalesce(trim(p_name),'') = '' or position('@' in coalesce(p_email,'')) = 0 then
    perform _err('INVALID', 'Enter a name and a valid email.');
  end if;
  if p_role not in ('admin','coordinator') then perform _err('INVALID', 'Unknown role.'); end if;
  if p_password is not null and p_password <> '' and length(p_password) < 8 then
    perform _err('INVALID', 'Password must be at least 8 characters.');
  end if;
  if p_id is null then
    if coalesce(p_password,'') = '' then perform _err('INVALID', 'Set a password for the new account.'); end if;
    if exists (select 1 from staff where email = lower(trim(p_email))) then
      perform _err('EXISTS', 'Someone already uses that email.');
    end if;
    insert into staff (name, email, pass_hash, role, duty, room_id, active)
    values (trim(p_name), lower(trim(p_email)), crypt(p_password, gen_salt('bf', 8)), p_role,
            nullif(p_duty,''), p_room_id, coalesce(p_active, true))
    returning id into sid;
  else
    if p_id = (a->>'id')::int and (p_role <> 'admin' or p_active is false) then
      perform _err('INVALID', 'You cannot remove your own admin access.');
    end if;
    update staff set name = trim(p_name), email = lower(trim(p_email)), role = p_role,
      duty = nullif(p_duty,''), room_id = p_room_id, active = coalesce(p_active, true),
      pass_hash = case when coalesce(p_password,'') <> '' then crypt(p_password, gen_salt('bf', 8)) else pass_hash end
    where id = p_id returning id into sid;
    if sid is null then perform _err('NOT_FOUND', 'Account not found.'); end if;
    if p_active is false then delete from staff_tokens where staff_id = sid; end if;
  end if;
  perform _log(a, 'staff.save', null, p_room_id, null,
    jsonb_build_object('staff_id', sid, 'name', p_name, 'role', p_role, 'duty', p_duty, 'room_id', p_room_id), null);
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('id', sid));
end $$;

-- Coordinators can change their own duty and room (desk <-> a room).
create or replace function staff_set_duty(p_token text, p_req uuid, p_duty text, p_room_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  if p_duty not in ('desk','room','floor') then perform _err('INVALID', 'Unknown duty.'); end if;
  if p_duty = 'room' and not exists (select 1 from rooms where id = p_room_id) then
    perform _err('INVALID', 'Pick a room.');
  end if;
  update staff set duty = p_duty, room_id = case when p_duty = 'room' then p_room_id else null end
  where id = (a->>'id')::int;
  perform _log(a, 'staff.duty', null, p_room_id, null, jsonb_build_object('duty', p_duty), null);
  perform _bump();
  return _idem_put(p_req, _staff(p_token));
end $$;

-- ---------- Event settings ----------

create or replace function settings_save(p_token text, p_req uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  update settings set
    event_name = coalesce(nullif(trim(p_settings->>'event_name'),''), event_name),
    pitch_s = coalesce((p_settings->>'pitch_s')::int, pitch_s),
    qa_s = coalesce((p_settings->>'qa_s')::int, qa_s),
    changeover_s = coalesce((p_settings->>'changeover_s')::int, changeover_s),
    on_deck = coalesce((p_settings->>'on_deck')::int, on_deck),
    skip_limit = coalesce((p_settings->>'skip_limit')::int, skip_limit),
    overrun_alert_s = coalesce((p_settings->>'overrun_alert_s')::int, overrun_alert_s)
  where id = 1;
  perform _log(a, 'settings.save', null, null, null, p_settings, null);
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
exception when check_violation then
  perform _err('INVALID', 'One of the values is out of range.');
end $$;

-- ---------- Tracks ----------

create or replace function track_save(p_token text, p_req uuid, p_id int, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; tid int;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  if coalesce(trim(p_name),'') = '' then perform _err('INVALID', 'Enter a track name.'); end if;
  if exists (select 1 from tracks where lower(name) = lower(trim(p_name)) and id is distinct from p_id) then
    perform _err('EXISTS', 'A track with that name already exists.');
  end if;
  if p_id is null then
    insert into tracks (name, sort) values (trim(p_name), coalesce((select max(sort)+1 from tracks),0)) returning id into tid;
  else
    update tracks set name = trim(p_name) where id = p_id returning id into tid;
  end if;
  perform _log(a, 'track.save', null, null, null, jsonb_build_object('track_id', tid, 'name', p_name), null);
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('id', tid));
end $$;

create or replace function track_delete(p_token text, p_req uuid, p_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  if exists (select 1 from startups where track_id = p_id) then
    perform _err('IN_USE', 'Startups are in this track. Move them first.');
  end if;
  delete from tracks where id = p_id;
  perform _log(a, 'track.delete', null, null, null, jsonb_build_object('track_id', p_id), null);
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
end $$;

-- ---------- Rooms ----------

create or replace function room_save(p_token text, p_req uuid, p_id int, p_name text, p_track_ids int[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; rid int; moved int;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  if coalesce(trim(p_name),'') = '' then perform _err('INVALID', 'Enter a room name.'); end if;
  if exists (select 1 from rooms where lower(name) = lower(trim(p_name)) and id is distinct from p_id) then
    perform _err('EXISTS', 'A room with that name already exists.');
  end if;
  if p_id is null then
    insert into rooms (name, sort) values (trim(p_name), coalesce((select max(sort)+1 from rooms),0)) returning id into rid;
  else
    update rooms set name = trim(p_name), version = version + 1 where id = p_id returning id into rid;
    if rid is null then perform _err('NOT_FOUND', 'Room not found.'); end if;
  end if;
  delete from room_tracks where room_id = rid;
  insert into room_tracks (room_id, track_id)
  select rid, t from unnest(coalesce(p_track_ids, '{}')) t where exists (select 1 from tracks where id = t);
  -- Startups on deck here whose track the room no longer serves go back to the queue.
  with x as (
    update startups set status = 'waiting', on_deck_room_id = null, on_deck_at = null, version = version + 1
    where on_deck_room_id = rid and status = 'on_deck'
      and track_id not in (select track_id from room_tracks where room_id = rid)
    returning 1) select count(*) into moved from x;
  perform _log(a, 'room.save', null, rid, null,
    jsonb_build_object('name', p_name, 'track_ids', to_jsonb(p_track_ids), 'returned_to_queue', moved), null);
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('id', rid));
end $$;

-- Open, break or close a room. Closing with a live pitch needs p_live_mode = 'cancel'.
create or replace function room_set_status(p_token text, p_req uuid, p_room int, p_status text,
  p_live_mode text default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; rm rooms; live pitch_sessions; returned int;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  select * into rm from rooms where id = p_room for update;
  if not found then perform _err('NOT_FOUND', 'Room not found.'); end if;
  if p_status not in ('open','break','closed') then perform _err('INVALID', 'Unknown status.'); end if;
  if rm.status = p_status then return _idem_put(p_req, jsonb_build_object('status', p_status, 'unchanged', true)); end if;
  select * into live from pitch_sessions where room_id = p_room and status in ('pitch','qa');
  if p_status = 'closed' and live.id is not null then
    if coalesce(p_live_mode,'') <> 'cancel' then
      perform _err('LIVE_SESSION', 'A pitch is running in this room. Let it finish, or close and cancel the pitch.');
    end if;
    update pitch_sessions set status = 'cancelled', cancel_reason = coalesce(p_reason, 'Room closed'),
      ended_by = a->>'name', paused_at = null where id = live.id;
    perform _to_waiting(live.startup_id);
    update startups set queue_pos = _pos_between(null, (select min(queue_pos) from startups where status = 'waiting'))
    where id = live.startup_id;
    perform _log(a, 'pitch.cancel', live.startup_id, p_room, null,
      jsonb_build_object('session_id', live.id, 'by', 'room close'), coalesce(p_reason,'Room closed'));
  end if;
  update rooms set status = p_status, version = version + 1 where id = p_room;
  returned := 0;
  if p_status = 'closed' then
    with x as (
      update startups set status = 'waiting', on_deck_room_id = null, on_deck_at = null, version = version + 1
      where on_deck_room_id = p_room and status = 'on_deck' returning 1)
    select count(*) into returned from x;
  end if;
  perform _log(a, 'room.' || p_status, null, p_room, null,
    jsonb_build_object('from', rm.status, 'returned_to_queue', returned), p_reason);
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('status', p_status, 'returned_to_queue', returned));
end $$;

create or replace function room_delete(p_token text, p_req uuid, p_room int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb;
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  r := _idem_get(p_req); if r is not null then return r; end if;
  if exists (select 1 from pitch_sessions where room_id = p_room) then
    perform _err('IN_USE', 'This room has pitch history. Close it instead of deleting.');
  end if;
  update startups set status = 'waiting', on_deck_room_id = null where on_deck_room_id = p_room and status = 'on_deck';
  delete from rooms where id = p_room;
  perform _log(a, 'room.delete', null, null, null, jsonb_build_object('room_id', p_room), null);
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, '{"ok":true}');
end $$;

-- ---------- Startups: CSV import and edits ----------

-- p_rows: [{eureka_id,email,startup_name,track}]. p_commit=false only previews.
create or replace function startups_import(p_token text, p_req uuid, p_rows jsonb, p_commit boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  a jsonb; r jsonb; row jsonb; i int := 0;
  eid text; em text; nm text; tr text; tid int; ex startups;
  seen text[] := '{}';
  res_new int := 0; res_upd int := 0; res_same int := 0;
  rejected jsonb := '[]'; new_tracks text[] := '{}';
begin
  perform _write_lock();
  a := _staff(p_token, array['admin']);
  if p_commit then r := _idem_get(p_req); if r is not null then return r; end if; end if;
  if jsonb_typeof(p_rows) <> 'array' then perform _err('INVALID', 'No rows found.'); end if;
  for row in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    tid := null; ex := null;
    eid := upper(regexp_replace(coalesce(row->>'eureka_id',''), '\s', '', 'g'));
    em := lower(trim(coalesce(row->>'email','')));
    nm := trim(coalesce(row->>'startup_name',''));
    tr := trim(coalesce(row->>'track',''));
    if eid = '' or em = '' or nm = '' or tr = '' then
      rejected := rejected || jsonb_build_object('row', i, 'eureka_id', eid, 'reason', 'Missing ' ||
        concat_ws(', ', case when eid='' then 'Eureka! ID' end, case when em='' then 'email' end,
                        case when nm='' then 'startup name' end, case when tr='' then 'track' end));
      continue;
    end if;
    if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      rejected := rejected || jsonb_build_object('row', i, 'eureka_id', eid, 'reason', 'Email looks wrong: ' || em);
      continue;
    end if;
    if eid = any(seen) then
      rejected := rejected || jsonb_build_object('row', i, 'eureka_id', eid, 'reason', 'Duplicate Eureka! ID in file');
      continue;
    end if;
    seen := seen || eid;
    select id into tid from tracks where lower(name) = lower(tr);
    if tid is null then
      if not (lower(tr) = any(select lower(x) from unnest(new_tracks) x)) then new_tracks := new_tracks || tr; end if;
      if p_commit then
        insert into tracks (name, sort) values (tr, coalesce((select max(sort)+1 from tracks),0)) returning id into tid;
      end if;
    end if;
    select * into ex from startups where eureka_id = eid;
    if ex.id is null then
      res_new := res_new + 1;
      if p_commit then
        insert into startups (eureka_id, email, name, track_id) values (eid, em, nm, tid);
      end if;
    elsif ex.email = em and ex.name = nm and ex.track_id is not distinct from tid then
      res_same := res_same + 1;
    else
      res_upd := res_upd + 1;
      if p_commit then
        update startups set email = em, name = nm, track_id = tid, version = version + 1, updated_at = now()
        where id = ex.id;
        -- A track change while on deck sends it back to the queue for the right room.
        if ex.track_id <> tid and ex.status = 'on_deck' then perform _to_waiting(ex.id); end if;
      end if;
    end if;
    ex := null; tid := null;
  end loop;
  r := jsonb_build_object('total', i, 'new', res_new, 'updated', res_upd, 'unchanged', res_same,
        'rejected', rejected, 'new_tracks', to_jsonb(new_tracks), 'committed', p_commit);
  if p_commit then
    perform _log(a, 'startups.import', null, null, null, r - 'rejected', null);
    perform _refill_all();
    perform _bump();
    return _idem_put(p_req, r);
  end if;
  return r;
end $$;

-- Add a walk-in or edit one startup. Desk coordinators may add.
create or replace function startup_save(p_token text, p_req uuid, p_id int, p_eureka_id text,
  p_email text, p_name text, p_track_id int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; r jsonb; sid int; ex startups; eid text;
begin
  perform _write_lock();
  a := _staff(p_token);
  r := _idem_get(p_req); if r is not null then return r; end if;
  eid := upper(regexp_replace(coalesce(p_eureka_id,''), '\s', '', 'g'));
  if eid = '' or coalesce(trim(p_name),'') = '' or p_track_id is null then
    perform _err('INVALID', 'Eureka! ID, name and track are required.');
  end if;
  if coalesce(p_email,'') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform _err('INVALID', 'Enter a valid email.'); end if;
  if not exists (select 1 from tracks where id = p_track_id) then perform _err('INVALID', 'Unknown track.'); end if;
  if exists (select 1 from startups where eureka_id = eid and id is distinct from p_id) then
    perform _err('EXISTS', 'Another startup already has Eureka! ID ' || eid || '.');
  end if;
  if p_id is null then
    insert into startups (eureka_id, email, name, track_id)
    values (eid, lower(trim(p_email)), trim(p_name), p_track_id) returning id into sid;
    perform _log(a, 'startup.add', sid, null, null, jsonb_build_object('eureka_id', eid), null);
  else
    if a->>'role' <> 'admin' then perform _err('FORBIDDEN', 'Only admins can edit startups.'); end if;
    select * into ex from startups where id = p_id for update;
    if not found then perform _err('NOT_FOUND', 'Startup not found.'); end if;
    update startups set eureka_id = eid, email = lower(trim(p_email)), name = trim(p_name),
      track_id = p_track_id, version = version + 1, updated_at = now() where id = p_id returning id into sid;
    if ex.track_id <> p_track_id and ex.status = 'on_deck' then perform _to_waiting(p_id); end if;
    perform _log(a, 'startup.edit', sid, null, null,
      jsonb_build_object('before', _startup_json(ex), 'track_changed', ex.track_id <> p_track_id), null);
  end if;
  perform _refill_all();
  perform _bump();
  return _idem_put(p_req, jsonb_build_object('id', sid));
end $$;
