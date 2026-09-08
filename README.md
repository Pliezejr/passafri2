# AfriPass Business Passport — MVP

A working implementation of the AfriPass spec's V2 MVP scope (section 26):
business registration & AfriPass ID, document upload, admin verification
queue, trust score, verified references, reviews, QR-code public passport
pages, business search, and a starter REST/enterprise API.

**Zero external dependencies.** It runs on Node's built-in `http` module
with a JSON-file data store — no `npm install`, no database server, no
build step. That makes it trivial to run anywhere, and easy to swap pieces
out as you grow past the MVP (see "Moving beyond the MVP" below).

## Run it (local/dev)

```bash
node server.js
```

Then open **http://localhost:3000**.

On first run the server seeds and prints **once** to the console:
- An admin login — `admin@afripass.local` by default, with a random
  generated password (set `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars to
  pin your own instead — see `.env.example`)
- An enterprise API key for the `/api/v1/verify/:passportId` endpoint

Copy the printed password down; it is not stored in plaintext or shown
again.

## Walkthrough

1. **Register a business** at `/register.html`. You'll get an AfriPass ID
   immediately (e.g. `AFR-GH-7F92A31C`) and land on your dashboard.
2. **Upload a document** from the Documents tab (PDF/PNG/JPG, max 8MB).
   It starts life as "Pending".
3. **Log in as admin** at `/admin.html` (credentials from the console on
   first boot) and open the business from the pending-verification queue.
   Approve the document and set the business status to "Verified"
   (optionally check "Representative verified").
4. **View the public passport** at `/verify/<passportId>` — this is what
   customers, banks and partners see. It shows verification status, trust
   score (with an explainable breakdown, not a black box), a QR code,
   verified references, and reviews. It never shows the underlying
   documents — those stay admin-only, matching the spec's privacy rule.
5. **Register a second business**, send it a reference request from the
   first business's dashboard (References tab → enter the other
   business's AfriPass ID). The second business confirms it from its own
   dashboard, and it becomes a verified reference contributing to trust
   score.
6. **Anyone** can leave a review from the public passport page. If the
   reviewer is logged in as a business with a confirmed reference to that
   business, the review is automatically flagged "Verified transaction ✓".
7. **Enterprise/API**: `GET /api/v1/verify/:passportId` with header
   `X-API-Key: <the key printed on first run>` returns the same JSON shape
   described in the spec's section 18.

## Mobile app

There's also a full mobile app at **`/app.html`** — a Progressive Web App
(PWA) that talks to the exact same backend as the desktop pages above, so
there's nothing separate to run or keep in sync.

Open `http://localhost:3000/app.html` on a phone (or resize a desktop
browser down to a phone-sized viewport) to see it: bottom tab navigation
(Home / Scan / Account / Admin), a top bar with back navigation, and every
flow from the spec adapted for touch — registration, login, document
upload, sending/confirming references, leaving reviews, admin queue and
approval, business search, and the public passport page.

**It's genuinely installable.** It ships with a real `manifest.webmanifest`,
a full icon set (`public/icons/`, including a maskable variant for
Android's adaptive icons), and a service worker (`public/service-worker.js`)
that caches the app shell for offline use. Once it's running over HTTPS (or
on `localhost` for local testing), any browser will offer "Add to Home
Screen" / an install prompt — no App Store or Play Store submission
required. The desktop homepage links to it from a "Get the AfriPass app"
banner.

**QR scanning** uses the browser's native `BarcodeDetector` API where
available (Chrome/Android) — no external library needed. Where it isn't
supported (notably Safari/iOS as of this writing), the app falls back to
manual AfriPass ID entry, which always works everywhere.

**What "offline" actually means here**: the app shell (HTML/CSS/JS/icons)
is cached and will load with no network at all — useful for spotty
connections. API calls themselves are never cached (deliberately — this is
a trust/verification app, and caching someone's business or session data
on a shared device is the wrong default), so anything that needs live data
still needs a connection.

### If you want real App Store / Play Store distribution

The mobile app is currently a PWA, not a native binary. Two realistic next
steps if you need app-store listings specifically:
- **Capacitor** (from the Ionic team) wraps an existing PWA like this one
  into a native iOS/Android shell with minimal changes — usually the
  fastest path from what's already built here.
- **React Native / Expo** would mean a real rewrite of the frontend (the
  backend and API stay exactly as they are) — more work, but gives you
  fuller native-API access if you eventually need it (push notifications,
  native camera beyond what `BarcodeDetector` covers, etc).

Neither is set up in this repo — they're just the natural next step if a
PWA install isn't sufficient for your distribution needs.

