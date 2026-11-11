# OpenLedgerApp

> **Pre-release software, partly AI-generated.** Test it with sample data before trusting it with real books.

Open-source double-entry accounting for very small nonprofits and businesses: accounts, transactions, funds and budgets, bank import and reconciliation, reports and year-end close.

OpenLedgerApp is one of the apps of **[OpenAppHub](https://openapphub.org)**: one sign-in, organization and billing across OpenCharterApp, OpenBoardApp and OpenLedgerApp. It also runs on its own when self-hosted, and as a free desktop app for one person (Ledger Solo).

## What it does

- **Double entry, enforced twice:** in the app and again by a database trigger. Every posted transaction needs at least two entries that sum to zero, with at least one debit and one credit.
- **Bank import is evidence only:** CSV, OFX and QFX files never change the ledger until you post their rows. Reconciliation checks your statements.
- **Posted records are never edited in place:** you void and re-enter them, so the audit trail stays intact.
- **Nonprofit-ready:** funds (restricted and unrestricted), pledges, budgets by organization or project, and a board package.
- **Reports:** general ledger, account activity, funds, statement check, drill-down, year-end close, and Export all (Excel and PDF) with signed backups.
- **Isolation:** every organization's data is separated by row-level security in the database.

Release notes: [`CHANGELOG.md`](CHANGELOG.md). What's left and what's next: [`docs/epic.md`](docs/epic.md).

## Editions

|                 | Hosted (OpenAppHub)                                   | Self-hosted                                    | Desktop (Ledger Solo)           |
| --------------- | ----------------------------------------------------- | ---------------------------------------------- | ------------------------------- |
| Address         | `ledger.openapphub.org`                               | your own                                       | an app on your computer         |
| Sign-in and org | the hub (`openapphub.org`): one account for every app | Ledger's own sign-in, organizations, invites   | none: one person, one file      |
| Database        | the suite's shared Supabase project, schema `ledger`  | your own Supabase or Postgres, schema `ledger` | SQLite on your computer         |
| Billing         | the hub's plans; read-only when a plan lapses         | none: always writable                          | free                            |
| Build           | `npm run build:hosted`                                | `npm run build` (`VITE_HOSTED=false`)          | `npm run build:desktop` (Tauri) |

The desktop app doesn't have everything yet: [`docs/desktop.md`](docs/desktop.md).

## Try it

Staging is at **https://staging.ledger.staging.openapphub.org**, with the suite demo (reset every 12 hours):

| Account                    | Password             | What you see                                                      |
| -------------------------- | -------------------- | ----------------------------------------------------------------- |
| `demo@demo.openapphub.org` | `OpenAppHubDemo2026` | owns Riverside Community Association, about three months of books |
| `test@demo.openapphub.org` | `OpenAppHubDemo2026` | no organization (a first visit)                                   |

These are public on purpose and exist only on staging. To load the same demo into your own development database: `DATABASE_URL="<dev or staging connection string>" npm run db:migrate -- --seed`. It runs once per database and refuses one that holds real organizations. **Never load it into production:** it creates a publicly known sign-in.

## Development

You need Node.js 22.22+ and **npm** 11+ (the only package manager this repo uses).

```sh
git clone https://github.com/Nox-Mob/OpenLedgerApp.git
cd OpenLedgerApp
npm ci
cp .env.example .env.local   # your Supabase project's URL and publishable key
npm run dev                  # http://localhost:8080
```

Checks (CI runs the same): `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run check:migrations`, `npm run build`. More in [Running the tests](#running-the-tests).

End-to-end tests: `npm run test:e2e` (Playwright, `e2e/`).

- It starts the app on a local dev server, self-hosted (its own sign-in page), and signs in to **staging** as the suite demo accounts.
- Staging's public settings come from `wrangler.jsonc` `env.staging`, so no secrets are needed.
- In the Claude cloud sandbox: `E2E_NO_SANDBOX=1 E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npm run test:e2e`.

## Branches, CI and deploys

- **Pull requests target `staging`.** Nothing merges into `main` without the owner's approval; `main` is production.
- **Staging** is the Worker's preview of branch `staging`: `staging.ledger.staging.openapphub.org`. Any other branch builds at `<branch>.ledger.staging.openapphub.org`.
- **Production** (`ledger.openapphub.org`) deploys when `main` changes, through Cloudflare's Git integration (`npm run build:hosted`, then `wrangler deploy`). There are no deploy workflows and no Cloudflare secrets in GitHub.
- **Database:** the owner applies migrations to staging and production with Actions → **Migrate** (`migrate.yml`).
- **CI** runs on every pull request and on pushes to `staging`, and on a schedule:
  - `ci.yml`: the checks under [Continuous integration](#continuous-integration); also weekly.
  - `e2e.yml`: end-to-end on staging; also daily.
  - `desktop-check.yml`: on pull requests.
  - Only `desktop-release.yml` runs on pushes to `main`. It drafts the desktop installers.

## Self-hosting: full reproduction guide

Pick **one** path for the database and sign-in service, then finish with the shared steps.

|                     | Path 1 — Cloud-hosted Supabase | Path 2 — Self-hosted Supabase (Docker) |
| ------------------- | ------------------------------ | -------------------------------------- |
| Where data lives    | supabase.com                   | Your own server                        |
| Effort              | Easiest                        | More setup, 4 GB+ RAM                  |
| Migrations run with | `npm run db:migrate`           | `npm run db:migrate`                   |

The database is the OpenAppHub core (`db/core`: organizations, members, invitations) plus Ledger's own schema `ledger` (`db/migrations`). `npm run db:migrate` (`scripts/migrate.mjs`) applies both, each file once, in order, and records what it applied, so running it again after an update applies only the new files. Self-hosted, there is no hub and no billing: everything is always writable.

### Shared prerequisites

- **Node.js 24** (or 22.22.2+) with **npm 11+** and **Git**.
- Get the code:

  ```sh
  git clone <this-repository-url>
  cd <repository-name>
  cp .env.example .env
  ```

---

### Path 1 — Cloud-hosted Supabase (supabase.com)

1. **Create a project** at [supabase.com](https://supabase.com).
2. **Collect credentials** (Project Settings → API and → Database): project URL, publishable (anon) key, service-role key, and the database connection string (`SUPABASE_DB_URL`).
3. **Apply the database** (core plus Ledger):

   ```sh
   npm ci
   DATABASE_URL="<your connection string>" npm run db:migrate
   ```

   Use the **Session pooler** connection string (Connect → Session pooler, port 5432) if your network has no IPv6.

4. **Expose the `ledger` schema** to the app: Project Settings → Data API → **Exposed schemas**, add `ledger` (keep `public`).
5. **Configure sign-in** (Authentication → Sign In / Providers): enable Email; keep email confirmation ON for production; optionally enable Google. Under URL Configuration set **Site URL** to your app's URL and add `<app-url>/reset-password` (and your local dev URL) to the redirect list.
6. **Fill in `.env`:**

   ```sh
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
   BACKUP_SIGNING_SEED=<64+ random characters, keep it stable; signs backups>
   SUPABASE_SERVICE_ROLE_KEY=<service-role key>
   ```

7. _(Optional, dev/test only)_ load sample data: `DATABASE_URL="<connection string>" npm run db:migrate -- --seed`.

Continue with **Run the app** below.

---

### Path 2 — Self-hosted Supabase with Docker

Runs Postgres, Auth, Storage and the API on your own machine. Allow **4 GB+ RAM**.

1. **Install Supabase's Docker stack.** The quickest way is the official script:

   ```sh
   curl -fsSL https://supabase.link/setup.sh | sh
   ```

   The script supports **Linux only** (Debian/Ubuntu and RHEL/CentOS/Fedora) and will:

   - Install prerequisites (`git`, `openssl`, `jq`) and Docker Engine if not already present
   - Sparse-clone the `docker/` directory from the main Supabase repository
   - Create a project directory (`supabase-project` by default) and copy the configuration files into it
   - Record the installed release version in `.supabase-version` for future `update.sh` upgrades
   - Prompt for the main URLs (`SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, `SITE_URL`, `PROXY_DOMAIN`) and write them to `.env`
   - Generate all secrets, including a random `DASHBOARD_PASSWORD`, and the asymmetric JWT signing key pair (runs `generate-keys.sh` and `add-new-auth-keys.sh`, and enables the matching entries in `docker-compose.yml`)
   - Pull the Docker images

   > The shortened link points to `setup.sh` — inspect it first if you prefer (`curl -fsSL https://supabase.link/setup.sh -o setup.sh`, read it, then `sh setup.sh`). Use `-y` to run non-interactively with default values. Manual alternative: `git clone --depth 1 https://github.com/supabase/supabase && cd supabase/docker && cp .env.example .env`, set `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DASHBOARD_PASSWORD` yourself, then `docker compose pull && docker compose up -d`.

2. **Log out and back in.** If the script installed Docker, it added you to the `docker` group; otherwise the `docker` commands below need `sudo`.
3. **Start the stack and view credentials:**

   ```sh
   cd supabase-project && sh run.sh start
   sh run.sh secrets      # shows ANON_KEY, SERVICE_ROLE_KEY, POSTGRES_PASSWORD, ...
   ```

   The API gateway listens on port `8000`: your project URL is `http://<server-ip>:8000` (or your TLS URL if you put a proxy in front).

4. **Apply the database and expose the `ledger` schema.** From _this app's_ folder:

   ```sh
   npm ci
   DATABASE_URL="postgres://postgres.<POOLER_TENANT_ID>:<POSTGRES_PASSWORD>@<server-ip>:5432/postgres" npm run db:migrate
   ```

   (`POOLER_TENANT_ID` and `POSTGRES_PASSWORD` are in `supabase-project/.env`.) Then add `ledger` to the API's schemas: in `supabase-project/.env` set `PGRST_DB_SCHEMAS=public,storage,graphql_public,ledger` and run `docker compose restart rest`.

5. **Fill in `.env`** — the browser and server values are the same here:

   ```sh
   VITE_SUPABASE_URL=http://<server-ip>:8000
   VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY>
   SUPABASE_URL=http://<server-ip>:8000
   SUPABASE_PUBLISHABLE_KEY=<ANON_KEY>
   BACKUP_SIGNING_SEED=<64+ random characters, keep it stable; signs backups>
   SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
   ```

6. **Check the sign-in URLs.** If your app's URL differs from what you entered during setup, edit `SITE_URL` and `ADDITIONAL_REDIRECT_URLS` (include `<app-url>/reset-password`) in `supabase-project/.env`, then `docker compose restart auth`.
7. _(Optional, home/lab use)_ **skip email verification.** By default, new users must click a link in a confirmation email before they can sign in. On a home server without email set up, that leaves everyone stuck. To let people use the app right after signing up, edit `supabase-project/.env` and set:

   ```sh
   MAILER_AUTOCONFIRM=true
   ```

   Then restart the auth service: `docker compose restart auth`. New sign-ups are marked as confirmed automatically. **Only do this on a private network you trust** — with it on, anyone who can reach your server can create an account with any email address, real or not. Leave it `false` anywhere the app is reachable from the internet.

8. _(Optional, dev/test only)_ load sample data:

   ```sh
   DATABASE_URL="<connection string from step 4>" npm run db:migrate -- --seed
   ```

9. **Backups.** Dump nightly and copy off the machine:

   ```sh
   docker exec supabase-db pg_dump -U postgres postgres | gzip > backup-$(date +%F).sql.gz
   # test a restore at least once:
   gunzip -c backup.sql.gz | docker exec -i supabase-db psql -U postgres postgres
   ```

Updating Supabase later: run the stack's `update.sh` from `supabase-project` (version recorded in `.supabase-version`). App and Supabase updates are independent; neither touches your data. New app migrations are applied with the same `npm run db:migrate` (it skips what's already applied).

---

### Run the app (both paths)

```sh
npm install        # npm is the only supported package manager
npm run dev
```

Open http://localhost:8080, create your first account, and the app walks you through creating your first organization. With sample data loaded you can sign in as `demo@demo.openapphub.org` / `OpenAppHubDemo2026`.

Production build:

```sh
npm run build
npm run preview    # serves the production build
```

The app is server-rendered: pages **and** server functions run on the server, so a static-file host alone will not work. App servers are stateless and can be replaced or multiplied freely.

---

## Deploying

### Before any deployment

1. Copy `.env.example` to `.env` (or your host's secret store) and fill it in. `.env` is git-ignored — never commit it. The service-role key is server-only.
2. Apply migrations to the production database (`npm run db:migrate`; hosted: the **Migrate** workflow). Migrations are append-only; never use `--seed` in production.
3. Set Auth → URL Configuration (Site URL + `/reset-password` redirect) to your production domain.
4. Leave `VITE_ALLOW_DEMO_LOGIN` unset.
5. Run the release checklist below.

### Hosted edition (OpenAppHub)

See [Branches, CI and deploys](#branches-ci-and-deploys). **Self-hosters can ignore it and `wrangler.jsonc`:** `npm run build` builds the self-hosted app from your own `.env`.

### Option A — a single server (small office, home lab)

One Linux VM (1 vCPU / 1 GB RAM is enough for a handful of users) plus a hosted Supabase project.

```sh
# on the server
git clone <repo> /opt/open-ledger && cd /opt/open-ledger
cp .env.example .env && nano .env      # fill in values; chmod 600 .env
npm ci
npm run build
```

Run it under a process manager so it restarts on crash and boot, e.g. systemd (`/etc/systemd/system/open-ledger.service`):

```ini
[Unit]
Description=OpenLedgerApp
After=network.target

[Service]
WorkingDirectory=/opt/open-ledger
EnvironmentFile=/opt/open-ledger/.env
ExecStart=/usr/local/bin/npm run preview --host 127.0.0.1 --port 8080
Restart=always
User=openledger

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now open-ledger
```

Put a TLS reverse proxy in front (Caddy is simplest — it gets certificates automatically):

```
books.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Updating: `git pull && npm ci && DATABASE_URL=... npm run db:migrate && npm run build && sudo systemctl restart open-ledger`. Restarting never touches data.

#### Fully self-contained alternative

Use **Path 2 — Self-hosted Supabase with Docker** above on the same server, then run the app as shown here.

### Option B — at scale (many organizations / users)

```text
 users ──> CDN / load balancer (TLS)
              │
     ┌────────┼────────┐
   app #1   app #2   app #N      (stateless, identical env vars)
     └────────┼────────┘
              │
   Supabase: Postgres (+ connection pooler, read replicas)
             Auth, Storage (bank statement files)
```

- **App tier.** The build targets edge/Worker runtimes, so the lowest-effort scale path is Cloudflare Workers (`wrangler deploy`, secrets via `wrangler secret put`). Alternatively build a container image and run N replicas behind a load balancer (Kubernetes, ECS, Fly.io, Render). No sticky sessions needed — auth is a bearer token on every request. Add a `/` health check.
- **Database.** Use a paid Supabase plan (or managed Postgres you operate) with point-in-time recovery enabled. Use the connection pooler for server traffic. Scale compute vertically first; reports already page through rows, so add read replicas only when report traffic dominates.
- **Secrets.** Store keys in the platform's secret manager, not files on disk. Rotate the service-role and publishable keys on a schedule and immediately if one leaks; redeploy the app tier after rotating.
- **Releases.** Let CI (`.github/workflows/ci.yml`) pass, apply migrations first (they are additive, so old app versions keep working), then roll out app replicas gradually.
- **Monitoring & backups.** Ship server logs to a log service, alert on 5xx rates and database CPU/connections, and test restoring a backup at least quarterly.
- **Email.** Configure a custom SMTP provider in Auth so sign-up and password-reset emails aren't rate-limited.

### Running the tests

```sh
npm run test               # unit tests: money, terminology, account catalog, reports, dates, parsers, permissions
npm run check:migrations   # db/migrations: schema ledger, grants, row level security, numbering
# Database rules and performance — ONLY against a disposable Postgres (they create their own database):
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:test
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:perf
```

The database checks (`db/tests/*.sql`) build a throwaway database with the migration runner (the suite core in `db/core`, then `db/migrations`) and run inside transactions that always roll back. They verify tenant isolation (a stranger can't read or change any org table) and ledger invariants (unbalanced/single-entry transactions rejected, entries and posted transactions immutable, voids can't be undone, books lock enforced, no cross-org entries, last admin kept).

### Continuous integration

CI only reports: it never formats, fixes, commits or pushes. Each failure says which rule broke, in the run summary and as inline annotations.

- **Blocking jobs:**
  - unit tests, type check and the production build
  - database rules: Postgres 17, the runner applying core and `db/migrations`, then `db/tests`
  - performance: 5,000, 20,000 and 50,000 transactions under a 3 s budget, plus a security catalogue check
  - high and critical dependency vulnerabilities
- **Reported, not blocking yet:** lint.

When it runs: [Branches, CI and deploys](#branches-ci-and-deploys).

---

## Project layout

| Path                     | What it is                                                |
| ------------------------ | --------------------------------------------------------- |
| `src/routes/`            | Pages (TanStack Router file-based routing)                |
| `src/lib/*.functions.ts` | Server functions — all org data access goes through these |
| `src/lib/report-math.ts` | Pure report calculations (unit-tested)                    |
| `src/lib/parsers/`       | CSV / OFX / QFX bank-file parsers                         |
| `db/core/`               | Suite core (vendored from OpenAppHub; never edited here)  |
| `db/migrations/`         | Schema `ledger`: tables, RLS policies, triggers           |
| `db/tests/`, `db/perf/`  | SQL-level rule tests and the performance check            |
| `db/seed/`               | Demo data for staging and development (`--seed`)          |
| `AGENTS.md`              | Architecture rules and invariants                         |
| `roadmap.md`             | Planned work                                              |

## License

Open source. The license file hasn't been added yet (owner). This is pre-1.0 software: test it with sample data before trusting it with real books.

## Before you release

1. `npm run test`, `npm run lint`, `npm run format:check`, `npm run check:migrations` all pass.
2. `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:test` passes (it builds and drops its own throwaway database; never a real one).
3. `python3 scripts/smoke/smoke.py` against a dev server with the demo seed reports "No problems found."
4. Add the operator mailing address and have the Terms and Privacy Policy reviewed by counsel before release.
5. Leave `VITE_ALLOW_DEMO_LOGIN` unset in production so the shared demo login is refused.

**Startup never resets data.** Migrations only ever add to the database; CI rejects any migration containing DELETE, TRUNCATE or DROP TABLE. Restarting the app or the database keeps every organization and transaction. The demo seed refuses to load into a database that has real organizations.
