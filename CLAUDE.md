# CLAUDE.md — Job Hunter

A guide for engineers (and Claude) working on this codebase. Read top-to-bottom on day one. Everything below is derived from the code as it exists today; anything not present in the codebase is explicitly flagged as such.

---

## 1. Project overview

**Job Hunter** is a single-user web app that pulls real Product Design job listings from German job boards, deduplicates them across sources, scores each listing against the user's CV via Claude, and presents them in a board where the user can star, mark applied, or hide jobs.

It exists for one person: the project owner, who is searching for Product Designer / Senior Product Designer / UX-UI roles in Berlin, Munich, Hamburg and remote-Germany. **There is no authentication and no multi-tenant model** — the Profile row and Settings row are hard-coded singletons with id `"singleton"`.

**Real jobs only.** No fixture/mock data is ever shown. Sources without API credentials surface as visibly inactive in the UI.

---

## 2. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16.2.6 (App Router, Turbopack dev) | `next.config.ts` declares `pg`, `@prisma/adapter-pg`, `mammoth`, `unpdf` as `serverExternalPackages` |
| Language | TypeScript 5, strict, ES2017 target, `module: esnext` | Alias `@/*` → `./src/*` |
| UI | React 19, Tailwind CSS 4, `shadcn/ui` (style: `base-nova`), `@base-ui/react` primitives, `lucide-react` icons, `next-themes` | Tailwind 4 is config-less — tokens live in `src/app/globals.css` under `@theme inline` |
| Fonts | `Inter` (sans body), `Fraunces` (editorial display), `JetBrains Mono` (tabular) — all via `next/font/google` with CSS vars `--font-jh-sans`, `--font-jh-display`, `--font-jh-mono` |
| Database | PostgreSQL 16 (alpine) in Docker on port **5433** | `docker-compose.yml`. Credentials: `jobhunter` / `jobhunter` / db `jobhunter` |
| ORM | Prisma 7.8 with `@prisma/adapter-pg` | Custom client output at `src/generated/prisma` (gitignored) |
| AI | Anthropic SDK 0.96.0 | Sonnet 4.6 for CV parsing, Haiku 4.5 for scoring with CV cached as ephemeral system block |
| File parsing | `mammoth` (DOCX), `unpdf` (PDF) — plus inline TXT/MD |
| Validation | `zod` 4 |
| Toasts | `sonner` |
| Lint | `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript` |
| Scraping fallback | `python-jobspy` (Python 3.10+) running in `.venv-jobspy/`, spawned from Node via `child_process.spawn` |

---

## 3. Directory structure

```
Job_Hunter/
├── docker-compose.yml          # Postgres 16 on :5433
├── prisma/
│   ├── schema.prisma           # Models: Profile, Settings, Job; enums for source/status/type/seniority
│   ├── seed.ts                 # Upserts the Settings singleton
│   └── migrations/             # Three so far: init, add_aggregator_sources, add_fantastic_jobs_source
├── prisma.config.ts            # Loads schema + DATABASE_URL via dotenv
├── scripts/
│   └── jobspy_bridge.py        # Python bridge for the JobSpy adapter
├── .venv-jobspy/               # Gitignored Python venv for jobspy
├── public/                     # Static assets
└── src/
    ├── app/
    │   ├── layout.tsx          # Loads fonts, ThemeProvider, Toaster
    │   ├── globals.css         # Atelier design system: palette + tokens + utilities
    │   ├── page.tsx            # Board page (job feed)
    │   ├── settings/page.tsx   # CV upload + search preferences
    │   └── api/
    │       ├── cv/route.ts             # GET + POST (multipart) parsed profile
    │       ├── jobs/route.ts           # GET filtered listings by tab
    │       ├── jobs/refresh/route.ts   # POST → orchestrates source fetch, dedupe, score, persist
    │       ├── jobs/[id]/route.ts      # PATCH star/unstar/apply/delete
    │       ├── jobs/bulk/route.ts      # POST bulk delete
    │       ├── settings/route.ts       # GET + PUT
    │       └── sources/route.ts        # GET runtime source status
    ├── components/
    │   ├── app-header.tsx, theme-toggle.tsx, theme-provider.tsx
    │   ├── job-board.tsx, job-card.tsx, match-badge.tsx (exports ScoreMeter)
    │   ├── filter-bar.tsx, refresh-button.tsx, empty-state.tsx
    │   ├── cv-upload.tsx, settings-form.tsx
    │   └── ui/                 # shadcn primitives wrapping @base-ui/react
    └── lib/
        ├── prisma.ts           # Global Prisma client (dev-mode warning logs)
        ├── anthropic.ts        # Lazy client + MODELS constant + hasAnthropicKey()
        ├── cv-parser.ts        # extractCvText (PDF/DOCX/TXT) + parseCvProfile (Claude tool-use)
        ├── matcher.ts          # scoreJobs — batched Haiku tool-use with cached CV in system
        ├── repo.ts             # getSettings (upsert), getProfile, SINGLETON id
        ├── constants.ts        # SOURCE_META, LOCATION_OPTIONS, SENIORITY/JOBTYPE options
        ├── infer.ts            # inferSeniority / inferJobType regex heuristics
        ├── types.ts            # DTOs sent over the wire
        ├── use-source-status.ts # Client hook fetching /api/sources
        ├── utils.ts            # cn() helper
        └── sources/
            ├── index.ts        # ALL_SOURCES (in tier order)
            ├── types.ts        # JobSource, RawJob, SearchParams interfaces
            ├── search.ts       # Tiered orchestrator (primary → backup → fallback)
            ├── dedupe.ts       # SHA-1 hash from normalized title|company|city
            ├── similarity.ts   # isLikelySameJob — used to protect starred/applied jobs
            ├── ba-jobboerse.ts # Public German API, no key
            ├── jsearch.ts      # RapidAPI aggregator
            ├── fantastic-jobs.ts # RapidAPI Active Jobs DB (tsquery title filter)
            ├── adzuna.ts       # Adzuna /de/search
            └── jobspy.ts       # Spawns the Python bridge
```

