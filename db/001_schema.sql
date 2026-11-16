-- Pitch Day: schema
-- All writes go through security-definer functions; tables are closed to the API.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  event_name text not null default 'Eureka! Finals',
  pitch_s int not null default 300 check (pitch_s between 30 and 3600),
  qa_s int not null default 180 check (qa_s between 0 and 3600),
  changeover_s int not null default 120 check (changeover_s between 0 and 3600),
  on_deck int not null default 2 check (on_deck between 1 and 5),
  skip_limit int not null default 2 check (skip_limit between 1 and 5),
  overrun_alert_s int not null default 60,
  hall_code text not null default encode(extensions.gen_random_bytes(6), 'hex'),
  change_seq bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1) on conflict do nothing;

create table if not exists tracks (
  id serial primary key,
  name text not null unique,
  results_locked boolean not null default false,
  sort int not null default 0
);

create table if not exists rooms (
  id serial primary key,
  name text not null unique,
  status text not null default 'open' check (status in ('open','break','closed')),
  display_code text not null unique default encode(extensions.gen_random_bytes(6), 'hex'),
  sort int not null default 0,
  last_ended_at timestamptz,
  version int not null default 1
);

create table if not exists room_tracks (
  room_id int not null references rooms(id) on delete cascade,
  track_id int not null references tracks(id) on delete cascade,
  primary key (room_id, track_id)
);

create table if not exists staff (
  id serial primary key,
  name text not null,
  email text not null unique,
  pass_hash text not null,
  role text not null check (role in ('admin','coordinator')),
  duty text check (duty in ('desk','room','floor')),
  room_id int references rooms(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists staff_tokens (
  token text primary key,
  staff_id int not null references staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '36 hours'
);

create sequence if not exists ticket_seq;
create sequence if not exists actual_seq;

create table if not exists startups (
  id serial primary key,
  eureka_id text not null unique,
  email text not null,
  name text not null,
  track_id int not null references tracks(id),
  token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  status text not null default 'registered'
    check (status in ('registered','waiting','hold','on_deck','pitching','done','no_show','withdrawn')),
  checked_in_at timestamptz,
  checked_in_by text,
  ticket_no int unique,
  queue_pos numeric,
  on_deck_room_id int references rooms(id) on delete set null,
  on_deck_at timestamptz,
  pinned_room_id int references rooms(id) on delete set null,
  skip_count int not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists startups_queue_idx on startups (status, queue_pos);
create index if not exists startups_track_idx on startups (track_id);

create table if not exists pitch_sessions (
  id serial primary key,
  startup_id int not null references startups(id) on delete cascade,
  room_id int not null references rooms(id),
  actual_no int,
  status text not null check (status in ('pitch','qa','done','cancelled')),
  pitch_started_at timestamptz not null default now(),
  pitch_ended_at timestamptz,
  qa_ended_at timestamptz,
  phase_started_at timestamptz not null default now(),
  phase_paused_s numeric not null default 0,
  total_paused_s numeric not null default 0,
  paused_at timestamptz,
  started_by text not null,
  ended_by text,
  is_override boolean not null default false,
  override_reason text,
  cancel_reason text,
  created_at timestamptz not null default now()
);
-- The two rules that make double-booking impossible.
create unique index if not exists one_live_session_per_startup
  on pitch_sessions (startup_id) where status in ('pitch','qa');
create unique index if not exists one_live_session_per_room
  on pitch_sessions (room_id) where status in ('pitch','qa');
create index if not exists sessions_room_idx on pitch_sessions (room_id, created_at desc);

create table if not exists judges (
  id serial primary key,
  name text not null,
  email text,
  phone text,
  kind text not null default 'jury' check (kind in ('jury','mentor','both')),
  token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  status text not null default 'not_arrived' check (status in ('not_arrived','arrived','left')),
  room_id int references rooms(id) on delete set null,
  certificate boolean not null default false,
  added_by text,
  created_at timestamptz not null default now()
);

create table if not exists judge_assignments (
  id serial primary key,
  judge_id int not null references judges(id) on delete cascade,
  room_id int not null references rooms(id) on delete cascade,
  from_at timestamptz not null default now(),
  to_at timestamptz
);

create table if not exists criteria (
  id serial primary key,
  name text not null,
  description text,
  max_score int not null default 10 check (max_score between 1 and 100),
  weight numeric not null default 1 check (weight > 0),
  sort int not null default 0
);

create table if not exists scores (
  id serial primary key,
  judge_id int not null references judges(id) on delete cascade,
  startup_id int not null references startups(id) on delete cascade,
  room_id int references rooms(id) on delete set null,
  vals jsonb not null default '{}'::jsonb,
  comment text,
  recused boolean not null default false,
  total numeric,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (judge_id, startup_id)
);

create table if not exists activity_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  actor_role text not null,
  action text not null,
  startup_id int,
  room_id int,
  judge_id int,
  details jsonb not null default '{}'::jsonb,
  reason text
);
create index if not exists activity_at_idx on activity_log (at desc);

create table if not exists request_log (
  request_id uuid primary key,
  result jsonb not null,
  at timestamptz not null default now()
);

-- Close every table to the public API. Only functions below can touch them.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
