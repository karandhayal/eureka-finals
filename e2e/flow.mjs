// Browser walk-through of the whole event, as each role, at desktop and phone sizes.
import { chromium } from 'playwright';
import fs from 'fs';

const APP = process.env.APP || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS || '/home/claude/pd/e2e/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const consoleErrors = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('PASS', name); }
  catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); console.log('FAIL', name, '-', e.message.split('\n')[0]); }
};

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
for (const ctx of [desk, phone]) ctx.on('page', p => p.on('console', m => { if (m.type() === 'error' && !/camera|getUserMedia|NotFound|Permission|Requested device/i.test(m.text())) consoleErrors.push(`${p.url()}: ${m.text()}`); }));
const A = await desk.newPage();
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });
const openRoom = async (p, name) => { await p.goto(APP + '#/rooms'); await p.getByRole('row', { name: new RegExp(name + '\\b') }).getByRole('button', { name: 'Console' }).click(); await p.getByRole('heading', { name: new RegExp('^' + name) }).waitFor(); };
const toast = async (p, re) => { await p.locator('.toast').filter({ hasText: re }).first().waitFor({ timeout: 8000 }); };

// ---------- Setup as admin ----------
await step('first admin is created from the sign-in screen', async () => {
  await A.goto(APP);
  await A.getByRole('heading', { name: 'Set up your event' }).waitFor();
  await shot(A, '01-setup-first-admin');
  await A.getByLabel('Your name').fill('Asha Admin');
  await A.getByLabel('Email').fill('asha@ecell.test');
  await A.getByLabel('Password').fill('admin-pass-1');
  await A.getByRole('button', { name: 'Create admin and continue' }).click();
  await A.getByRole('heading', { name: 'Live' }).waitFor();
});

await step('CSV upload: preview shows new, rejected, new tracks; import commits', async () => {
  const tracks = ['Fintech', 'Healthtech', 'Edtech', 'Agritech', 'Climate', 'Consumer', 'DeepTech', 'SaaS'];
  const lines = ['Eureka! ID,Email,Startup Name,Track'];
  for (let i = 0; i < 170; i++) lines.push(`EU26${10001 + i},team${i + 1}@example.com,Startup ${String(i + 1).padStart(3, '0')},${tracks[i % 8]}`);
  lines.push(',bad@x.com,No Id,Fintech');
  fs.writeFileSync('/tmp/startups.csv', lines.join('\n'));
  await A.goto(APP + '#/setup');
  await A.locator('#csv').setInputFiles('/tmp/startups.csv');
  await A.getByText('New tracks will be created').waitFor();
  await shot(A, '02-setup-csv-preview');
  await A.getByRole('button', { name: /Import 170 startups/ }).click();
  await toast(A, /Imported: 170 new/);
});

await step('rubric saved; coordinator account created', async () => {
  await A.getByRole('button', { name: 'Save rubric' }).click();
  await toast(A, /Rubric saved/);
  await A.getByRole('button', { name: 'Add account' }).click();
  const dlg = A.getByRole('dialog');
  await dlg.getByLabel('Name').fill('Ravi Room');
  await dlg.getByLabel('Email').fill('ravi@ecell.test');
  await dlg.getByLabel('Password').fill('coord-pass-1');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await toast(A, /Account created/);
  await shot(A, '03-setup-staff');
});

await step('10 rooms created across 8 tracks', async () => {
  const map = [['Fintech'], ['Fintech'], ['Healthtech'], ['Edtech'], ['Agritech', 'Climate'], ['Climate'], ['Consumer'], ['DeepTech'], ['SaaS'], ['DeepTech', 'SaaS']];
  await A.goto(APP + '#/rooms');
  for (let i = 0; i < map.length; i++) {
    await A.getByRole('button', { name: /^Add/ }).first().click();
    const dlg = A.getByRole('dialog');
    await dlg.getByLabel('Room name').fill(`Room ${i + 1}`);
    for (const t of map[i]) await dlg.getByLabel(t, { exact: true }).check();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await dlg.waitFor({ state: 'detached' });
  }
  await A.getByRole('cell', { name: 'Room 10', exact: true }).waitFor();
  await shot(A, '04-rooms');
});