---

## 4. Architecture & data flow

### CV upload (one-time per CV)
1. User drops a PDF/DOCX/TXT in `/settings`.
2. `POST /api/cv` reads the file (≤ 8 MB), routes to `extractCvText` (`unpdf` for PDF, `mammoth` for DOCX, raw for TXT/MD).
3. `parseCvProfile` calls **Sonnet 4.6** with a `save_cv_profile` tool. Tool result populates `summary / skills / tools / industries / keywords / seniority / yearsExperience`.
4. `prisma.profile.upsert({ id: "singleton" })` — replaces the previous profile wholesale.

### Refresh (the main loop)
`POST /api/jobs/refresh` (`src/app/api/jobs/refresh/route.ts`):
1. Requires a CV profile; refuses with 400 otherwise.
2. Reads `Settings` (job titles, default locations, enabled sources).
3. **`searchEnabledSources`** (`src/lib/sources/search.ts`) runs sources by tier:
   - **Primary** (`BA_JOBBOERSE`, `JSEARCH`, `FANTASTIC_JOBS`) in parallel.
   - **Backup** (`ADZUNA`) only if the primary tier returned fewer than **10** results total.
   - **Fallback** (`JOBSPY`) runs unless blocked (disabled / no key / adapter not connected).
   - Each source reports `{ ran, count, skippedReason? }`.
4. `dedupeRawJobs` collapses cross-source duplicates by SHA-1 of `normalize(title)|normalize(company)|normalize(city)` (after stripping gender markers like `(m/w/d)`).
5. Filter against the DB by `dedupeHash` — anything already stored (any status, including `DELETED`) is dropped, so previously-hidden jobs stay hidden.
6. Filter again with `isLikelySameJob` (`src/lib/sources/similarity.ts`) against starred/applied jobs — catches cross-source title variants like *"Senior Product Designer — parental leave cover"*.
7. **`scoreJobs`** (`src/lib/matcher.ts`) batches the fresh jobs (10 per call) and asks **Haiku 4.5** to populate a `save_scores` tool with `{ score 0-100, explanation, missingSkills[] }`. The profile is sent in `system` with `cache_control: { type: "ephemeral" }` so the same CV doesn't re-cost across batches.
8. `prisma.job.createMany({ skipDuplicates: true })`.

### Board listing (`GET /api/jobs`)
Filters by tab (`new` / `starred` / `applied` → `NEW` / `STARRED` / `APPLIED`), `sources`, `seniority`, `jobTypes`, `locations`. **Defensive filter rule**: a filter only narrows when the user has deselected at least one option; when everything is on (the default), no filter is applied — otherwise `UNKNOWN`-classified jobs would be hidden. When narrowed, `UNKNOWN` is always included so listings aren't lost to weak classification. See lines 49–67 of `src/app/api/jobs/route.ts`.

