import pg from 'pg'; import fs from 'fs';
const c = new pg.Client({connectionString: process.env.DBURL || 'postgres://postgres:pw@localhost:5433/postgres'});
await c.connect();
const sql = process.argv[2] === '-c' ? process.argv[3] : process.argv.slice(2).map(f=>fs.readFileSync(f,'utf8')).join('\n');
try { const r = await c.query(sql); const last = Array.isArray(r) ? r.at(-1) : r; if (last?.rows?.length) console.log(JSON.stringify(last.rows, null, 1)); console.log('OK'); }
catch(e){ console.error('ERR', e.message, e.position ? 'pos '+e.position : '', e.where||''); process.exitCode=1 }
await c.end();