## What's implemented (spec section 26 checklist)

- Business: registration, login, profile, AfriPass ID, dashboard, document
  upload, verification status, QR code, public passport, references,
  reviews, verification requests, settings (incl. directory opt-out).
- Public: business search/directory, passport lookup, QR verification,
  trust score with breakdown, verified references, verified reviews.
- Admin: login, verification queue, business approval, document
  approval/rejection, dashboard statistics. (Reference approval isn't a
  separate admin step in this MVP — references are self-confirmed
  business-to-business, per section 10 of the spec; admins still see them
  on the business detail view.)
- Developer/enterprise: REST API foundation with API-key auth, search
  endpoint, verification endpoint.
- Privacy split (spec section 20): the public API/pages only ever expose
  the "PUBLIC DATA" fields (name, country, industry, status, score,
  passport ID). Raw documents are served only via an admin-authenticated
  endpoint and are never linked from any public page.

Trust score matches the spec's explainable breakdown out of 100:
Business verification (35) + Documents (25) + References (20) +
Reviews (20), with the exact points always shown, never hidden.

## What's intentionally out of scope for this MVP

Straight from the spec's own "V2" list — these are the things it
correctly flags as production concerns, not MVP concerns:
- PostgreSQL / Redis / S3 (this MVP uses a JSON file + local disk instead
  of SQLite, which the spec suggested as the MVP option — same idea, even
  simpler, still a straightforward swap later)