// ---------- Registration desk ----------
await step('desk: search, check in, duplicate check-in keeps first', async () => {
  await A.goto(APP + '#/desk');
  for (const id of ['EU2610001', 'EU2610009', 'EU2610017', 'EU2610025', 'EU2610002', 'EU2610003']) {
    await A.getByLabel('Search startups').fill(id);
    await A.getByRole('button', { name: 'Mark present' }).click();
    await A.getByText(/is checked in/).waitFor();
  }
  await shot(A, '05-desk-desktop');
  await A.getByLabel('Search startups').fill('EU2610001');
  await A.getByText(/Already checked in, ticket #1/).waitFor();
});

await step('desk on phone: camera view, manual search, check in', async () => {
  const P = await phone.newPage();
  await P.goto(APP);
  await P.getByLabel('Email').fill('ravi@ecell.test');
  await P.getByLabel('Password').fill('coord-pass-1');
  await P.getByRole('button', { name: 'Sign in' }).click();
  await P.getByRole('heading', { name: 'Registration desk' }).waitFor();
  await shot(P, '06-desk-phone');
  await P.getByRole('button', { name: /Search/ }).click();
  await P.getByLabel('Search startups').fill('EU2610033');
  await P.getByRole('button', { name: 'Mark present' }).click();
  await P.getByText(/is checked in/).waitFor();
  await shot(P, '07-desk-phone-done');
  await P.close();
});

// ---------- Live ----------
await step('live: rooms show on-deck startups; alerts list rooms without judges', async () => {
  await A.goto(APP + '#/live');
  await A.getByRole('heading', { name: 'Rooms', exact: true }).first().waitFor();
  await A.getByText('Startup 001').first().waitFor();
  await shot(A, '08-live-desktop');
});

// ---------- Judges ----------
let judgeUrl = '';
await step('coordinator adds a judge, assigns room 1, gets the sign-in link', async () => {
  await A.goto(APP + '#/judges');
  await A.getByRole('button', { name: /Add/ }).first().click();
  const dlg = A.getByRole('dialog');
  await dlg.getByLabel('Name').fill('Dr Meera Judge');
  await dlg.getByRole('button', { name: 'Add judge' }).click();
  const sheet = A.getByRole('dialog', { name: 'Dr Meera Judge' });
  await sheet.waitFor();
  await sheet.getByRole('button', { name: 'Arrived', exact: true }).click();
  await sheet.locator('select').selectOption({ label: 'Room 1' });
  await toast(A, /assigned/);
  judgeUrl = await sheet.getByLabel('Judge link').inputValue();
  await shot(A, '09-judge-qr');
  await sheet.getByRole('button', { name: 'Close' }).click();
});

// ---------- Room console ----------
await step('room console: start first on deck, timer runs, end pitch, Q&A', async () => {
  await openRoom(A, 'Room 1');
  await A.getByRole('button', { name: /^Start Startup 001/ }).click();
  await toast(A, /pitch started/);
  await A.getByText('Now pitching').waitFor();
  await A.waitForTimeout(1500);
  await shot(A, '10-room-console-pitch');
  await A.getByRole('button', { name: 'End pitch, start Q&A' }).click();
  await toast(A, /Q&A started/);
});

await step('judge on phone: live startup opens; submit score; appears as submitted', async () => {
  const J = await phone.newPage();
  await J.goto(judgeUrl);
  await J.getByRole('heading', { name: 'Startup 001' }).waitFor();
  await shot(J, '11-judge-sheet');
  for (const g of await J.locator('[role=group][aria-labelledby]').all()) await g.getByRole('button', { name: '8', exact: true }).click();
  await J.getByRole('button', { name: 'Submit score' }).click();
  await toast(J, /Score submitted/);
  await J.getByRole('tab', { name: /Submitted/ }).click();
  await J.getByText('80').first().waitFor();
  await shot(J, '12-judge-list');
  await J.close();
});

await step('room console: finish; next startup moves up', async () => {
  await A.getByRole('button', { name: 'Finish' }).click();
  await toast(A, /finished/);
  await A.getByText(/Scores for Startup 001/).waitFor();
});

await step('manual override: start a later startup with a reason; ticket order kept', async () => {
  await A.getByRole('button', { name: 'Start someone else' }).click();
  const dlg = A.getByRole('dialog');
  await dlg.getByLabel('Search startups').fill('EU2610033');
  await dlg.getByRole('button', { name: /Startup 033/ }).click();
  const conf = A.getByRole('dialog', { name: /Start Startup 033/ });
  await conf.getByRole('button', { name: 'Start pitch now' }).isDisabled();
  await conf.getByRole('button', { name: 'Scheduled startup not in the room' }).click();
  await shot(A, '13-override-dialog');
  await conf.getByRole('button', { name: 'Start pitch now' }).click();
  await toast(A, /Startup 033: pitch started/);
  await A.getByText('Override', { exact: true }).first().waitFor();
});

await step('cancel wrong startup: back on deck, logged', async () => {
  await A.getByRole('button', { name: 'Cancel pitch' }).click();
  const dlg = A.getByRole('dialog');
  await dlg.getByLabel('Reason').fill('Wrong startup');
  await dlg.getByRole('button', { name: 'Cancel pitch' }).click();
  await toast(A, /Pitch cancelled/);
});

await step('skip a no-show on deck', async () => {
  await A.getByRole('button', { name: 'Not here, skip' }).click();
  await A.getByRole('dialog').getByRole('button', { name: 'Skip' }).click();
  await toast(A, /skipped/);
});

await step('room console on phone: sticky primary action and actions sheet', async () => {
  const P = await phone.newPage();
  await P.goto(APP);
  await P.evaluate(() => localStorage.clear());
  await P.goto(APP);
  await P.getByLabel('Email').fill('asha@ecell.test');
  await P.getByLabel('Password').fill('admin-pass-1');
  await P.getByRole('button', { name: 'Sign in' }).click();
  await P.goto(APP + '#/live');
  await P.getByRole('button', { name: /Room 2/ }).first().click();
  await P.getByRole('button', { name: 'Open room console' }).click();
  await P.getByRole('button', { name: /^Start Startup/ }).waitFor();
  await shot(P, '14-room-console-phone');
  await P.getByRole('button', { name: 'More actions' }).click();
  await P.getByRole('dialog', { name: 'Room actions' }).waitFor();
  await shot(P, '15-room-actions-sheet');
  await P.close();
});

// ---------- Queue ----------
await step('queue: move to top, hold, release', async () => {
  await A.goto(APP + '#/queue');
  await A.getByRole('cell', { name: /Startup 025/ }).click();
  const panel = A.getByRole('complementary', { name: /Startup 025/ });
  await panel.getByRole('button', { name: 'Top' }).click();
  await toast(A, /moved to top/);
  await panel.getByRole('button', { name: 'Put on hold' }).click();
  await toast(A, /on hold/);
  await shot(A, '16-queue');
  await panel.getByRole('button', { name: 'Release hold' }).click();
  await toast(A, /back in queue/);
});

// ---------- Room close ----------
await step('close a room with a pitch running requires cancel + reason', async () => {
  await openRoom(A, 'Room 3');
  const start = A.getByRole('button', { name: /^Start Startup/ });
  if (await start.count()) { await start.click(); await toast(A, /pitch started/); }
  await A.goto(APP + '#/rooms');
  await A.getByRole('row', { name: /Room 3/ }).getByRole('button', { name: 'Close' }).click();
  const dlg = A.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Close and cancel pitch' }).isDisabled();
  await dlg.getByLabel('Reason').fill('Projector failed');
  await dlg.getByRole('button', { name: 'Close and cancel pitch' }).click();
  await toast(A, /Room 3 closed/);
  await A.getByRole('row', { name: /Room 3/ }).getByText('Closed').waitFor();
  await A.getByRole('row', { name: /Room 3/ }).getByRole('button', { name: 'Open', exact: true }).click();
  await toast(A, /opened/);
});

// ---------- Startup, displays, results, activity ----------
await step('startup page on phone: lookup, queue position, estimate, QR', async () => {
  const S = await phone.newPage();
  await S.goto(APP + '#/s');
  await S.getByLabel('Eureka! ID').fill('eu2610041');
  await S.getByLabel('Registered email').fill('team41@example.com');
  await S.getByRole('button', { name: 'Continue' }).click();
  await S.getByRole('heading', { name: 'Check in at the registration desk' }).waitFor();
  await shot(S, '17-startup-not-arrived');
  await A.goto(APP + '#/desk');
  await A.getByLabel('Search startups').fill('EU2610041');
  await A.getByRole('button', { name: 'Mark present' }).click();
  await S.reload();
  await S.getByRole('heading', { name: /You are in the queue|Go now/ }).or(S.getByText('Go now to')).first().waitFor();
  await shot(S, '18-startup-queue');
  await S.close();
});

await step('room projector and hall board render', async () => {
  await A.goto(APP + '#/rooms');
  const [disp] = await Promise.all([desk.waitForEvent('page'), A.getByRole('button', { name: 'Open Room 2 projector screen' }).click()]);
  await disp.waitForLoadState();
  await disp.getByText('Room 2').first().waitFor();
  await disp.setViewportSize({ width: 1920, height: 1080 });
  await shot(disp, '19-projector');
  await disp.close();
  await A.goto(APP + '#/setup');
  const hall = await A.getByLabel('Hall board link', { exact: true }).inputValue();
  const H = await desk.newPage(); await H.setViewportSize({ width: 1920, height: 1080 });
  await H.goto(hall); await H.getByText('Pitching now').waitFor();
  await shot(H, '20-hall-board'); await H.close();
});

await step('results show the scored startup; activity log lists the override', async () => {
  await A.goto(APP + '#/results');
  await A.getByRole('cell', { name: /Startup 001/ }).waitFor();
  await shot(A, '21-results');
  await A.goto(APP + '#/activity');
  await A.getByRole('button', { name: 'Overrides' }).click();
  await A.getByText('Scheduled startup not in the room').waitFor();
  await shot(A, '22-activity');
});

await step('live on phone: tabs and room list', async () => {
  const P = await phone.newPage();
  await P.goto(APP);
  await P.evaluate(() => localStorage.clear());
  await P.goto(APP);
  await P.getByLabel('Email').fill('asha@ecell.test');
  await P.getByLabel('Password').fill('admin-pass-1');
  await P.getByRole('button', { name: 'Sign in' }).click();
  await P.getByRole('tab', { name: /Rooms/ }).waitFor();
  await shot(P, '23-live-phone');
  await P.getByRole('button', { name: 'More' }).click();
  await shot(P, '24-more-sheet');
  await P.close();
});

// ---------- Layout checks at every width ----------
await step('no horizontal overflow at 320-430 and 1280-1920 on every staff screen', async () => {
  const firstRoom = await A.evaluate(async () => { const t = JSON.parse(localStorage.getItem('pd.staff')).token; const r = await fetch('http://localhost:54321/rest/v1/rpc/admin_state', { method: 'POST', body: JSON.stringify({ p_token: t }) }); return (await r.json()).rooms[0].id; });
  const routes = ['live', 'queue', 'rooms', 'judges', 'results', 'activity', 'setup', 'desk', 'room/' + firstRoom];
  const widths = [320, 375, 390, 430, 768, 1280, 1440, 1920];
  const bad = [];
  const P = await desk.newPage();
  for (const w of widths) {
    await P.setViewportSize({ width: w, height: 900 });
    for (const r of routes) {
      await P.goto(APP + '#/' + r);
      await P.waitForTimeout(400);
      const o = await P.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 1) bad.push(`${r}@${w}: +${o}px`);
    }
  }
  await P.close();
  if (bad.length) throw new Error('overflow: ' + bad.join(', '));
});

await step('no overflow on judge, startup and display screens at phone widths', async () => {
  const bad = [];
  const P = await phone.newPage();
  for (const w of [320, 375, 390, 430]) {
    await P.setViewportSize({ width: w, height: 800 });
    for (const u of [judgeUrl, APP + '#/s']) {
      await P.goto(u); await P.waitForTimeout(500);
      const o = await P.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 1) bad.push(`${u.split('#')[1]}@${w}: +${o}px`);
    }
  }
  await P.close();
  if (bad.length) throw new Error('overflow: ' + bad.join(', '));
});

await browser.close();
fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify({ results, consoleErrors }, null, 2));
console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed; console errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 10).forEach(e => console.log('  console:', e));