Order: starred/new sort by `matchScore DESC, fetchedAt DESC`; applied sorts by `appliedAt DESC`.

### Job actions (`PATCH /api/jobs/[id]`)
Single action enum: `star / unstar / apply / delete`. Deletes set status to `DELETED` (the row stays so dedupe permanently excludes it).

---

## 5. Database model

`prisma/schema.prisma`:

- **`Profile`** singleton — `fileName`, full `rawCvText`, structured fields, `parsedAt`, `updatedAt`.
- **`Settings`** singleton — `jobTitles[]`, `defaultLocations[]`, `defaultSeniority[]`, `defaultJobTypes[]`, `defaultSources[]`.
- **`Job`** — `source` (enum), `externalId`, `dedupeHash @unique`, title/company/location/url/description, `publisher` (for aggregators), `jobType`/`seniority` enums, `publishedAt`, `matchScore`/`matchExplanation`/`missingSkills[]`/`scoredAt`, `status` (`NEW`/`STARRED`/`APPLIED`/`DELETED`), `appliedAt`. Indexed by `status` and `source`.
- **Enums** — `JobSourceId` (`BA_JOBBOERSE`, `JSEARCH`, `ADZUNA`, `JOBSPY`, `FANTASTIC_JOBS`, plus 6 legacy values kept for historical rows: `INDEED`, `LINKEDIN`, `STEPSTONE`, `XING`, `GLASSDOOR`, `MONSTER`); `JobStatus`; `Seniority`; `JobType`.

The Prisma client is generated to `src/generated/prisma/` (gitignored) — import types from `@/generated/prisma/client` and `@/generated/prisma/enums`.

---

## 6. Setup instructions

```bash
# 1. Install Node deps
npm install

# 2. Environment — two gitignored files (see .env.example):
#    .env       → DATABASE_URL (Prisma reads .env, not .env.local)
#    .env.local → ANTHROPIC_API_KEY and source API keys
#
#    Copy the example, then fill in real values.

# 3. Start Postgres in Docker (port 5433)
npm run db:up

# 4. Apply schema migrations
npm run db:migrate

# 5. Seed the Settings singleton (jobTitles defaults, all sources enabled)
npm run db:seed

# 6. (Optional) Set up the JobSpy Python venv if you want the scraping fallback
python3.12 -m venv .venv-jobspy
.venv-jobspy/bin/pip install python-jobspy

# 7. Dev server (Turbopack)
npm run dev   # http://localhost:3000
```

**First-run checklist:**
1. Open `/settings`, drop a CV → wait for the toast.
2. Open `/`, click **Research jobs** → results stream in 5–60s depending on which sources are configured.

---

