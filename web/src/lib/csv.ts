import Papa from 'papaparse';

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string[]> = {
  eureka_id: ['eurekaid', 'eureka', 'eurekaidno', 'id', 'eurekanumber'],
  email: ['email', 'emailid', 'emailaddress', 'mail'],
  startup_name: ['startupname', 'startup', 'name', 'companyname', 'company', 'teamname'],
  track: ['track', 'category', 'vertical', 'domain', 'sector'],
};

export type ParsedCsv = { rows: Record<string, string>[]; missing: string[]; headers: string[] };

/** Parse a startup CSV; header names are matched loosely ("Eureka! ID", "Startup Name"...). */
export function parseStartupCsv(text: string): ParsedCsv {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  const data = res.data as string[][];
  if (!data.length) return { rows: [], missing: Object.keys(ALIASES), headers: [] };
  const headers = data[0].map(h => String(h ?? '').trim());
  const idx: Record<string, number> = {};
  for (const [field, alts] of Object.entries(ALIASES)) {
    const i = headers.findIndex(h => alts.includes(norm(h)));
    if (i >= 0) idx[field] = i;
  }
  const missing = Object.keys(ALIASES).filter(f => idx[f] === undefined);
  const rows = data.slice(1).map(r => Object.fromEntries(Object.entries(idx).map(([f, i]) => [f, String(r[i] ?? '').trim()])));
  return { rows, missing, headers };
}

export function parseJudgeCsv(text: string) {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: h => norm(h) });
  return res.data.map(r => ({ name: r.name || r.fullname || '', email: r.email || r.emailid || '', phone: r.phone || r.mobile || r.phonenumber || '', kind: r.kind || r.type || r.role || 'jury' }));
}

/** Download rows as a CSV file. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const flat = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? ''])));
  const csv = Papa.unparse(flat);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
