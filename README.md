# Meal Planner — Household PWA

A self-hosted weekly meal planning app for a household. Plan meals for each day and slot, manage a meal database with recipes and ingredients, generate a consolidated grocery shopping list, and share it to Sixty60 or any other app via the native share sheet.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | SvelteKit 5 (runes mode) + Tailwind CSS v4 |
| Backend | Node.js + Express + TypeScript |
| Database | SQLite via `@libsql/client` + Drizzle ORM |
| Auth | JWT in httpOnly cookie + bcrypt |
| PWA | `vite-plugin-pwa` (Workbox service worker) |
| Package manager | pnpm workspaces (monorepo) |

---

## Quick Start (Development)

### Prerequisites

- Node.js >= 20 (`winget install OpenJS.NodeJS.LTS` on Windows)
- pnpm (`npm install -g pnpm`)

### First-time setup

```bash
cd "Menu plan app"
pnpm install
```

Migrate and seed the database (only needed once, or after deleting the DB):

```bash
cd packages/api
pnpm exec tsx src/db/migrate.ts
pnpm exec tsx src/db/seed.ts
```

### Start the servers

Open **two terminals**:

**Terminal 1 — API (port 3001):**
```bash
cd packages/api
pnpm exec tsx src/index.ts
```

**Terminal 2 — Web (port 5173):**
```bash
cd packages/web
pnpm dev
```

Open **http://localhost:5173** in your browser.
On first load you are redirected to `/setup` to create the admin account.

> **Windows note:** If `pnpm` or `node` is not found, run this first in each terminal:
> $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")

---

## Project Structure

```
Menu plan app/
├── README.md
├── docs/requirements.md        <- original product requirements
├── deploy/Caddyfile.example    <- reverse proxy with HTTPS + security headers
├── .github/workflows/ci.yml    <- type-check, tests and build on every push
├── pnpm-workspace.yaml         <- monorepo roots + patched dependency overrides
│
└── packages/
    ├── api/                    <- Express backend
    │   ├── src/
    │   │   ├── index.ts            <- server entry: migrations -> image migration -> listen -> backups
    │   │   ├── config.ts           <- loads .env, validates JWT_SECRET, cookie settings
    │   │   ├── db/                 <- schema.ts, client.ts, migrate.ts, seed.ts, migrations/*.sql
    │   │   ├── middleware/auth.ts  <- requireAuth (checks the DB every request) / requireAdmin
    │   │   ├── lib/
    │   │   │   ├── generator.ts        <- auto-generate rules + scoring (pure, tested)
    │   │   │   ├── shopping.ts         <- shopping-list aggregation (pure, tested)
    │   │   │   ├── units.ts            <- g/kg, ml/l, spoon-size normalisation
    │   │   │   ├── ingredient-parser.ts<- "1 1/2 cups flour, sifted" -> qty/unit/name/notes
    │   │   │   ├── safe-fetch.ts       <- SSRF-safe page fetching for imports
    │   │   │   ├── images.ts           <- photos as content-addressed JPEG files
    │   │   │   ├── ocr.ts              <- shared Tesseract worker
    │   │   │   ├── backup.ts           <- daily backups + pruning
    │   │   │   └── csv.ts, sql.ts, sqlite.ts, params.ts, router.ts, enums.ts, jwt.ts
    │   │   └── routes/             <- auth, users, meals, planner, family, import, images
    │   ├── assets/eng.traineddata  <- OCR language data (no runtime download)
    │   ├── test/                   <- node:test unit tests (`pnpm test`)
    │   └── data/                   <- YOUR DATA (git-ignored): mealplan.db, images/, backups/
    │
    └── web/                    <- SvelteKit frontend (Svelte 5 runes + Tailwind 4 + PWA)
        └── src/
            ├── lib/
            │   ├── api.ts              <- typed client; 401 handling; offline fallbacks
            │   ├── types.ts, constants.ts, utils.ts, job.svelte.ts
            │   ├── offline/            <- IndexedDB cache, per-change outbox queue, sync, precache
            │   ├── stores/auth.ts
            │   └── components/         <- MealBrowser, MealCard, MealForm, FilterChip, Modal, OfflineIndicator
            └── routes/                 <- planner, meals, family, shopping-list, import, settings, login, setup
```

