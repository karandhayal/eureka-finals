// Browser test: download both badge PDFs, check page counts, render pages, decode the QR codes.
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
const APP = process.env.APP || 'http://localhost:4173/';
const out = '/home/claude/pd/e2e/shots-pdf'; fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = []; p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto(APP);
await p.getByLabel('Email').fill('asha@ecell.test'); await p.getByLabel('Password').fill('admin-pass-1');
await p.getByRole('button', { name: 'Sign in' }).click(); await p.getByRole('heading', { name: 'Live' }).waitFor();
await p.goto(APP + '#/setup');
const results = [];
for (const [layout, label, expectPages] of [['sheet', '12 per page, to cut', Math.ceil(170 / 12)], ['single', 'One per page', null]]) {
  await p.getByRole('listitem').filter({ hasText: 'QR badges (PDF)' }).getByRole('button', { name: 'Download' }).click().catch(async () =>
    p.locator('.list-item', { hasText: 'QR badges (PDF)' }).getByRole('button', { name: 'Download' }).click());
  const dlg = p.getByRole('dialog', { name: 'Download QR badges' });
  await dlg.getByRole('button', { name: label }).click();
  if (layout === 'single') await dlg.getByLabel('Track').selectOption('Fintech');
  if (layout === 'sheet') await p.screenshot({ path: `${out}/dialog.png` });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), dlg.getByRole('button', { name: /Download PDF/ }).click()]);
  const file = `${out}/${layout}.pdf`; await dl.saveAs(file);
  const pages = Number(execSync(`pdfinfo ${file} | grep Pages`).toString().match(/\d+/)[0]);
  execSync(`pdftoppm -png -r 110 -f 1 -l 1 ${file} ${out}/${layout}-p`);
  const png = fs.readdirSync(out).find(f => f.startsWith(`${layout}-p`));
  // decode every QR on page 1 by scanning each grid cell
  const img = PNG.sync.read(fs.readFileSync(`${out}/${png}`));
  const cells = layout === 'sheet' ? { cols: 3, rows: 4 } : { cols: 1, rows: 1 };
  const decoded = [];
  for (let r = 0; r < cells.rows; r++) for (let c = 0; c < cells.cols; c++) {
    const x0 = Math.floor(img.width * c / cells.cols), y0 = Math.floor(img.height * r / cells.rows);
    const w = Math.floor(img.width / cells.cols), h = Math.floor(img.height / cells.rows);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) img.data.copy ? Buffer.from(img.data.buffer).copy(Buffer.from(data.buffer), y * w * 4, ((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4) : 0;
    const q = jsQR(data, w, h); if (q) decoded.push(q.data);
  }
  results.push({ layout, file, pages, expectPages, page1: png, decoded });
}
console.log(JSON.stringify(results, null, 1)); console.log('console errors:', errs.length, errs.slice(0, 3));
await b.close();
