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
```raw

---

## Project Structure

```
Menu plan app/
├── README.md
├── pnpm-workspace.yaml         <- monorepo package roots
├── package.json
│
├── packages/
│   ├── api/                    <- Express backend
│   │   ├── src/
│   │   │   ├── index.ts            <- server entry point
│   │   │   ├── db/
│   │   │   │   ├── schema.ts           <- Drizzle table definitions
│   │   │   │   ├── client.ts           <- SQLite connection
│   │   │   │   ├── migrate.ts          <- runs SQL migrations on startup
│   │   │   │   ├── seed.ts             <- seeds reference data
│   │   │   │   └── migrations/
│   │   │   │       └── 0001_initial_schema.sql
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts             <- requireAuth / requireAdmin
│   │   │   ├── lib/
│   │   │   │   └── jwt.ts              <- sign / verify JWT
│   │   │   └── routes/
│   │   │       ├── auth.ts             <- /api/auth/*
│   │   │       ├── users.ts            <- /api/users/* (admin only)
│   │   │       ├── meals.ts            <- /api/meals/* + /api/ingredients/*
│   │   │       └── planner.ts          <- /api/planner/* + shopping-list
│   │   ├── data/
│   │   │   └── mealplan.db         <- YOUR DATABASE — back this up!
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                    <- SvelteKit frontend
│       ├── src/
│       │   ├── app.html            <- HTML shell + PWA meta tags
│       │   ├── app.css             <- @import tailwindcss
│       │   ├── lib/
│       │   │   ├── api.ts              <- all fetch() calls to the API
│       │   │   ├── types.ts            <- shared TypeScript types
│       │   │   ├── utils.ts            <- date helpers, MEAL_SLOTS, constants
│       │   │   ├── stores/
│       │   │   │   └── auth.ts         <- logged-in user Svelte store
│       │   │   └── components/
│       │   │       └── MealForm.svelte <- add/edit meal form (shared)
│       │   └── routes/
│       │       ├── +layout.svelte      <- nav bar + auth guard
│       │       ├── +page.svelte        <- / redirects to /planner
│       │       ├── login/
│       │       ├── setup/              <- first-run admin creation
│       │       ├── planner/            <- weekly calendar grid + meal picker
│       │       ├── meals/
│       │       │   ├── +page.svelte        <- meal browser + filters
│       │       │   ├── new/
│       │       │   └── [id]/
│       │       │       ├── +page.svelte    <- recipe detail
│       │       │       └── edit/
│       │       ├── shopping-list/      <- grocery list + share
│       │       └── settings/           <- user management + sign out
│       ├── vite.config.ts      <- Tailwind + PWA plugins, /api proxy
│       └── package.json
```raw

---

## API Reference

All routes require a valid session cookie except: `/auth/login`, `/auth/logout`, `/auth/setup`, `/auth/setup-status`.

### Auth

| Method | Path | Notes |
|---|---|---|
| GET | `/api/auth/setup-status` | `{ setupRequired: true/false }` |
| POST | `/api/auth/setup` | `{ username, displayName, password }` — first run only |
| POST | `/api/auth/login` | `{ username, password }` — sets httpOnly cookie |
| POST | `/api/auth/logout` | Clears cookie |
| GET | `/api/auth/me` | Returns current user |

### Users (admin only)

| Method | Path | Body |
|---|---|---|
| GET | `/api/users` | — |
| POST | `/api/users` | `{ username, displayName, password, role }` |
| PUT | `/api/users/:id` | `{ displayName?, role? }` |
| DELETE | `/api/users/:id` | — |
| POST | `/api/users/:id/reset-password` | `{ password }` |

### Meals & Ingredients

| Method | Path | Notes |
|---|---|---|
| GET | `/api/meals` | Filter query params below |
| POST | `/api/meals` | Create with ingredients + instructions |
| GET | `/api/meals/:id` | Full detail |
| PUT | `/api/meals/:id` | Full replace |
| DELETE | `/api/meals/:id` | — |
| GET | `/api/meals/ingredients` | `?search=` |
| POST | `/api/meals/ingredients` | `{ name, categoryId?, defaultUnit? }` |
| GET | `/api/meals/dietary-types` | Reference list |
| GET | `/api/meals/cuisines` | Reference list |
| GET | `/api/meals/ingredient-categories` | Reference list |

**Meal filter query params:**
```
search=curry
dietaryTypeIds=1,3          comma-separated, ALL must match
cuisineId=2
difficulty=easy|medium|hard
prepTimeMax=30              prep minutes
ingredientIds=4,7           meals containing ANY of these
isTested=true|false

### Planner & Shopping List

| Method | Path | Notes |
|---|---|---|
| GET | `/api/planner?weekStart=YYYY-MM-DD` | All slots for the week |
| PUT | `/api/planner/:date/:slot` | `{ mealId, servings, notes? }` |
| DELETE | `/api/planner/:date/:slot` | Clear a slot |
| GET | `/api/planner/shopping-list?weekStart=YYYY-MM-DD` | Aggregated, grouped by category |

Valid slots: `breakfast` `lunch` `dinner` `snack`

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | id, username, display_name, password_hash, role (admin/member) |
| `dietary_types` | id, name, icon |
| `cuisines` | id, name |
| `ingredient_categories` | id, name, sort_order |
| `ingredients` | id, name, category_id, default_unit |
| `meals` | name, times, difficulty, cuisine_id, instructions (JSON), is_tested, created_by_user_id |
| `meal_dietary_types` | meal_id, dietary_type_id (junction table) |
| `meal_ingredients` | meal_id, ingredient_id, quantity, unit, notes |
| `meal_plans` | plan_date, meal_slot, meal_id, servings — UNIQUE(plan_date, meal_slot) |
| `user_settings` | key, value (household key/value store) |

**Only file you need to back up:** `packages/api/data/mealplan.db`

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

If serving frontend directly on port 3000 (without Caddy), use:

```env
CLIENT_ORIGIN=http://192.168.1.70:3000
```

### 5. Start app processes with PM2

```powershell
cd C:\dev\meal-planner\packages\api
$env:PORT = "3001"
$env:NODE_ENV = "production"
$env:CLIENT_ORIGIN = "http://192.168.1.70"
pm2 start "pnpm exec tsx src/index.ts" --name meal-api --cwd "C:\dev\meal-planner\packages\api"

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

- Passwords hashed with bcrypt (12 rounds)
- Sessions: JWT in httpOnly cookie — not accessible to JavaScript
- `/api/auth/setup` is disabled once the first user exists
- All data routes require a valid session; admin routes check `role === "admin"`
- Set a strong `JWT_SECRET` in production (32+ random characters)

---

## Planned Features

- **Google Calendar integration** — smart meal suggestions based on your schedule
- **Offline sync** — write-while-offline, sync on reconnect via IndexedDB queue
- **Nutritional info** — calories/macros per meal
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