---

## API Reference

All routes require a valid session cookie except: `/auth/login`, `/auth/logout`, `/auth/setup`, `/auth/setup-status` and `/health`. Errors are `{ "error": ... }` with a 4xx/5xx status.

### Auth

| Method | Path | Notes |
|---|---|---|
| GET | `/api/auth/setup-status` | `{ setupRequired: true/false }` |
| POST | `/api/auth/setup` | `{ username, displayName, password }` — first run only |
| POST | `/api/auth/login` | `{ username, password }` — sets httpOnly cookie (rate limited) |
| POST | `/api/auth/logout` | Clears cookie |
| GET | `/api/auth/me` | Returns current user |

### Users (admin only)

| Method | Path | Body |
|---|---|---|
| GET | `/api/users` | — |
| POST | `/api/users` | `{ username, displayName, password, role }` |
| PUT | `/api/users/:id` | `{ displayName?, role? }` — a role change signs that user out; the last admin can't be demoted |
| DELETE | `/api/users/:id` | — |
| POST | `/api/users/:id/reset-password` | `{ password }` — signs that user out |

### Meals & ingredients

| Method | Path | Notes |
|---|---|---|
| GET | `/api/meals` | Filters and paging below. Each meal includes `ingredients`, `dietaryTypes`, `suitableForMemberIds`, `preferredByMemberIds` |
| POST | `/api/meals` | Create (transactional). `imageUrl` may be an `https` URL or an inline `data:image/...` (saved as a file) |
| GET | `/api/meals/:id` | Full detail (same shape as create/update responses) |
| PUT | `/api/meals/:id` | Full replace (transactional) |
| DELETE | `/api/meals/:id` | — |
| GET / POST | `/api/meals/ingredients` | `?search=` (matched literally) / `{ name, categoryId?, defaultUnit? }` |
| PATCH | `/api/meals/ingredients/:id` | `{ name?, categoryId?, defaultUnit? }` |
| GET | `/api/meals/dietary-types`, `/cuisines`, `/ingredient-categories` | Reference lists |
| PATCH | `/api/meals/ingredient-categories/:id` | **admin** `{ hiddenFromShopping }` |
| GET | `/api/images/:hash.jpg` | Meal photo (login required, cached forever) |

**Meal filter query params:**
```
search=curry                 name contains (case-insensitive, literal)
dietaryTypeIds=1,3           ALL must match
ingredientIds=4,7            meal contains ANY of these
suitableForMemberIds=1,2     meals suitable for ALL these members (meals with no record count as suitable for everyone)
preferredByMemberIds=1       preferred by ALL these members
cuisineId, difficulty, prepTimeMax, maxCost, isTested, isFavourite, isSpecialOccasion,
proteinType, mealCategory, leftoverBehaviour
limit=50&offset=0            optional paging (limit 1-500); omit for everything
```

### Planner & shopping list

| Method | Path | Notes |
|---|---|---|
| GET | `/api/planner?weekStart=YYYY-MM-DD` | All slots for the week |
| PUT | `/api/planner/:date/:slot` | `{ mealId, servings?, notes? }` — atomic upsert |
| DELETE | `/api/planner/:date/:slot` | Clear a slot |
| GET | `/api/planner/shopping-list?weekStart=…&showHidden=true` | A meal planned twice counts twice; g/kg and ml/l are merged |
| GET | `/api/planner/cost-summary?weekStart=…` | `{ weekCost, monthCost, monthlyBudget, mealsWithoutCost }` |
| POST | `/api/planner/auto-generate` | `{ days: [{ date, slot, prepTimeLimitMinutes?, leftoversRequired?, familyMemberIds? }], overwriteExisting }` |
| GET / PATCH | `/api/planner/rules`, `/rules/:id` | PATCH is **admin** only |
| GET / PATCH | `/api/planner/settings` | `{ monthlyBudget, batchCookingDay }`; PATCH is **admin** only |

