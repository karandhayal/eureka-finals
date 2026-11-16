// Local stand-in for Supabase's REST RPC endpoint (/rest/v1/rpc/<fn>), used only for tests.
import http from 'http'; import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgres://postgres:pw@localhost:5433/postgres', max: 30 });
pool.on('connect', c => c.query('set role anon'));
const typeCache = {};
async function argTypes(fn) {
  if (typeCache[fn]) return typeCache[fn];
  const r = await pool.query(`select unnest(proargnames) n, unnest(proargtypes::regtype[]::text[]) t from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn]);
  return typeCache[fn] = Object.fromEntries(r.rows.map(x => [x.n, x.t]));
}
const port = Number(process.env.PORT || 54321);
http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const m = req.url.match(/^\/rest\/v1\/rpc\/([a-z_]+)/);
  if (!m) { res.writeHead(404); return res.end('{}'); }
  let body = ''; for await (const ch of req) body += ch;
  const args = body ? JSON.parse(body) : {};
  const keys = Object.keys(args);
  const types = await argTypes(m[1]);
  const vals = keys.map(k => { const v = args[k]; if (v === null || v === undefined) return null;
    if (Array.isArray(v) && (types[k] || '').endsWith('[]')) return '{' + v.join(',') + '}';
    return typeof v === 'object' ? JSON.stringify(v) : String(v); });
  const sql = `select public.${m[1]}(${keys.map((k, i) => `"${k}" => $${i + 1}`).join(', ')}) as r`;
  try {
    const r = await pool.query(sql, vals);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.rows[0]?.r ?? null));
  } catch (e) {
    res.writeHead(e.code === 'P0001' ? 400 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: e.code, message: e.message }));
  }
}).listen(port, () => console.log('shim on', port));
