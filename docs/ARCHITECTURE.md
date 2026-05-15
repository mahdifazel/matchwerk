# Architecture

A walk through how Job Hunter is put together: the system shape, the directory layout, what flows through each layer, and the technical decisions that shaped them. Everything below is derived from the code; speculative parts are flagged.

---

## 1. System shape

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Browser  (React 19)                        │
│   /                 — JobBoard component                             │
│   /settings         — CvUpload + SettingsForm components             │
│   fetch JSON ↕                                                       │
├──────────────────────────────────────────────────────────────────────┤
│                  Next.js 16 server  (App Router)                     │
│                                                                      │
│   src/app/api/cv/route.ts          src/app/api/sources/route.ts      │
│   src/app/api/jobs/route.ts        src/app/api/settings/route.ts     │
│   src/app/api/jobs/[id]/route.ts                                     │
│   src/app/api/jobs/bulk/route.ts                                     │
│   src/app/api/jobs/refresh/route.ts                                  │
│                                                                      │
│   src/lib/sources/search.ts  — tiered fetch orchestrator             │
│   src/lib/sources/*          — one file per source adapter           │
│   src/lib/cv-parser.ts       — PDF/DOCX → text → Claude tool-use     │
│   src/lib/matcher.ts         — batched Haiku scoring                 │
│   src/lib/sources/dedupe.ts  — cross-source hash collapse            │
│   src/lib/sources/similarity.ts — protect starred/applied jobs       │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   PostgreSQL 16          Anthropic API           Job source APIs     │
│   (Docker :5433)         (Sonnet + Haiku)        BA, JSearch,        │
│   via @prisma/adapter-pg                         Fantastic.jobs,     │
│                                                  Adzuna              │
│                                                                      │
│                          Python venv (JobSpy)                        │
│                          spawned subprocess                          │
└──────────────────────────────────────────────────────────────────────┘
```

No queue, no worker. Refresh is a single HTTP request that runs the whole pipeline inline (sources → dedupe → score → persist). That keeps the moving parts low; a long refresh holds the request open for ~10–60 s in the dev environment.

---

## 2. Directory layout

```
prisma/
├── schema.prisma           # Profile, Settings, Job + enums
├── seed.ts                 # Settings singleton bootstrap
└── migrations/             # init / add_aggregator_sources / add_fantastic_jobs_source

scripts/
└── jobspy_bridge.py        # stdout-JSON bridge for the JobSpy adapter

src/app/
├── layout.tsx              # Fonts (Inter, Fraunces, JetBrains Mono), ThemeProvider, Toaster
├── globals.css             # "Atelier" design tokens (light + dark), utilities
├── page.tsx                # /        — Board
├── settings/page.tsx       # /settings
└── api/
    ├── cv/route.ts                     # GET, POST(multipart)
    ├── jobs/
    │   ├── route.ts                    # GET — tab + filter query
    │   ├── refresh/route.ts            # POST — full pipeline
    │   ├── [id]/route.ts               # PATCH — star/unstar/apply/delete
    │   └── bulk/route.ts               # POST  — bulk delete
    ├── settings/route.ts               # GET, PUT — Zod-validated
    └── sources/route.ts                # GET — runtime status of each source

src/components/
├── app-header.tsx, theme-toggle.tsx, theme-provider.tsx
├── job-board.tsx           # Top-level orchestrating component for /
├── job-card.tsx            # One row in the listings grid
├── match-badge.tsx         # Exports both MatchBadge (chip) and ScoreMeter (circular SVG)
├── filter-bar.tsx          # Multi-select dropdown menus
├── refresh-button.tsx      # Primary CTA, branded
├── empty-state.tsx
├── cv-upload.tsx           # Drag-and-drop + chips for parsed profile
├── settings-form.tsx       # Job-titles list + toggle groups + Sources
└── ui/                     # shadcn primitives over @base-ui/react

src/lib/
├── prisma.ts               # Process-singleton PrismaClient
├── anthropic.ts            # Lazy client + MODELS = { cvParse, scoring }
├── cv-parser.ts            # extractCvText() + parseCvProfile()
├── matcher.ts              # scoreJobs() — batched, cached system prompt
├── repo.ts                 # getSettings (upsert), getProfile
├── constants.ts            # SOURCE_META, LOCATION_OPTIONS, … , ALL_* exports
├── infer.ts                # inferSeniority / inferJobType (regex heuristics)
├── types.ts                # DTOs: JobDTO, ProfileDTO, SettingsDTO, …
├── use-source-status.ts    # Client hook → /api/sources
├── utils.ts                # cn() helper
└── sources/
    ├── index.ts            # ALL_SOURCES in tier order, re-exports searchEnabledSources
    ├── types.ts            # JobSource, RawJob, SearchParams, SourceTier
    ├── search.ts           # Tiered orchestrator with per-source reports
    ├── dedupe.ts           # dedupeHash + dedupeRawJobs
    ├── similarity.ts       # isLikelySameJob
    ├── ba-jobboerse.ts     # Free public German API
    ├── jsearch.ts          # RapidAPI aggregator
    ├── fantastic-jobs.ts   # RapidAPI Active Jobs DB (tsquery title filter)
    ├── adzuna.ts           # /de/search, pages 1..3
    └── jobspy.ts           # child_process.spawn → scripts/jobspy_bridge.py
```

The `src/generated/prisma/` directory is gitignored and regenerated by `prisma generate`. Always import types from it (`@/generated/prisma/client`, `@/generated/prisma/enums`) — never from `@prisma/client`.

---

## 3. Data flow

### 3.1 CV upload

```
Browser  ── multipart POST ────────────► /api/cv (POST)
                                              │
                                              ▼
                                      extractCvText(buffer, name)
                                              │
                            ┌─────────────────┼─────────────────┐
                            ▼                 ▼                 ▼
                          unpdf (PDF)   mammoth (DOCX)   buffer.toString (TXT/MD)
                            │                 │                 │
                            └────────► raw text (≤ 24,000 chars)
                                              │
                                              ▼
                                      parseCvProfile(text)
                                              │
                                              ▼   tool_choice: save_cv_profile
                                       Claude Sonnet 4.6
                                              │
                                              ▼
                                      prisma.profile.upsert({ id: "singleton" })
                                              │
                                              ▼
                                       JSON ProfileDTO
```

The `Profile` row is replaced wholesale on each upload — there's no history. The raw CV text is retained in `Profile.rawCvText` (was used during the scoring spike; current scoring uses the structured fields only, but the raw text remains for future features).

### 3.2 Refresh — the main pipeline

```
POST /api/jobs/refresh
   │
   ├─► getProfile()                              ── 400 if missing
   ├─► getSettings()
   │
   ▼
searchEnabledSources({ jobTitles, locations }, settings.defaultSources)
   │
   ├─► Tier 1 (primary)  : BA + JSearch + Fantastic.jobs ──► Promise.all
   ├─► Tier 2 (backup)   : Adzuna  ── runs only if Tier 1 < 10 results
   └─► Tier 3 (fallback) : JobSpy  ── runs unless blocked
   │
   ▼
dedupeRawJobs        ── collapse cross-source dupes by SHA-1 hash
   │
   ▼
findMany({ dedupeHash IN … })   ── drop anything already in DB (any status)
   │
   ▼
isLikelySameJob() vs starred+applied   ── drop cross-source title variants
   │
   ▼
scoreJobs(profile, titles, fresh)     ── batches of 10 → Claude Haiku 4.5
   │                                       (CV in cached system block)
   ▼
prisma.job.createMany({ skipDuplicates: true })
   │
   ▼
{ added, scanned, reports[] }
```

Decisions inside the pipeline:

- **`scanned`** is the *raw* count returned by sources, before dedupe.
- **`added`** is what landed in the DB.
- The orchestrator's per-source report is always 5 entries (one per source) and is rendered in the UI as the toast description.

### 3.3 Listing — `GET /api/jobs`

```
Query string:
  tab            new|starred|applied            → status filter
  sources        CSV of JobSourceId              → only narrows if subset selected
  seniority      CSV of Seniority                → only narrows if subset, UNKNOWN passes
  jobTypes       CSV of JobType                  → only narrows if subset, UNKNOWN passes
  locations      CSV of location IDs             → matched via LOCATION_MATCHES table
                                                   (Berlin → "Berlin", Munich → "München"|"Munich"|"Muenchen", etc.)

Order:
  status == APPLIED  → appliedAt DESC
  else               → matchScore DESC, fetchedAt DESC
```

The "only narrows if subset" rule is critical for fresh jobs whose seniority/type couldn't be classified — see `src/app/api/jobs/route.ts` lines 49–67.

### 3.4 Actions

| HTTP | Path | Body | Effect |
|---|---|---|---|
| `PATCH` | `/api/jobs/:id` | `{ action: "star" }` | `status = STARRED` |
| `PATCH` | `/api/jobs/:id` | `{ action: "unstar" }` | `status = NEW` |
| `PATCH` | `/api/jobs/:id` | `{ action: "apply" }` | `status = APPLIED`, `appliedAt = now()` |
| `PATCH` | `/api/jobs/:id` | `{ action: "delete" }` | `status = DELETED` (row kept for dedupe) |
| `POST` | `/api/jobs/bulk` | `{ action: "delete", ids: string[] }` | sets each row to `DELETED` |
| `PUT` | `/api/settings` | full `SettingsDTO` payload | validated, source-id enum derived from `ALL_SOURCE_IDS` |

---

## 4. Source adapter pattern

Every adapter implements:

```ts
interface JobSource {
  id: JobSourceId;
  label: string;
  tier: "primary" | "backup" | "fallback";
  connected: boolean;                 // adapter is implemented at all
  configured(): boolean;              // required env vars are set
  search(params: SearchParams): Promise<RawJob[]>;
}
```

The orchestrator (`src/lib/sources/search.ts`) walks `ALL_SOURCES` and buckets them by `tier`. For each tier it checks `blockedReason()`:

1. `!source.connected` → "adapter not implemented"
2. `!enabled.has(source.id)` → "disabled in settings"
3. `!source.configured()` → "API key not configured"

If any reason is set, the source contributes a `{ ran: false, skippedReason }` row to the report. Otherwise it runs and contributes `{ ran: true, count }`.

**Tier semantics:**

- `primary` — run unconditionally (when configured + enabled).
- `backup` — run only when primary total < 10 results.
- `fallback` — run unconditionally when allowed. Used for slow / rate-limited sources where you want results when nothing else turns up.

Each adapter is responsible for its own pagination, location-translation, error handling, and field mapping into the `RawJob` shape (`source / externalId / title / company / location / url / publisher / description / jobType / seniority / publishedAt`). Adapters never throw — they catch internally and log to `console.error("[<source-id>]", err)`.

---

## 5. Database schema

```
Profile (singleton)               Settings (singleton)
────────────────────              ────────────────────
id (= "singleton")                id (= "singleton")
fileName                          jobTitles[]
rawCvText                         defaultLocations[]
summary                           defaultSeniority[]
skills[]                          defaultJobTypes[]
tools[]                           defaultSources[]
industries[]                      updatedAt
keywords[]
seniority    (enum)
yearsExperience
parsedAt
updatedAt

Job
────────────────────
id (cuid)
source       (JobSourceId enum)
externalId
dedupeHash   UNIQUE
title, company, location, url, publisher?, description
jobType      (JobType enum)
seniority    (Seniority enum)
publishedAt?

matchScore?       (0-100 from Haiku)
matchExplanation?
missingSkills[]
scoredAt?

status       (JobStatus: NEW | STARRED | APPLIED | DELETED)
appliedAt?

fetchedAt, updatedAt

@@index([status])
@@index([source])
```

`dedupeHash @unique` is the structural reason refresh is idempotent — `prisma.job.createMany({ skipDuplicates: true })` is the safety net even if the in-memory filter misses something.

`DELETED` rows are deliberately retained: dedupe by hash + the `findMany({ where: { dedupeHash: { in: … } } })` step in refresh permanently excludes them from future scans.

---

## 6. UI architecture

`src/components/job-board.tsx` is the orchestrating client component. It owns:

- `tab`, `filters` — drive `GET /api/jobs`
- `jobs`, `loading` — refetched on tab/filter change
- `refreshing` — drives the refresh CTA state
- `pending: Set<string>` — per-job optimistic action lock
- `hasProfile` — whether to show the "no CV" alert
- `clearOpen`, `clearing` — for the bulk delete dialog
- `showFilters` — collapsible filter panel

Toasts (`sonner`) are positioned `top-center` and use the design-system tokens via the wrapper in `src/components/ui/sonner.tsx`.

The score meter (`ScoreMeter` in `src/components/match-badge.tsx`) is a hand-rolled circular SVG — a stroked background ring plus a partial foreground ring, with the score number rendered in display serif and a tier label below ("Strong fit" / "Good fit" / "Stretch" / "Unscored").

The design system lives entirely in `src/app/globals.css` under `@theme inline` (Tailwind 4 — there is no `tailwind.config.*` file). Both light and dark palettes are CSS custom properties on `:root` and `.dark`. Utilities defined there: `.font-display`, `.display-italic`, `.eyebrow`, `.dot-sep`, `.rule`, `.lift-on-hover`, `.text-gradient`.

---

## 7. Key technical decisions (in brief — see `docs/DECISIONS.md` for the why)

- **Single-user, no auth.** Profile + Settings are singletons with id `"singleton"`.
- **Real jobs only.** No fixtures, no mock data. Stubs return empty arrays rather than fake rows.
- **Two Claude models.** Sonnet 4.6 (CV parse, quality) + Haiku 4.5 (scoring, cost/speed) with ephemeral cache on the CV system block.
- **Tool-use over JSON parsing.** Both CV parsing and scoring use Anthropic tool-use with `tool_choice` forced — the SDK returns a typed `input` object, no JSON-from-text regex needed.
- **Tier-driven orchestrator.** Adding a source = adding an enum value + an adapter; the orchestrator picks it up automatically.
- **Dedupe at three levels.** Hash-based collapse in memory, `dedupeHash @unique` in the DB, similarity-based protection of starred/applied rows.
- **Prisma 7 with `@prisma/adapter-pg`.** Required to run inside Next.js server components — the default Prisma client doesn't work cleanly in the App Router runtime.
- **`serverExternalPackages`** in `next.config.ts` for `pg`, `@prisma/adapter-pg`, `mammoth`, `unpdf` — bundling them through Turbopack/webpack breaks them.
- **Python sidecar for JobSpy.** Spawned per-refresh via `child_process.spawn`. The venv lives in `.venv-jobspy/`, gitignored. A bridge script (`scripts/jobspy_bridge.py`) takes JSON on argv, prints JSON on stdout.

---

## 8. Failure modes & how the code handles them

| Failure | Where it's caught | What happens |
|---|---|---|
| `ANTHROPIC_API_KEY` missing | `getAnthropic()` | Throws with a clear message; the route returns 500 with the message in `{ error }`. |
| Source API returns non-2xx | The adapter's `fetch` block, then `.catch()` on the orchestrator's `Promise.all` | Logged to stderr with `[<source-id>]`; the orchestrator records `{ ran: true, count: 0 }`. The other sources still run. |
| JobSpy venv missing | `existsSync` check in `jobspy.ts` and `bridge` script | Skipped; logs a one-line warning telling the user how to install. |
| JobSpy subprocess hangs | `setTimeout(2 min) + proc.kill("SIGKILL")` | Resolves with `[]`. |
| Invalid PUT body | Zod `safeParse` | Returns 400 `{ error, issues }`. |
| Duplicate job insert race | `dedupeHash @unique` + `skipDuplicates: true` | Silently dropped. |
| Cross-source title variants | `isLikelySameJob` filter against starred/applied rows | Variant dropped before scoring. |
| Browser extension attribute injection | `suppressHydrationWarning` on `<html>` | React warning suppressed; functionality unaffected. |

---

## 9. What's *not* in the architecture (deliberately, or as yet)

- **No queue / no worker.** Refresh runs synchronously inside the HTTP request.
- **No retry.** A source that errors loses that refresh — there's no exponential backoff or scheduled re-fetch.
- **No rate limiting / quota tracking.** Adapters hit the source APIs as fast as `Promise.all` lets them.
- **No telemetry.** No `@vercel/analytics`, no Sentry, no Posthog — there's nothing to report failures to.
- **No tests.** See `docs/TESTING.md`.
- **No deployment recipe.** See `docs/DEPLOYMENT.md`.
- **No internationalisation.** UI strings are English-only literals in JSX.