Valid slots: `breakfast` `lunch` `dinner` `snack`

**Auto-generate rules.** Hard: the slot's time limit, weekly protein/category caps (counting meals already planned), and suitability for the selected family members. Scored: slot/category fit, favourites, no repeats, a different protein from the previous day, members' preferences, leftovers on leftover days, and freezable meals on the batch-cooking day. A slot with no valid meal is left as it was and reported in `unfilled`.

### Family & import

| Method | Path | Notes |
|---|---|---|
| GET / POST | `/api/family` | `{ name, role, notes?, dietaryTypeIds }` |
| PATCH / DELETE | `/api/family/:id` | — |
| POST | `/api/import/url`, `/social`, `/parse-html`, `/text`, `/csv`, `/media` | Recipe imports. URL imports only fetch public addresses; `/media` takes an image or PDF (OCR) up to 15 MB; `/csv` reports per-row warnings |
| GET | `/api/import/csv-template` | Example CSV |

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | username, display_name, password_hash, role (admin/member), token_version |
| `dietary_types`, `cuisines` | Reference lists |
| `ingredient_categories` | name, sort_order, hidden_from_shopping |
| `ingredients` | name, category_id, default_unit |
| `meals` | times, difficulty, cuisine, instructions (JSON), cost, protein_type, meal_category, leftover_behaviour, favourite/special flags, image_url (a `/api/images/…` URL or external URL) |
| `meal_dietary_types`, `meal_suitable_for`, `meal_preferred_by` | Junction tables |
| `meal_ingredients` | meal_id, ingredient_id, quantity, unit, notes |
| `meal_plans` | plan_date, meal_slot, meal_id, servings, leftovers/time limit — UNIQUE(plan_date, meal_slot) |
| `family_members`, `family_member_dietary_types` | People and their dietary needs |
| `weekly_rules` | Planner rules (protein/category caps, leftover days, batch day) |
| `user_settings` | key/value (monthly budget, batch cooking day) |
| `__migrations` | Applied SQL migrations |

**Back up `packages/api/data/`** (the database *and* the `images/` folder). The API also writes a daily backup of the database to `data/backups/` (keeps 14; `BACKUP_ENABLED=false` / `BACKUP_KEEP=n` to change) and a backup before any migration.

---

## Common Development Tasks

### Add a new page

Create `packages/web/src/routes/my-page/+page.svelte` — automatically becomes `/my-page`.
Add to `navItems` in `+layout.svelte` for nav bar entry.

### Add a database column

1. Add column in `packages/api/src/db/schema.ts`
2. Create `packages/api/src/db/migrations/0002_my_change.sql`:
   ALTER TABLE meals ADD COLUMN calories INTEGER;
3. Restart the API — migrations run on startup automatically
4. Update the Zod schema in `routes/meals.ts`
5. Add the field to `MealForm.svelte`

### Add a new API endpoint

Add a handler in the relevant `packages/api/src/routes/*.ts`.
For a new domain, create a file and register it in `index.ts`:
```ts
import { myRouter } from './routes/my-route';
app.use('/api/my-route', myRouter);
```

### Re-seed reference data

```bash
cd packages/api
pnpm exec tsx src/db/seed.ts   # safe to run multiple times
```

### Reset the database

```powershell
Remove-Item packages\api\data\mealplan.db
cd packages\api
pnpm exec tsx src/db/migrate.ts
pnpm exec tsx src/db/seed.ts
```

---

## Production Deployment (Windows home server)

This project is easiest to run on a Windows machine as a home server with:
- PM2 for process management
- Caddy as the reverse proxy on port 80
- SSH from your dev PC to trigger deployments
- one SQLite database file at `packages/api/data/mealplan.db`

### Recommended architecture

- Frontend: built SvelteKit app on port 3000
- API: Express app on port 3001
- Caddy: listens on port 80 and proxies:
  - `/api/*` -> `http://127.0.0.1:3001`
  - `/` -> `http://127.0.0.1:3000`

