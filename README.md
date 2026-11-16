# Eureka! Finals: event operations app

E-Cell IIT Bombay. Check-in, a shared pitching queue across rooms, manual overrides, judging and results for one city.

## What is where

| Part | Where |
| --- | --- |
| Backend (database + API) | Supabase project `pitch-day` (ref `murkxbjtjnvxnosbosiz`, Mumbai region, free plan). API: `https://murkxbjtjnvxnosbosiz.supabase.co` |
| Web app | Static site in `site/` (built from `web/`). Host on Cloudflare Pages (free). |
| Database code | `db/001` to `db/008` SQL files, already applied to Supabase (plus migrations 009 and 010) |
| Tests | `tests/` (API, race, load), `e2e/` (browser) |

## Put the site live (about 2 minutes)

1. Sign in at dash.cloudflare.com, open **Workers & Pages**, choose **Create**, then the **Pages** tab, then **Upload assets** (Cloudflare may also call this "Drag and drop your files").
2. Project name: `eureka-finals`. Create.
3. Drop the `eureka-finals-site.zip` file (or the unzipped folder). Deploy.
4. Your app is at `https://eureka-finals.pages.dev`.

Any static host works (Netlify Drop, Vercel, GitHub Pages). The site only needs to serve these files; all routes use `#/`, so no server rules are needed.

## Hosting at ecell.in/eureka-finals

Use `eureka-finals-ecell-in.zip` (built for that folder). Rebuild it with `BASE=/eureka-finals/ npm run build`.

- **Server with nginx or Apache:** unzip so the files sit in `<ecell.in web root>/eureka-finals/`. For nginx also add
  `location /eureka-finals/ { try_files $uri $uri/ /eureka-finals/index.html; }` and
  `location /eureka-finals/assets/ { expires 1y; add_header Cache-Control "public, immutable"; }`, then `sudo nginx -t && sudo systemctl reload nginx`.
- **ecell.in behind Cloudflare, site on Pages:** deploy the folder build to a Pages project, then add a Worker route `ecell.in/eureka-finals*`
  that forwards to `<project>.pages.dev` (see the Worker in `deploy/worker.js`).
- **Simplest:** a subdomain such as `eureka.ecell.in`: add a CNAME to `eureka-finals.pages.dev` and add the custom domain in Pages. Use the root build for this.

## First sign-in

- Admin email: `admin@ecell.local`. The password was given to you separately. Change both under Setup, then Staff accounts.
- Then: Setup, then Upload CSV (`Eureka! ID, email, startup_name, track`), then Rooms (add rooms, tick tracks), then rubric, staff and judges.

## Links people use

| Who | Link |
| --- | --- |
| Admins, coordinators | `/` (sign in) |
| Startups | `/#/s` (Eureka! ID + email), or personal links from Setup, then Exports, then Startup links |
| Judges | Personal QR or link from the Judges page |
| Room projector | Rooms page, then the screen icon |
| Hall TV | Setup, then Screens and links |

## Event-day checklist

- Free Supabase projects pause after about 7 days without use. Open the app the day before and on the morning of the event.
- Do a 30-minute rehearsal with fake startups, then Setup, then Reset, then "Clear the day's activity".
- Export attendance, pitch log and scores every hour as a backup (Setup, then Exports). The free plan has no automatic backups.
- If someone's phone dies, any other device can sign in and continue: all state is on the server.

## Running the tests yourself

```bash
# Local database (needs Node 20+)
cd localdb && npm i && node start.mjs &      # Postgres on :5433
node psql.mjs ../db/00*.sql ../tests/invariants.sql
node shim.mjs &                               # local stand-in for the Supabase API on :54321
cd ../tests && node --test --test-concurrency=1 functional.test.mjs race.test.mjs
node loadtest.mjs 4 local                     # 217 virtual users for 4 minutes
cd ../e2e && npm i playwright pg && node flow.mjs   # browser walk-through (uses Chrome)
```

To load-test real Supabase, make a separate staging project with the same SQL plus `tests/invariants.sql`, then run
`API=https://<staging>.supabase.co ANON=<anon key> ADMIN_EMAIL=.. ADMIN_PASSWORD=.. node loadtest.mjs 5 staging`.
**Never point the load test at the live project: it wipes the event.**