## 7. Key commands (from `package.json`)

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server on :3000 (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run lint` | `eslint` |
| `npm run db:up` | `docker compose up -d` — Postgres on :5433 |
| `npm run db:migrate` | `prisma migrate dev` — applies & creates migrations |
| `npm run db:seed` | `tsx prisma/seed.ts` |
| `npm run db:studio` | `prisma studio` — DB browser |

**Not present** (flagged): no `test`, `test:watch`, or `typecheck` script. Typecheck is `npx tsc --noEmit`.

---

## 8. Environment variables

`.env` (loaded by Prisma):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string. For local Docker: `postgresql://jobhunter:jobhunter@localhost:5433/jobhunter?schema=public` |

`.env.local` (loaded by Next.js):

| Variable | Required by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `getAnthropic()` | CV parsing + job scoring. App refuses to parse a CV without it. |
| `JSEARCH_API_KEY` | `jsearch` adapter | RapidAPI key for JSearch |
| `FANTASTIC_JOBS_API_KEY` | `fantastic-jobs` adapter | RapidAPI key for Active Jobs DB. Can reuse the JSearch key (same RapidAPI account). |
| `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | `adzuna` adapter | Free credentials at developer.adzuna.com |
| `JOBSPY_SITES` | `jobspy` adapter | Optional comma-separated override. Default: `indeed,glassdoor`. LinkedIn intentionally left out — it aggressively blocks scrapers. |

Sources without their key set surface in the UI as disabled with the hint *"Key needed"* — the toggle is greyed and `configured: false` comes back from `GET /api/sources`.

**Security**: `.env` and `.env.local` are both gitignored. Never paste secrets in chat or in tracked files.

---

## 9. Coding conventions

Strictly observed in the existing code:

- **TypeScript strict mode**. No `any` outside of narrow tool-input casts (`block.input as { … }`) at trust boundaries.
- **Path alias** `@/*` → `src/*`. Use it; never write deep relative imports.
- **Imports** ordered as: node built-ins → external → `@/…` → relative `./…`, with blank-line separation in some files. Match the surrounding file's style if mixed.
- **Comments** are scarce. They're present only where the *why* would be non-obvious (e.g. the "UNKNOWN passes the narrow-filter" comment in `jobs/route.ts:46-48`; the threshold rationale on `search.ts:8-10`). Don't add explanatory comments for code that's already self-evident.
- **Server-only files** never import client-only deps. Adapters in `src/lib/sources/*` use `process.env` directly and are imported by route handlers under `src/app/api/`.
- **Client components** carry the `"use client"` directive on the top line (`job-board.tsx`, `cv-upload.tsx`, `settings-form.tsx`, etc.). Server components don't.
- **Zod** is used at every external boundary that takes JSON (`PATCH /jobs/[id]`, `PUT /settings`, `POST /jobs/bulk`). The Settings PUT derives its source-id enum from `ALL_SOURCE_IDS` so adding a source doesn't require updating the schema.
- **Errors**: route handlers always return `{ error: string }` with a 4xx/5xx code on failure; the client surfaces these via `sonner.toast.error`.
- **Singleton ids**: any code dealing with `Profile` or `Settings` uses the constants `PROFILE_ID` / `SETTINGS_ID` (= `"singleton"`) from `src/lib/repo.ts`.
- **Source adapters** all implement `JobSource` from `src/lib/sources/types.ts`: `id / label / tier / connected / configured() / search(params)`. Adding a source requires (a) adding the enum value to `prisma/schema.prisma` and running a migration, (b) the new adapter file, (c) entries in `ALL_SOURCES` (`src/lib/sources/index.ts`) and `SOURCE_META` (`src/lib/constants.ts`), (d) an env var stub in `.env.example`. The orchestrator picks it up automatically based on `tier`.

**Design system** (`src/app/globals.css`): warm cream paper background, deep ink foreground, chartreuse as the single accent. CSS custom properties drive both light and dark modes. Utilities: `.font-display` (Fraunces 550, opsz 96), `.display-italic`, `.eyebrow` (uppercase tracked), `.dot-sep` (middot separator), `.rule`, `.lift-on-hover`.

---

## 10. Things a new developer should know

- **There is no test suite.** `package.json` has no `test` script and no `*.test.*` / `*.spec.*` files. Adding one would be the first contribution — see `docs/TESTING.md`.
- **There is no CI.** No `.github/workflows`. Pre-merge checks would need to be added.
- **There is no Dockerfile for the app itself** — only `docker-compose.yml` for Postgres. The app is meant to be run locally with `npm run dev` or built and started with `npm start`. Production deployment is not documented in the repo — see `docs/DEPLOYMENT.md`.
- **There is no license file.** `package.json` has no `license` field and there is no `LICENSE`. Treat the code as "all rights reserved" until the owner declares one.
- **Six legacy enum values** (`INDEED`, `LINKEDIN`, etc.) exist on `JobSourceId` for historical rows only. Do not surface them in the UI or add adapters for them — the project memory rejects scraping LinkedIn/Glassdoor directly.
- **JobSpy needs Python 3.10+**. macOS system Python is often 3.9 — use Homebrew Python (`/opt/homebrew/bin/python3.12`).
- **Hydration warning at boot** is harmless and comes from browser extensions (`cz-shortcut-listen`).
- **Memory-resident state**: `src/lib/prisma.ts` keeps a single Prisma client across dev-mode hot reloads via `globalThis`. Don't `new PrismaClient()` anywhere else.

---

## 11. AGENTS.md (already in repo)

The repo includes a short `AGENTS.md` flagging that this is Next.js 16 and that APIs differ from common training data. Read `node_modules/next/dist/docs/` before assuming a Next.js 13/14 idiom still works (e.g. `searchParams` is now a Promise in dynamic route handlers; see `src/app/api/jobs/[id]/route.ts` line 12).