Browser URL: `http://192.168.1.70`

### 1. Install prerequisites on the server

```powershell
winget install OpenJS.NodeJS.LTS
npm install -g pnpm@9.15.9
npm install -g pm2
winget install CaddyServer.Caddy
winget install Git.Git
```

### 2. Clone or copy the project

```powershell
mkdir C:\dev
cd C:\dev
git clone <your-repo-url> meal-planner
cd meal-planner
pnpm install
```

If you already have the project locally, keep it in one known folder:

```text
C:\dev\meal-planner
```

### 3. Build the app

```powershell
cd C:\dev\meal-planner
pnpm install
pnpm --filter api build
pnpm --filter web build
```

Use the same Node + pnpm versions on dev and server (Node 20+, pnpm 9.x).

### 4. Create environment file (`packages/api/.env`)

```env
JWT_SECRET=replace-with-a-long-random-secret
NODE_ENV=production
PORT=3001
CLIENT_ORIGIN=http://192.168.1.70
```

The API loads this file automatically on start (see `packages/api/.env.example`). In production it **refuses to start** unless `JWT_SECRET` is set to at least 32 characters. Generate one with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Changing `JWT_SECRET` signs everyone out, so users must log in again.

If serving frontend directly on port 3000 (without Caddy), use:

```env
CLIENT_ORIGIN=http://192.168.1.70:3000
```

### 5. Start app processes with PM2

The API runs from its compiled output (`pnpm --filter api build` also copies the SQL migrations next to it); the web app runs from `build/index.js`.

```powershell
cd C:\dev\meal-planner\packages\api
$env:PORT = "3001"
$env:NODE_ENV = "production"
$env:CLIENT_ORIGIN = "http://192.168.1.70"
pm2 start "node dist/index.js" --name meal-api --cwd "C:\dev\meal-planner\packages\api"

cd C:\dev\meal-planner\packages\web
pm2 start "node build\index.js" --name meal-web --cwd "C:\dev\meal-planner\packages\web"

pm2 save
```

Check status:

```powershell
pm2 list
pm2 logs meal-api
pm2 logs meal-web
```

### 6. Configure Caddy reverse proxy (port 80)

