# OpenLedgerApp

#### !! OpenLedgerApp is Pre-Release Software. OpenLedgerApp is Partially AI-Generated Software !!

---

Open-source, self-hostable double-entry accounting for very small businesses and nonprofits.

- Double-entry is enforced twice: in the app and again by a database trigger (every posted transaction needs at least 2 entries that sum to zero, with at least one debit and one credit).
- Bank imports are evidence only — they never change the ledger until you post them.
- Posted records are never edited in place: void and re-enter, so the audit trail stays intact.
- Every organization's data is isolated by row-level security in the database.

Built with React 19 + TanStack Start (Vite), Tailwind CSS v4, and Supabase (Postgres, Auth, Storage).

## Public website and release notes

The public website is at `/`; account holders use `/auth` to sign in and `/ledger` for the dashboard. `/get-started` describes the two backend setup paths and offers a development source archive. It is not a desktop installer. Desktop preview installers (Linux, Windows, macOS) are attached to GitHub releases as drafts first; see [docs/desktop.md](docs/desktop.md). The website does not advertise the preview or development demo.

See [CHANGELOG.md](CHANGELOG.md) for release notes and [BLUEPRINT.md](BLUEPRINT.md) for the original website and storage design, and [docs/architecture.md](docs/architecture.md) for the current architecture. The future free standalone desktop edition, managed cloud offering, optional donations, and synchronization are goals, not shipped features or pricing commitments.

Source ZIP downloads point to the GitHub `main` branch archive (github.com/Nox-Mob/OpenLedgerApp); the /get-started page links to it.

---

## Running the sample-data setup file manually

The sample data (the shared `demo@demo.org` / `demo1234` login and its two sample organizations) lives in `supabase/seed/demo.sql`. It is **not** a migration and never runs automatically. To load it into a development or test database:

```sh
psql "$SUPABASE_DB_URL" -f supabase/seed/demo.sql
```

- `$SUPABASE_DB_URL` is the Postgres connection string of your **dev/test** database (on Supabase: Project Settings → Database → Connection string). You need a role that can write to `auth.users` (the `postgres` superuser works).
- The script is re-runnable: every insert uses `ON CONFLICT DO NOTHING`, so running it twice is safe.
- **Never run it against a production database with real users.** It creates a publicly known login.

---

## Self-hosting: full reproduction guide

Pick **one** path for the database and sign-in service, then finish with the shared steps.

|                     | Path 1 — Cloud-hosted Supabase               | Path 2 — Self-hosted Supabase (Docker)                                 |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| Where data lives    | supabase.com                                 | Your own server                                                        |
| Effort              | Easiest                                      | More setup, 4 GB+ RAM                                                  |
| Migrations run with | `psql` on your machine or `supabase db push` | `docker exec` into the `supabase-db` container (no host `psql` needed) |

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
3. **Install the Postgres client** if you don't have `psql` (Debian/Ubuntu: `sudo apt install -y postgresql-client`; macOS: `brew install libpq`). If you see `You must install at least one postgresql-client-<version> package`, this is the fix.
4. **Apply every migration** in filename order:

   ```sh
   export SUPABASE_DB_URL="<your connection string>"
   for f in supabase/migrations/*.sql; do
     echo "Applying $f..."
     psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
   done
   ```

   Or with the Supabase CLI: `supabase link --project-ref <ref> && supabase db push`.

5. **Configure sign-in** (Authentication → Sign In / Providers): enable Email; keep email confirmation ON for production; optionally enable Google. Under URL Configuration set **Site URL** to your app's URL and add `<app-url>/reset-password` (and your local dev URL) to the redirect list.
6. **Fill in `.env`:**

   ```sh
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
   BACKUP_SIGNING_SEED=<64+ random characters, keep it stable; signs backups>
   SUPABASE_SERVICE_ROLE_KEY=<service-role key>
   LOVABLE_API_KEY=<optional, enables AI PDF import>
   ```

7. _(Optional, dev/test only)_ load sample data: `psql "$SUPABASE_DB_URL" -f supabase/seed/demo.sql`.

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

4. **Apply every migration inside the database container.** Go back to _this app's_ project folder and run the migrations through Docker — you do **not** need `psql` installed on the host:

   ```sh
   # Confirm the database container name (usually supabase-db)
   docker ps --filter "name=db" --format "{{.Names}}"

   for file in supabase/migrations/*.sql; do
     echo "Applying $file..."
     docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$file"
   done
   ```

   If `docker ps` shows a different name (e.g. `supabase-project-db-1`), use that instead of `supabase-db`.

5. **Fill in `.env`** — the browser and server values are the same here:

   ```sh
   VITE_SUPABASE_URL=http://<server-ip>:8000
   VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY>
   SUPABASE_URL=http://<server-ip>:8000
   SUPABASE_PUBLISHABLE_KEY=<ANON_KEY>
   BACKUP_SIGNING_SEED=<64+ random characters, keep it stable; signs backups>
   SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
   LOVABLE_API_KEY=<optional, enables AI PDF import>
   ```

