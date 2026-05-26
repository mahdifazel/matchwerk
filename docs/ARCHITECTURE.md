# Architecture

A walk through how Matchwerk is put together: the system shape, the directory layout, what flows through each layer, and the technical decisions that shaped them. Everything below is derived from the code; speculative parts are flagged.

> **Update (2026-05-25).** Since this document was written, several systems were added: **Stripe payments** (token purchases + refunds), a **multi-provider AI layer** (Claude + Gemini, `src/lib/ai/*`, swap in admin), **global/admin-managed source credentials** (no longer per-user), **DB-backed plans**, and a full **admin backoffice** (`/admin`) with roles, analytics, balance gates + rate limits, GDPR tools, impersonation, announcements, budget alerts, API health, and a Stripe-events inspector. The core pipeline below (auth → sources → dedupe → score → persist → charge) is still accurate; see `CLAUDE.md` and `CHANGELOG.md` for the newer subsystems. Inline notes flag the spots that changed.

---

## 1. System shape

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Browser  (React 19)                          │
│   /login · /register · /account  — auth + account (token balance)      │
│   /                 — JobBoard component (header shows token pill)      │
│   /settings         — CvUpload + SettingsForm components               │
│   fetch JSON ↕                                                         │
├──────────────────────────────────────────────────────────────────────┤
│                  Next.js 16 server  (App Router)                       │
│                                                                        │
│   src/auth.ts / auth.config.ts  — Auth.js v5 (Google + credentials)    │
│   src/proxy.ts                  — gates page routes by session         │
│   getSessionUserId()            — every API route self-guards (401)    │
│                                                                        │
│   src/app/api/cv/route.ts          src/app/api/sources/route.ts        │
│   src/app/api/jobs/route.ts        src/app/api/settings/route.ts       │
│   src/app/api/jobs/[id]/route.ts   src/app/api/tokens/route.ts         │
│   src/app/api/jobs/bulk/route.ts   src/app/api/account/route.ts        │
│   src/app/api/jobs/refresh/route.ts  src/app/api/register/route.ts     │
│                                                                        │
│   src/lib/sources/search.ts  — tiered fetch orchestrator               │
│   src/lib/sources/*          — one file per source adapter             │
│   src/lib/cv-parser.ts       — PDF/DOCX → text → Claude tool-use       │
│   src/lib/matcher.ts         — batched Haiku scoring                   │
│   src/lib/tokens.ts          — charge / grant / lazy signup grant      │
│   src/lib/sources/dedupe.ts  — cross-source hash collapse              │
│   src/lib/sources/similarity.ts — protect starred/applied jobs         │
│                                                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   PostgreSQL 16          Anthropic API           Job source APIs       │
│   (Docker :5433)         (Sonnet + Haiku)        BA, JSearch,          │
│   via @prisma/adapter-pg                         Fantastic.jobs,       │
│   User-scoped rows +                             Adzuna                │
│   TokenLedger                                                          │
│                          Python venv (JobSpy)                          │
│                          spawned subprocess                            │
└──────────────────────────────────────────────────────────────────────┘
```

Multi-tenant: every row carries a `userId` and every query is scoped to the signed-in user (page routes via `src/proxy.ts`, API routes via `getSessionUserId()`). No queue, no worker. Refresh is a single HTTP request that runs the whole pipeline inline (sources → dedupe → score → persist → charge). That keeps the moving parts low; a long refresh holds the request open for ~10–60 s in the dev environment.

---

## 2. Directory layout

```
prisma/
├── schema.prisma           # User, Account, Session, VerificationToken, Profile, Settings, SourceCredential, Job, TokenLedger + enums
├── seed.ts                 # No-op — rows are created per-user on first use
└── migrations/             # init / add_aggregator_sources / add_fantastic_jobs_source / add_source_credentials / add_auth_multitenant / add_token_billing

scripts/
└── jobspy_bridge.py        # stdout-JSON bridge for the JobSpy adapter

src/
├── auth.ts                 # NextAuth init — Google + Credentials, JWT session, createUser event
├── auth.config.ts          # Edge-safe config (providers, pages) shared with the proxy
├── proxy.ts                # Next 16 "Proxy" — gates page routes by session
└── types/                  # next-auth session/JWT type augmentation

src/app/
├── layout.tsx              # Fonts (Inter, Fraunces, JetBrains Mono), ThemeProvider, Toaster
├── icon.svg                # Branded favicon via Next.js app/icon convention
├── globals.css             # "Atelier" design tokens (light + dark), utilities
├── page.tsx                # /         — Board
├── login/page.tsx          # /login    — Google + email/password
├── register/page.tsx       # /register — open registration
├── account/page.tsx        # /account  — name, password, token balance
├── settings/page.tsx       # /settings
└── api/
    ├── auth/[...nextauth]/route.ts     # Auth.js handlers
    ├── register/route.ts               # POST — email/password registration (+ claim, signup grant)
    ├── account/route.ts                # GET account + balance / PATCH display name
    ├── account/password/route.ts       # PUT — set/change password
    ├── tokens/route.ts                 # GET — token balance + debt
    ├── cv/route.ts                     # GET, POST(multipart, charges 25), PATCH(JSON: editable profile fields)
    ├── jobs/
    │   ├── route.ts                    # GET — tab + filter query (incl. datePosted)
    │   ├── refresh/route.ts            # POST — full pipeline, charges per job
    │   ├── [id]/route.ts               # PATCH — star/unstar/apply/unapply/delete
    │   └── bulk/route.ts               # POST  — bulk delete or bulk unapply
    ├── settings/route.ts               # GET, PUT — Zod-validated
    └── sources/
        ├── route.ts                    # GET — runtime status of each source (+ editable, credentialSource)
        └── [id]/credentials/route.ts   # GET / PUT / DELETE — per-source secret management (masked)

src/components/
├── app-header.tsx, theme-toggle.tsx, theme-provider.tsx   # header renders the token-balance pill
├── auth/                   # auth-shell.tsx, google-button.tsx (login/register UI)
├── account-form.tsx        # /account form (name, password, balance)
├── job-board.tsx           # Top-level orchestrating component for /
├── job-card.tsx            # One row in the listings grid (Star / Don't Show Again / Apply / Back to Inbox)
├── match-badge.tsx         # Exports both MatchBadge (chip) and ScoreMeter (circular SVG)
├── filter-bar.tsx          # Multi-select dropdown menus + DateFilterMenu (radio) + match-score Slider
├── refresh-button.tsx      # Primary CTA, branded
├── empty-state.tsx
├── cv-upload.tsx           # Drag-and-drop + inline editor (chips, summary textarea, Save/Discard)
├── credential-editor.tsx   # Per-source API key editor (masked status, save, clear)
├── settings-form.tsx       # Job-titles list + collapsible API credentials + collapsible Sources
└── ui/                     # shadcn primitives over @base-ui/react

src/lib/
├── prisma.ts                 # Process-singleton PrismaClient
├── anthropic.ts              # Lazy client + MODELS = { cvParse, scoring }
├── tokens.ts                 # SERVER-ONLY: TOKEN prices, getTokenAccount (lazy grant), charge, grant
├── use-token-balance.ts      # Client hook + notifyTokensUpdated() event + formatTokens()
├── claim.ts                  # claimOrphanDataForFirstUser — legacy userId=null rows → first account
├── cv-parser.ts              # extractCvText() [+ sanitize C0 bytes] + parseCvProfile() [+ suggestedJobTitles]
├── matcher.ts                # scoreJobs() — batched; role-agnostic prompt; ScoringPreferences in system block
├── repo.ts                   # getSessionUserId, getSettings (upsert by userId), getProfile (by userId)
├── constants.ts              # SOURCE_META, LOCATION_OPTIONS, DATE_POSTED_OPTIONS, TAB_STATUSES, ALL_* exports
├── credential-schema.ts      # CLIENT-SAFE: per-source editable-field defs + env-fallback names
├── credentials.ts            # SERVER-ONLY: DB-first/env-fallback resolution + masked status + per-process cache
├── infer.ts                  # inferSeniority / inferJobType (regex heuristics)
├── types.ts                  # DTOs: JobDTO, ProfileDTO, SettingsDTO, SourceStatusDTO, CredentialStatusDTO, …
├── use-source-status.ts      # Client hook → /api/sources (with refetch)
├── utils.ts                  # cn() helper
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

### 3.0 Auth & tenancy

```
Sign in (Google or email/password)  ──►  Auth.js v5  ──►  JWT session (userId)
   │                                          │
   │  first Google sign-in fires              │  email/password → POST /api/register
   │  the createUser event                    │  (bcrypt hash, then sign in)
   ▼                                          ▼
claimOrphanDataForFirstUser(userId)   ── only when userCount === 1: adopt legacy
getTokenAccount(userId)               ── apply the one-time 150-token signup grant

Page request   ──► src/proxy.ts          ── redirects to /login when unauthenticated
API request    ──► getSessionUserId()    ── returns userId or 401; every query scopes by it
```

Auth is **Auth.js v5** with a Google provider and a Credentials (email/password) provider, JWT session strategy (`src/auth.ts` / `src/auth.config.ts`). Passwords are bcrypt-hashed; OAuth-only users have `password = null`. The first account to register or sign in adopts any pre-multi-tenancy rows (`userId = null`) via `claimOrphanDataForFirstUser`; every later account is a no-op. The signup grant (150 tokens) is applied lazily by `getTokenAccount` so accounts created before billing existed still receive it on first access.

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
                                      prisma.profile.upsert({ where: { userId } })
                                              │
                                              ▼
                                      charge(userId, 25, "cv_parse")
                                              │
                                              ▼
                                       JSON ProfileDTO (+ token balance)
```

The `Profile` row is replaced wholesale on each upload — there's no history. The raw CV text is retained in `Profile.rawCvText` (was used during the scoring spike; current scoring uses the structured fields only, but the raw text remains for future features).

The `save_cv_profile` tool also returns exactly **3 `suggestedJobTitles`**. After upserting the profile, `POST /api/cv` overwrites `Settings.jobTitles` with those three and hard-deletes every `status = NEW` job — so old matches from the previous CV don't pollute the board when you upload a CV for a different role. `STARRED` and `APPLIED` are preserved.

Profile fields can also be edited in place without re-uploading via `PATCH /api/cv` — Zod-validated `{ summary?, skills?, tools?, industries?, keywords? }`, capped at 4000 chars / 200 list items.

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
preference filter    ── drop jobs that contradict Settings.defaultSeniority
                        / defaultJobTypes when narrowed (UNKNOWN passes)
   │
   ▼
scoreJobs(profile, titles, prefs, fresh)  ── batches of 10 → Claude Haiku 4.5
   │                                          system prompt: role-agnostic +
   │                                          USER PREFERENCES (seniority,
   │                                          jobTypes, locations from Settings)
   │                                          CV cached as ephemeral block
   ▼
prisma.job.createMany({ skipDuplicates: true })
   │
   ▼
charge(userId, 0.5·(rated+repeats) + 1·rated, "research")   ── only after success
   │
   ▼
{ added, scanned, reports[], tokens: { balance, charged, debtAdded } }
```

Decisions inside the pipeline:

- **`scanned`** is the *raw* count returned by sources, before dedupe.
- **`added`** is what landed in the DB.
- The orchestrator's per-source report is always 5 entries (one per source) and is rendered in the UI as the toast description.
- **Billing is last** so a run that throws isn't charged. Considered jobs are capped at `MAX_SEARCH_JOBS` (150) before scoring. A run that surfaced only repeats (nothing new to rate) still bills the 0.5/job re-display but skips scoring entirely.

### 3.2b Token billing

```
getTokenAccount(userId)   ── lazy: applies the 150 signup grant if tokensGrantedAt is null
   │                          (atomic updateMany claim — never double-grants)
   ▼
charge(userId, amount, reason, metadata?)
   │   fromBalance = min(balance, amount)
   │   debtAdded   = amount - fromBalance        ── balance floors at 0
   │   newBalance  = balance - fromBalance
   │   newDebt     = debt + debtAdded            ── UI never shows a negative
   ▼
TokenLedger row { delta: -amount, balanceAfter, reason, metadata }

grant(userId, amount, reason)   ── pays down debt first, then credits balance
```

`src/lib/tokens.ts` is the only billing surface. Prices live in the `TOKEN` constant (`SIGNUP_GRANT 150`, `CV_PARSE 25`, `PER_JOB_DISPLAY 0.5`, `PER_JOB_RATING 1`). The balance is a `Float` because charges move in 0.5 increments. The client header pill (`useTokenBalance`) refetches `GET /api/tokens` whenever a charging action dispatches the `tokens-updated` window event (`notifyTokensUpdated()`).

### 3.3 Listing — `GET /api/jobs`

```
Query string:
  tab            inbox|starred|applied          → mapped to JobStatus via TAB_STATUSES
  sources        CSV of JobSourceId              → only narrows if subset selected
  seniority      CSV of Seniority                → only narrows if subset, UNKNOWN passes
  jobTypes       CSV of JobType                  → only narrows if subset, UNKNOWN passes
  locations      CSV of location IDs             → matched via LOCATION_MATCHES table
                                                   (Berlin → "Berlin", Munich → "München"|"Munich"|"Muenchen", etc.)
  datePosted     any|24h|1w|2w|1m                → publishedAt >= cutoff
                                                   OR (publishedAt IS NULL AND fetchedAt >= cutoff)
  minScore       0..90 (steps of 10)             → matchScore >= minScore when > 0 (filters directly, not "narrow if subset")

Order:
  status == APPLIED  → appliedAt DESC
  else               → matchScore DESC, fetchedAt DESC
```

The "only narrows if subset" rule is critical for fresh jobs whose seniority/type couldn't be classified — see `src/app/api/jobs/route.ts` lines 49–67. The `datePosted` cutoff falls back to `fetchedAt` so aggregator results with no publish date aren't silently filtered.

### 3.4 Actions

| HTTP | Path | Body | Effect |
|---|---|---|---|
| `PATCH` | `/api/jobs/:id` | `{ action: "star" }` | `status = STARRED` |
| `PATCH` | `/api/jobs/:id` | `{ action: "unstar" }` | `status = NEW` |
| `PATCH` | `/api/jobs/:id` | `{ action: "apply" }` | `status = APPLIED`, `appliedAt = now()` |
| `PATCH` | `/api/jobs/:id` | `{ action: "unapply" }` | `status = NEW`, `appliedAt = null` |
| `PATCH` | `/api/jobs/:id` | `{ action: "delete" }` | `status = DELETED` (row kept for dedupe) |
| `POST` | `/api/jobs/bulk` | `{ action: "delete", ids: string[] }` | sets each row to `DELETED` |
| `POST` | `/api/jobs/bulk` | `{ action: "unapply", ids: string[] }` | unapplies (guarded by `status: "APPLIED"`) |
| `PATCH` | `/api/cv` | `{ summary?, skills?, tools?, industries?, keywords? }` | partial profile edit (Zod-validated) |
| `PUT` | `/api/settings` | full `SettingsDTO` payload | validated, source-id enum derived from `ALL_SOURCE_IDS` |
| `GET / PUT / DELETE` | `/api/sources/[id]/credentials` | per-source secrets | DB-backed credentials, masked status responses |
| `POST` | `/api/register` | `{ email, password, name? }` | Creates a user (bcrypt hash), claims orphans, applies signup grant |
| `PATCH` | `/api/account` | `{ name }` | Update display name (empty clears to null) |
| `PUT` | `/api/account/password` | `{ currentPassword?, newPassword }` | Set/change password |
| `GET` | `/api/tokens` | — | `{ balance, debt }` for the header pill |
| `GET` | `/api/account` | — | Account details + `{ tokenBalance, tokenDebt }` |

**Board UI semantics for Clear List:** on Inbox / Starred it's a non-destructive view-only clear (no DB write). On Applied it opens a confirmation dialog, then bulk-unapplies the visible jobs back to Inbox.

---

## 4. Source adapter pattern

Every adapter implements:

```ts
interface JobSource {
  id: JobSourceId;
  label: string;
  tier: "primary" | "backup" | "fallback";
  connected: boolean;                       // adapter is implemented at all
  configured(): Promise<boolean>;           // required credentials present (DB or env)
  search(params: SearchParams): Promise<RawJob[]>;
}
```

`configured()` is async because credential resolution goes through `getSourceCredentials(sourceId)` in `src/lib/credentials.ts`. **(Updated 2026-05-25: keys are now GLOBAL, not per-user.)** It resolves the `PlatformCredential` table (keyed by env-var name) before falling back to env, via `src/lib/platform.ts`. Adapters also implement `healthCheck()` (a minimal live probe for Admin → API Health). Keys are managed in **Admin → System Settings → Job sources**; a freshly-saved key takes effect on the next refresh without a restart.

The orchestrator (`src/lib/sources/search.ts`) walks `ALL_SOURCES` and buckets them by `tier`. For each tier it checks `blockedReason()`:

1. `!source.connected` → "adapter not implemented"
2. `!enabled.has(source.id)` → "disabled in settings"
3. `!(await source.configured())` → "API key not configured"

If any reason is set, the source contributes a `{ ran: false, skippedReason }` row to the report. Otherwise it runs and contributes `{ ran: true, count }`.

**Tier semantics:**

- `primary` — run unconditionally (when configured + enabled).
- `backup` — run only when primary total < 10 results.
- `fallback` — run unconditionally when allowed. Used for slow / rate-limited sources where you want results when nothing else turns up.

Each adapter is responsible for its own pagination, location-translation, error handling, and field mapping into the `RawJob` shape (`source / externalId / title / company / location / url / publisher / description / jobType / seniority / publishedAt`). Adapters never throw — they catch internally and log to `console.error("[<source-id>]", err)`.

---

## 5. Database schema

```
User (Auth.js account)            TokenLedger (append-only)
────────────────────              ────────────────────
id (cuid)                         id (cuid)
email        UNIQUE               userId        → User
name?, image?, emailVerified?     delta         (-charge / +grant)
password?    (bcrypt | null)      balanceAfter
tokenBalance     Float            reason        (signup_grant|cv_parse|research)
tokenDebt        Float            metadata?     (Json)
tokensGrantedAt?                  createdAt
                                  @@index([userId, createdAt])
Account / Session / VerificationToken  ── standard @auth/prisma-adapter tables
                                          (Session unused under JWT strategy)

Profile (one per user)            Settings (one per user)
────────────────────              ────────────────────
id (cuid)                         id (cuid)
userId?      UNIQUE  → User       userId?      UNIQUE  → User
fileName                          jobTitles[]
rawCvText                         defaultLocations[]
summary                           defaultSeniority[]
skills[], tools[],                defaultJobTypes[]
industries[], keywords[]          defaultSources[]
seniority (enum), yearsExperience updatedAt
parsedAt, updatedAt

SourceCredential                  Job
────────────────────              ────────────────────
id (cuid)                         id (cuid)
userId       → User               userId       → User
sourceId     (JobSourceId)        source       (JobSourceId enum)
secrets      (Json)               externalId, dedupeHash
updatedAt                         title, company, location, url, publisher?, description
@@unique([userId, sourceId])      jobType (enum), seniority (enum), publishedAt?
                                  matchScore?, matchExplanation?, missingSkills[], scoredAt?
                                  status (NEW|STARRED|APPLIED|DELETED), appliedAt?
                                  fetchedAt, updatedAt
                                  @@unique([userId, dedupeHash])
                                  @@index([userId, status]) @@index([status]) @@index([source])
```

Every data row carries a `userId` (`onDelete: Cascade` from `User`). `userId` is nullable on `Profile` / `Settings` / `Job` / `SourceCredential` *only* so pre-multi-tenancy rows survive migration as orphans until the first account claims them (`src/lib/claim.ts`); new rows always get the authenticated id.

`@@unique([userId, dedupeHash])` is the structural reason refresh is idempotent **per user** — `prisma.job.createMany({ skipDuplicates: true })` is the safety net even if the in-memory filter misses something.

`DELETED` rows are deliberately retained: dedupe by hash + the `findMany({ where: { dedupeHash: { in: … } } })` step in refresh permanently excludes them from future scans.

---

## 6. UI architecture

`src/components/job-board.tsx` is the orchestrating client component. It owns:

- `tab` (`"inbox" | "starred" | "applied"`, default `"inbox"`), `filters` — drive `GET /api/jobs`
- `jobs`, `loading` — refetched on tab/filter change
- `refreshing` — drives the refresh CTA state
- `pending: Set<string>` — per-job optimistic action lock
- `hasProfile` — whether to show the "no CV" alert
- `unapplyOpen`, `unapplying` — confirmation dialog state for bulk unapply on the Applied tab
- `showFilters` — collapsible filter panel
- `heroTitle` — dynamic hero title sourced from `Settings.jobTitles[0]`, refreshed on `cv-updated` / `settings-updated` window events

Cross-component sync uses two custom window events: `cv-updated` (dispatched by `cv-upload.tsx` on POST / PATCH success) and `settings-updated` (dispatched by `settings-form.tsx` on save). `SettingsForm` re-fetches `/api/settings` on `cv-updated`; `JobBoard` clears `jobs` and re-fetches the hero title.

Toasts (`sonner`) are positioned `top-center` and use the design-system tokens via the wrapper in `src/components/ui/sonner.tsx`.

The score meter (`ScoreMeter` in `src/components/match-badge.tsx`) is a hand-rolled circular SVG — a stroked background ring plus a partial foreground ring, with the score number rendered in display serif and a tier label below ("Strong fit" / "Good fit" / "Stretch" / "Unscored").

The design system lives entirely in `src/app/globals.css` under `@theme inline` (Tailwind 4 — there is no `tailwind.config.*` file). Both light and dark palettes are CSS custom properties on `:root` and `.dark`. Utilities defined there: `.font-display`, `.display-italic`, `.eyebrow`, `.dot-sep`, `.rule`, `.lift-on-hover`, `.text-gradient`.

---

## 7. Key technical decisions (in brief — see `docs/DECISIONS.md` for the why)

- **Multi-tenant with Auth.js v5.** Google + email/password; JWT session. Every row is `userId`-scoped — there is no `"singleton"` id any more (`Profile` / `Settings` are `userId @unique`). Page routes gated by `src/proxy.ts`, API routes by `getSessionUserId()`. Legacy single-tenant rows are claimed by the first account.
- **In-app token economy + Stripe (2026-05-25).** `src/lib/tokens.ts` meters AI usage (150-token signup grant; charges for CV parse and research) and tokens are now **purchasable via Stripe** (sandbox) on `/plans`. `charge()` still floors at 0 and records overspend as debt, but two **balance gates** (`src/lib/limits.ts`) now refuse CV parse below 25 tokens and Research at 0.
- **Real jobs only.** No fixtures, no mock data. Stubs return empty arrays rather than fake rows.
- **Multi-provider AI (2026-05-25).** A provider abstraction (`src/lib/ai/*`, `runWithAi`) routes CV parse + scoring through the active provider (Claude Sonnet/Haiku or Gemini Flash) with a fallback chain, switchable in admin. Claude keeps the ephemeral cache on the CV system block.
- **Tool-use / structured output over JSON parsing.** Claude uses tool-use with `tool_choice` forced; Gemini uses `responseSchema` JSON — both return a typed object, no JSON-from-text regex.
- **Role-agnostic scoring.** The system prompt derives the candidate's profession from `Settings.jobTitles[0]` and the CV — no hardcoded profession — so a new CV genuinely retargets matching.
- **Tier-driven orchestrator.** Adding a source = adding an enum value + an adapter; the orchestrator picks it up automatically.
- **DB-backed credentials with env fallback.** `getSourceCredentials(sourceId)` resolves DB → env. Saved keys take effect on the next refresh; clearing the DB row falls back to env.
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
- ~~No rate limiting / quota tracking.~~ **(Added 2026-05-25.)** Per-user **balance gates** (CV needs ≥ 25 tokens; Research needs > 0) and admin-configurable **rate limits** (research/hour, CV/day) now gate the two AI actions (`src/lib/limits.ts`), and **budget alerts** flag daily spend on the dashboard. Source-API fan-out within a refresh is still unthrottled.
- **No telemetry.** No `@vercel/analytics`, no Sentry, no Posthog — there's nothing to report failures to.
- **No tests.** See `docs/TESTING.md`.
- **No deployment recipe.** See `docs/DEPLOYMENT.md`.
- **No internationalisation.** UI strings are English-only literals in JSX.