- MFA, encryption at rest, malware scanning on uploads, a dedicated
  queryable audit-log table (document/reference actions are timestamped
  on their own records, but there's no unified log yet)
- Country-specific registry integrations (ORC/CAC/BRS/etc.) — the data
  model has a `country` field per business but no
  `country_verification_rules` / `verification_providers` tables yet
- Payments/subscriptions (Free / Business Verified / Business Pro /
  Enterprise tiers from section 23)
- Fraud/dispute workflow beyond the `suspended` / `under_review` statuses
- Multiple representatives per business, notifications, api_keys
  management UI (there's one demo key; issuing/revoking keys would need
  an admin screen)

## Moving beyond the MVP

Everything talks to `lib/store.js` — that's the only file that needs to
change to move off the JSON file:
- Swap `readDB`/`writeDB` for a real client (e.g. `pg` for Postgres) and
  turn the top-level arrays (`users`, `businesses`, `documents`, ...) into
  tables — they're already shaped that way.
- Move `uploads/` to S3-compatible private object storage; `lib/store.js`
  already isolates the "where do document bytes live" concern.
- Replace the hand-rolled router in `server.js` with Express/Fastify if
  you want middleware, but nothing here requires it — it's plain enough
  to lift into a framework whenever you want one.
- Front end is vanilla JS on purpose (no build step). It's a natural fit
  for a Next.js/React rewrite later since the API is already a clean JSON
  REST layer the frontend talks to over `fetch`.

## Deploying it

The app is production-shaped: no external DB/services required, health
check at `/api/health`, graceful shutdown on `SIGTERM`, structured env
config, rate limiting on auth endpoints, and security response headers.
Three ways to run it for real:

### Option A — Docker (recommended)

```bash
cp .env.example .env    # fill in ADMIN_EMAIL / ADMIN_PASSWORD at minimum
docker compose up -d --build
```

This builds the image, starts the container, and mounts two named
volumes (`afripass_data`, `afripass_uploads`) so your data and uploaded
documents survive container restarts/rebuilds. Put a reverse proxy in
front for TLS (see `deploy/nginx.conf.example`), and set `TRUST_PROXY=1`
in `.env` once you do, so session cookies get the `Secure` flag and rate
limiting sees real client IPs instead of the proxy's.

### Option B — Render (or similar PaaS)

`render.yaml` is a ready-to-use blueprint: push this repo to GitHub, then
in Render choose **New → Blueprint** and point it at the repo. It wires
up a persistent disk (via `STORAGE_DIR`, which redirects both `data/` and
`uploads/` under one mounted volume — useful since most PaaS free/starter
tiers only give you a single disk per service), sets `TRUST_PROXY=1`
since Render terminates TLS for you, and points the health check at
`/api/health`. Set `ADMIN_EMAIL`/`ADMIN_PASSWORD` in the dashboard (or
leave `ADMIN_PASSWORD` unset and read the generated one from the first
boot's logs). Railway and Fly.io both auto-detect the `Dockerfile` too,
if you'd rather use one of those — the same env vars apply.

### Option C — Bare VPS with systemd + nginx

```bash
sudo useradd --system --home /opt/afripass --shell /usr/sbin/nologin afripass
sudo mkdir -p /opt/afripass && sudo cp -r . /opt/afripass
sudo chown -R afripass:afripass /opt/afripass
sudo cp deploy/afripass.service /etc/systemd/system/afripass.service
sudo cp .env.example /opt/afripass/.env && sudo nano /opt/afripass/.env
sudo systemctl daemon-reload && sudo systemctl enable --now afripass
journalctl -u afripass -f   # tail logs — this is where the admin password prints on first boot
```

Then point nginx (or Caddy) at it for TLS — a starter config is at
`deploy/nginx.conf.example`, using certbot for the certificate. Set
`TRUST_PROXY=1` in `.env` when you add the proxy.

### Environment variables

See `.env.example` for the full list with comments. The ones that matter
most before going live:

| Variable | Purpose |
|---|---|
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Set both to pin the admin account instead of auto-generating one on first boot. |
| `NODE_ENV=production` | Required for the app to consider itself production-ready in its own logging; combine with TLS. |
| `TRUST_PROXY=1` | Only when behind a reverse proxy/load balancer you trust — enables `Secure` cookies and real client IPs. |
| `STORAGE_DIR` | Redirects `data/` and `uploads/` under one mounted volume — useful for single-disk PaaS hosting. |
| `PORT` / `HOST` | Defaults `3000` / `0.0.0.0`. |

### Before you consider it "live"

- [ ] `ADMIN_PASSWORD` set explicitly (or the generated one saved somewhere safe, not left in shell history/logs longer than needed)
- [ ] Running behind HTTPS, `TRUST_PROXY=1` set if there's a proxy in front
- [ ] `data/` and `uploads/` are on a volume that's actually backed up — this is a flat-file store, so back it up like you would any stateful app (the whole `data/` and `uploads/` dirs; `docker compose exec afripass tar czf - data uploads` is a simple starting point)
- [ ] Reviewed "What's intentionally out of scope for this MVP" below and decided what you actually need before onboarding real businesses' documents

## Security notes

- **Sessions**: opaque random tokens in an HttpOnly, SameSite=Lax cookie;
  gets the `Secure` flag automatically when the request is over TLS or
  `TRUST_PROXY=1` is set and the proxy says so. No CSRF token yet — fine
  for the same-origin frontend included here, worth adding if you build a
  separate frontend that calls this API cross-origin.
- **Rate limiting**: login/register/admin-login are limited per-IP
  in-process (`lib/rateLimit.js`). This does *not* coordinate across
  multiple instances behind a load balancer — fine for a single instance,
  swap for a shared store (Redis) if you scale out.
- **Passwords**: hashed with `scrypt` + per-user salt, timing-safe
  comparison. No forced password-change flow yet.
- The JSON file store has no row-level locking beyond an in-process write
  queue — fine for a single Node process, not for multiple instances
  behind a load balancer. That's the main reason to move to Postgres
  before scaling out (see "Moving beyond the MVP").
- Still missing relative to the spec's own security checklist (section
  21): MFA, encryption at rest, malware scanning on uploads, a queryable
  audit-log table (actions are timestamped on their own records, but
  there's no unified log yet), account recovery.

## Project structure

```
afripass/
  server.js              Entry point: HTTP server, routing, all API endpoints
  lib/
    store.js              JSON-file data layer, trust score & ID generation
    auth.js                Password hashing, sessions, cookies
    rateLimit.js            Per-IP fixed-window limiter for auth endpoints
  public/                 Frontend (vanilla HTML/CSS/JS, no build step)
    index.html, directory.html, register.html, login.html,
    dashboard.html, verify.html, admin.html
    app.html               Mobile app (PWA) entry point
    manifest.webmanifest    PWA install manifest
    service-worker.js       Offline app-shell caching
    icons/                 App icons (192/512/maskable/apple-touch/favicon) + source SVG
    css/style.css          Shared desktop styles
    css/mobile.css          Mobile app shell styles (tab bar, safe areas, etc.)
    js/app.js              Shared fetch helper + nav (used by both desktop and mobile)
    js/pages/*.js           Desktop per-page logic
    js/mobile/app.js        Mobile app: hash router + all views
  data/db.json            Created on first run (JSON "database")
  uploads/                Created on first run (uploaded documents)
  deploy/
    afripass.service       systemd unit for VPS deployment
    nginx.conf.example      Reverse-proxy/TLS starter config
  Dockerfile, .dockerignore, docker-compose.yml   Container deployment
  render.yaml             Render.com blueprint (persistent disk, health check)
  .env.example            All supported environment variables, documented
```