6. **Check the sign-in URLs.** If your app's URL differs from what you entered during setup, edit `SITE_URL` and `ADDITIONAL_REDIRECT_URLS` (include `<app-url>/reset-password`) in `supabase-project/.env`, then `docker compose restart auth`.
7. _(Optional, home/lab use)_ **skip email verification.** By default, new users must click a link in a confirmation email before they can sign in. On a home server without email set up, that leaves everyone stuck. To let people use the app right after signing up, edit `supabase-project/.env` and set:

   ```sh
   MAILER_AUTOCONFIRM=true
   ```

   Then restart the auth service: `docker compose restart auth`. New sign-ups are marked as confirmed automatically. **Only do this on a private network you trust** — with it on, anyone who can reach your server can create an account with any email address, real or not. Leave it `false` anywhere the app is reachable from the internet.

8. _(Optional, dev/test only)_ load sample data:

   ```sh
   docker exec -i supabase-db psql -U postgres -d postgres < supabase/seed/demo.sql
   ```

9. **Backups.** Dump nightly and copy off the machine:

   ```sh
   docker exec supabase-db pg_dump -U postgres postgres | gzip > backup-$(date +%F).sql.gz
   # test a restore at least once:
   gunzip -c backup.sql.gz | docker exec -i supabase-db psql -U postgres postgres
   ```

Updating Supabase later: run the stack's `update.sh` from `supabase-project` (version recorded in `.supabase-version`). App and Supabase updates are independent; neither touches your data. New app migrations are applied with the same `docker exec` loop (already-applied ones may report "already exists" — only new files matter).

---

### Run the app (both paths)

```sh
npm install        # npm is the only supported package manager
npm run dev
```

Open http://localhost:8080, create your first account, and the app walks you through creating your first organization. With sample data loaded you can sign in as `demo@demo.org` / `demo1234`.

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
2. Apply migrations to the production database (`supabase db push`). Migrations are append-only; never run `supabase/seed/demo.sql` in production.
3. Set Auth → URL Configuration (Site URL + `/reset-password` redirect) to your production domain.
4. Leave `VITE_ALLOW_DEMO_LOGIN` unset.
5. Run the release checklist below.

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

Updating: `git pull && npm ci && supabase db push && npm run build && sudo systemctl restart open-ledger`. Restarting never touches data.

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
npm run check:migrations   # every public table has GRANTs + row level security
# Database rules — ONLY against a disposable database (e.g. `supabase db start`):
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
```

The database checks (`supabase/tests/*.sql`) run inside a transaction that always rolls back. They verify tenant isolation (a stranger can't read or change any org table) and ledger invariants (unbalanced/single-entry transactions rejected, entries and posted transactions immutable, voids can't be undone, books lock enforced, no cross-org entries, last admin kept).

### Continuous integration

`.github/workflows/ci.yml` runs on every push, pull request, and weekly. It **only reports** — it never formats, fixes, commits, or pushes. Blocking jobs: unit tests, type check, production build, database rules (on a fresh local database with every migration applied), and high/critical dependency vulnerabilities. Lint is reported but not blocking yet. Each failure explains which rule broke in the run summary and as inline annotations.

---

## Project layout

| Path                     | What it is                                                |
| ------------------------ | --------------------------------------------------------- |
| `src/routes/`            | Pages (TanStack Router file-based routing)                |
| `src/lib/*.functions.ts` | Server functions — all org data access goes through these |
| `src/lib/report-math.ts` | Pure report calculations (unit-tested)                    |
| `src/lib/parsers/`       | CSV / OFX / QFX / PDF bank-statement parsers              |
| `supabase/migrations/`   | Database schema, RLS policies, triggers                   |
| `supabase/seed/demo.sql` | Optional sample data (dev/test only)                      |
| `supabase/tests/`        | SQL-level security tests                                  |
| `AGENTS.md`              | Architecture rules and invariants                         |
| `roadmap.md`             | Planned work                                              |

## License

See LICENSE. This is pre-1.0 software — test it with sample data before trusting it with real books.

## Before you release

1. `npm run test`, `npm run lint`, `npm run format:check`, `npm run check:migrations` all pass.
2. `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db` passes (local throwaway DB only — the script refuses anything else).
3. `python3 scripts/smoke/smoke.py` against a dev server with the demo seed reports "No problems found."
4. Add the operator mailing address and have the Terms and Privacy Policy reviewed by counsel before release.
5. Leave `VITE_ALLOW_DEMO_LOGIN` unset in production so the shared demo login is refused.

**Startup never resets data.** Migrations only ever add to the database; CI rejects any migration containing DELETE, TRUNCATE or DROP TABLE. Restarting the app or the database keeps every organization and transaction. The demo seed refuses to load into a database that has real organizations.
