import { randomUUID } from 'crypto';
export const BASE = process.env.API || 'http://localhost:54321';
export const KEY = process.env.ANON || '';
export async function rpc(fn, args = {}) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: KEY ? `Bearer ${KEY}` : '' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) { const e = new Error(data?.message || r.statusText); e.code = (data?.message || '').split(':')[0]; e.status = r.status; throw e; }
  return data;
}
export const req = () => randomUUID();
export async function expectErr(p, code) {
  try { await p; } catch (e) { if (e.code !== code) throw new Error(`expected ${code}, got ${e.code}: ${e.message}`); return e; }
  throw new Error(`expected error ${code}, but call succeeded`);
}
export const TRACKS = ['Fintech','Healthtech','Edtech','Agritech','Climate','Consumer','DeepTech','SaaS'];
// 10 rooms over 8 tracks: every track has a room, two rooms take two tracks each.
export const ROOM_MAP = [['Fintech'],['Fintech'],['Healthtech'],['Edtech'],['Agritech','Climate'],['Climate'],['Consumer'],['DeepTech'],['SaaS'],['DeepTech','SaaS']];
export function makeStartups(n) {
  return Array.from({ length: n }, (_, i) => ({
    eureka_id: `EU26${String(10001 + i)}`, email: `team${i + 1}@example.com`,
    startup_name: `Startup ${String(i + 1).padStart(3, '0')}`, track: TRACKS[i % TRACKS.length],
  }));
}
