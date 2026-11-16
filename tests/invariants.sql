-- Test-only: returns a list of broken rules (empty = healthy).
create or replace function test_invariants() returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(v), '[]') from (
    select 'room over on-deck capacity: ' || r.name v from rooms r
      where (select count(*) from startups s where s.on_deck_room_id = r.id and s.status = 'on_deck') > (select on_deck from settings)
    union all select 'two live sessions in a room ' || room_id from pitch_sessions where status in ('pitch','qa') group by room_id having count(*) > 1
    union all select 'startup live twice ' || startup_id from pitch_sessions where status in ('pitch','qa') group by startup_id having count(*) > 1
    union all select 'pitching without live session ' || s.eureka_id from startups s where s.status = 'pitching'
      and not exists (select 1 from pitch_sessions ps where ps.startup_id = s.id and ps.status in ('pitch','qa'))
    union all select 'live session but startup not pitching ' || s.eureka_id from pitch_sessions ps join startups s on s.id = ps.startup_id
      where ps.status in ('pitch','qa') and s.status <> 'pitching'
    union all select 'on deck without room ' || eureka_id from startups where status = 'on_deck' and on_deck_room_id is null
    union all select 'on deck in room not serving track ' || s.eureka_id from startups s where s.status = 'on_deck'
      and not exists (select 1 from room_tracks rt where rt.room_id = s.on_deck_room_id and rt.track_id = s.track_id)
    union all select 'on deck in closed room ' || s.eureka_id from startups s join rooms r on r.id = s.on_deck_room_id where s.status = 'on_deck' and r.status = 'closed'
    union all select 'checked in without ticket ' || eureka_id from startups where checked_in_at is not null and (ticket_no is null or queue_pos is null)
    union all select 'not checked in but in queue ' || eureka_id from startups where checked_in_at is null and status not in ('registered','withdrawn')
    union all select 'duplicate ticket ' || ticket_no from startups where ticket_no is not null group by ticket_no having count(*) > 1
    union all select 'done without finished session ' || s.eureka_id from startups s where s.status = 'done'
      and not exists (select 1 from pitch_sessions ps where ps.startup_id = s.id and ps.status = 'done')
    union all select 'two scores same judge+startup' from scores group by judge_id, startup_id having count(*) > 1
    union all select 'idle room with waiting startup it could take: ' || r.name from rooms r where r.status = 'open'
      and (select count(*) from startups s where s.on_deck_room_id = r.id and s.status = 'on_deck') < (select on_deck from settings)
      and exists (select 1 from startups s where s.status = 'waiting' and s.track_id in (select track_id from room_tracks where room_id = r.id)
                  and (s.pinned_room_id is null or s.pinned_room_id = r.id))
  ) x
$$;
