import pg from 'pg';
const c = new pg.Client('postgres://postgres:pw@localhost:5433/postgres'); await c.connect();
await c.query("delete from scores; delete from pitch_sessions; delete from judge_assignments; delete from request_log; delete from activity_log; delete from startups; delete from judges; delete from staff_tokens; delete from staff; delete from rooms; delete from tracks; delete from criteria; select setval('ticket_seq',1,false); select setval('actual_seq',1,false);");
await c.end(); console.log('db clean');