> **Recommended:** serve the app over HTTPS using [deploy/Caddyfile.example](deploy/Caddyfile.example) (Tailscale certificates or Caddy's internal CA), then set `CLIENT_ORIGIN=https://…`. Offline mode (service worker) only works over HTTPS. The plain-HTTP setup below still works for online use.

Create:

```text
C:\caddy\Caddyfile
```

With:

```caddy
:80 {
    @api path /api/*
    reverse_proxy @api 127.0.0.1:3001

    reverse_proxy 127.0.0.1:3000
}
```
Validate and run:

```powershell
caddy validate --config C:\caddy\Caddyfile
caddy run --config C:\caddy\Caddyfile
```

Open app:

```text
http://192.168.1.70
```

### 7. First-run setup and database

On first load, open `/setup` and create the first admin account.

Database path:

```text
C:\dev\meal-planner\packages\api\data\mealplan.db
```

Back up this file regularly.

### 8. Deploy updates from dev PC (SSH + script)

On your dev PC, add this function to your PowerShell profile:

```powershell
function deploy-menu {
    param(
        [string]$Branch = "main"
    )

    ssh Albert@192.168.1.70 "powershell -NoProfile -ExecutionPolicy Bypass -File C:\dev\meal-planner\deploy.ps1 -Branch $Branch"
}
```

Run deploys with:

First push your changes to the remote repo, then on your dev PC:
```powershell
deploy-menu main
deploy-menu feature-ron
```

### 9. Server deployment script (`C:\dev\meal-planner\deploy.ps1`)

```powershell
param(
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
Set-Location C:\dev\meal-planner

Write-Host "Fetching latest changes..."
git fetch origin

Write-Host "Checking out branch: $Branch"
git checkout $Branch
git pull --ff-only origin $Branch

Write-Host "Backing up database..."
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force -Path "C:\dev\meal-planner\backups" | Out-Null
Copy-Item "C:\dev\meal-planner\packages\api\data\mealplan.db" "C:\dev\meal-planner\backups\mealplan.db.$timestamp.bak" -Force

Write-Host "Installing dependencies..."
pnpm install

Write-Host "Building API..."
pnpm --filter api build

Write-Host "Building web..."
pnpm --filter web build

Write-Host "Restarting PM2 processes..."
pm2 restart meal-api --update-env
pm2 restart meal-web --update-env
pm2 save

Write-Host "Deployment complete."
```

### 10. Operational checks

```powershell
curl http://127.0.0.1:3001/api/auth/setup-status
pm2 list
pm2 describe meal-api
pm2 describe meal-web
caddy validate --config C:\caddy\Caddyfile
```

---

## Accessing from Your Phone

1. Server IP on Windows: run `ipconfig` and find the IPv4 address (for example `192.168.1.70`)
2. Open `http://192.168.1.70` in your phone browser
3. **Android Chrome:** three-dot menu → *Add to Home screen*
4. **iOS Safari:** Share icon → *Add to Home Screen*

Recipe pages are cached offline by the service worker.

**Outside your home network:** Install [Tailscale](https://tailscale.com/) (free) on server + phone — no port forwarding needed.

---

## Security Notes

- Passwords hashed with bcrypt (12 rounds); failed logins are rate limited (10 per 15 minutes per IP)
- Sessions: JWT in httpOnly cookie — not accessible to JavaScript. The session is re-checked against the database on every request, so deleting a user, changing their role or resetting their password takes effect immediately
- The last remaining admin cannot be demoted or deleted
- `/api/auth/setup` is disabled once the first user exists (and is atomic, so it can't create two admins)
- All data routes require a valid session; admin routes check `role === "admin"`
- Recipe import by URL only fetches public `http(s)` addresses (private/LAN/loopback addresses, redirects to them and oversized pages are refused)
- Set a strong `JWT_SECRET` in production (32+ random characters); the API refuses to start without one
- The session cookie is marked `Secure` automatically when `CLIENT_ORIGIN` starts with `https://` (override with `COOKIE_SECURE=true|false`). Browsers drop Secure cookies on plain-HTTP sites, so don't force it on without HTTPS. Service workers (offline mode) also need HTTPS — for a home server, use Tailscale HTTPS certificates or Caddy's `tls internal`, then set `CLIENT_ORIGIN=https://...`.

## Tests

```bash
pnpm test           # everything (API + web)
pnpm check          # type-checks (tsc + svelte-check)
pnpm build          # production build of both packages
```

API tests (`packages/api/test`) cover the shopping list, auto-generator, ingredient parser, CSV parser, SQL splitter and the SSRF-safe fetcher. Web tests (Vitest) cover the offline queue and sync, and check that the web and API enum lists haven't drifted apart. CI runs all of this on every push (`.github/workflows/ci.yml`).

---

## Planned Features

- **Google Calendar integration** — smart meal suggestions based on your schedule
- **Nutritional info** — calories/macros per meal
- **Servings scaling** — scale shopping-list quantities by a plan's servings (needs a way to edit servings per slot)
- **Checkers Sixty60 deep link** — placeholder ready for when URI scheme is published

---

## Svelte 5 Runes Quick Reference

This project uses **Svelte 5 runes mode**. Svelte 4 syntax causes compile errors.

```svelte
<!-- Reactive state -->
let count = $state(0);
let items = $state<string[]>([]);

<!-- Derived (computed, read-only) -->
let doubled = $derived(count * 2);

<!-- Side effects -->
$effect(() => { document.title = String(count); });

<!-- Component props -->
let { name = 'default' }: { name?: string } = $props();

<!-- Event handlers (NOT on:click) -->
<button onclick={() => count++}>Click</button>
<input oninput={handleInput} />
<form onsubmit={(e) => { e.preventDefault(); save(); }}>

<!-- Render child content (NOT <slot />) -->
{@render children()}
```