# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Multi-tenancy with Auth.js, and an in-app token economy that meters AI usage.

### Added — Accounts & multi-tenancy

- **Auth.js v5 (NextAuth)** with two providers: Google OAuth and email/password credentials (open registration, bcrypt-hashed). `src/auth.ts` / `src/auth.config.ts`; JWT session strategy.
- New Prisma models: `User`, `Account`, `Session`, `VerificationToken` (standard `@auth/prisma-adapter` tables). `User.password` is a bcrypt hash for credential users, `null` for OAuth-only accounts.
- Every data model (`Profile`, `Settings`, `Job`, `SourceCredential`) gains a `userId` and is scoped to its owner. `Profile` / `Settings` are now one-per-user (`userId @unique`) instead of `id = "singleton"`. `Job` dedupe uniqueness is per-user (`@@unique([userId, dedupeHash])`).
- Page routes gated by `src/proxy.ts` (Next 16 "Proxy"); API routes self-guard with a JSON 401 via `getSessionUserId()`.
- New routes: `/api/auth/[...nextauth]`, `POST /api/register`, `GET/PATCH /api/account`, `PUT /api/account/password`. New pages: `/login`, `/register`, `/account`.
- **Orphan claim**: legacy single-tenant rows (`userId = null`) are adopted by the first account to register or sign in — `claimOrphanDataForFirstUser` in `src/lib/claim.ts`, guarded by `userCount === 1`.
- Migration `20260524154733_add_auth_multitenant`.
- `prisma/seed.ts` is now a no-op — Settings/Profile are created per-user on first use; `repo.ts` drops the `"singleton"` id in favour of `userId`-keyed `getSettings` / `getProfile`.

### Added — Token billing

- In-app token economy in `src/lib/tokens.ts`. Prices: **signup grant 150**, **CV parse 25**, **0.5 per job displayed**, **1 per job freshly rated**. Limits: `MAX_SEARCH_JOBS 150` (considered per refresh), `MAX_BOARD_JOBS 70` (Inbox listing). Balances use 0.5 increments (`Float`).
- New `User` columns `tokenBalance`, `tokenDebt`, `tokensGrantedAt`, and an append-only `TokenLedger` model (`delta`, `balanceAfter`, `reason`, `metadata?`, indexed `[userId, createdAt]`). Migration `20260524180753_add_token_billing`.
- `getTokenAccount(userId)` applies the one-time 150 grant lazily (atomic `updateMany` claim — never double-grants); fired on first Google sign-in (`createUser` event) and on email/password registration.
- `charge()` never blocks the run: balance floors at 0 and overspend is recorded as `tokenDebt`, so the UI never shows a negative. One ledger row per charge. `grant()` pays down debt first.
- Charging wired into `POST /api/cv` (25 per upload; inline `PATCH` edits are free) and `POST /api/jobs/refresh` (billed after the run succeeds; repeats-only runs bill re-display but never re-rate).
- Balance surfaced via `GET /api/tokens` and `GET /api/account`; a header pill (`useTokenBalance`) refetches on a `tokens-updated` window event (`notifyTokensUpdated()` fired from the board and CV upload).

## [1.1.0] — 2026-05-16

Source-credential management in the UI, editable CV profile, personalized matching, and a board UX rework.

### Added — In-app source credentials

- New `SourceCredential` Prisma model: per-source `secrets: JSONB` keyed by `JobSourceId`, with `updatedAt`.
- Migration `20260515204929_add_source_credentials`.
- `src/lib/credential-schema.ts` (client-safe) declares which fields each source needs and which env var to fall back to. `JSEARCH` / `FANTASTIC_JOBS` / `ADZUNA` are editable; `BA_JOBBOERSE` and `JOBSPY` are not.
- `src/lib/credentials.ts` (server-only) resolves DB-first / env-fallback, caches per-process, and exposes masked-tail status (never returns raw values over the wire).
- New routes: `GET / PUT / DELETE /api/sources/[id]/credentials`. `GET /api/sources` now also reports `editable` and `credentialSource: "db" | "env" | "none"`.
- New `CredentialEditor` component in the Settings page lets the user paste a key, save it, see the masked tail, and clear back to env fallback.

### Added — Editable CV profile

- `PATCH /api/cv` accepts `{ summary?, skills?, tools?, industries?, keywords? }` (Zod-validated; trims, dedupes empty strings, caps lists at 200, summary ≤ 4000 chars).
- `cv-upload.tsx` now renders an inline editor: textarea for summary, deletable chips + an "Add" input for each list field, Save / Discard buttons that diff against the saved profile.

### Added — Auto-suggested job titles + personalization

- The `save_cv_profile` tool now also returns exactly **3 `suggestedJobTitles`** ordered by best fit. The `POST /api/cv` handler overwrites `Settings.jobTitles` with those 3 on every upload.
- Scoring system prompt is **role-agnostic** — it derives the candidate's profession from `Settings.jobTitles[0]` and the CV profile, no hardcoded "Product Designer" any more.
- `scoreJobs` accepts a `ScoringPreferences` argument (seniority / job types / locations from Settings); the system prompt surfaces them as explicit "USER PREFERENCES" with instructions to penalize contradictions and reward fits.
- Pre-score filter in `POST /api/jobs/refresh`: when `defaultSeniority` / `defaultJobTypes` is narrowed, drop jobs that contradict them (UNKNOWN always passes — same defensive rule as the board filter).
- On new CV upload, every `status = NEW` job is hard-deleted so old matches from a previous profession don't pollute the board. `STARRED` and `APPLIED` rows are preserved.

### Added — Board UX rework

- The default tab is now **Inbox** (was "New"). Label now matches the icon. The internal `JobStatus.NEW` enum is unchanged — only UI strings and the `?tab=` query key shifted (`?tab=inbox`).
- Per-card **"Don't Show Again"** (was "Hide") and a new **"Back to Inbox"** action on Applied cards. Backed by a new `unapply` action (`PATCH /api/jobs/:id` and `POST /api/jobs/bulk`) that sets `status = NEW, appliedAt = null`.
- **Clear List** (was "Clear"):
  - On Inbox / Starred — non-destructive view-only clear (no DB write, no confirmation).
  - On Applied — confirmation dialog, then bulk-unapply every visible job back to Inbox.
- Hero title is now **dynamic**: reads `{Settings.jobTitles[0]} jobs, ranked for you.` Falls back to "Product Design" while loading. Re-fetches on `cv-updated` and `settings-updated` window events.

### Added — Filters & Settings

- **Date posted** filter on the board: Any time / Past 24 hours / Past week / Past 2 weeks / Past month. Cutoff matches `publishedAt`, falling back to `fetchedAt` when the source didn't supply a publish date.
- Settings page reorganized:
  - Locations / Seniority / Job types removed from Settings (the board's filter row owns them now). Their underlying `Settings.default*` columns stay and still drive search + scoring personalization.
  - **API credentials** and **Sources** are collapsed by default in `<details>` cards with hover state, chevron, and an explicit "Click to expand / collapse" hint.
  - CV upload card surfaces the 3 suggested titles in the success toast.

### Fixed

- PDF / DOCX text is now sanitized for C0 control bytes (`0x00`–`0x08`, `0x0B`, `0x0C`, `0x0E`–`0x1F`; keeps `\t`, `\n`, `\r`). Fixes Postgres `invalid byte sequence for encoding "UTF8": 0x00` on CV upload when the PDF leaked embedded nulls.
- Cross-component sync: SettingsForm listens for `cv-updated` and re-fetches; JobBoard listens for `cv-updated` (clears stale jobs) and `cv-updated` / `settings-updated` (re-loads hero title).

### Changed — Branding & copy polish

- Branded favicon: `src/app/icon.svg` (Next.js `app/icon` convention) — deep-ink rounded square, paper-cream Fraunces "J", chartreuse accent dot, matching the in-app header logo. The default scaffold `favicon.ico` was removed so only the branded mark is emitted.
- Em dashes replaced with commas in user-visible copy across the hero, settings cards, source notes, and the settings page intro (matches the project's plain-text preference).
- "Hidden — won't show again." → "Hidden, won't show again."

### Notes

- No schema change is required for the rename: `JobStatus.NEW` stays. `TAB_STATUSES.inbox = "NEW"` is the only bridge.
- Old bookmarks of `/api/jobs?tab=new` continue to return the same rows — `TAB_STATUSES["new"]` is `undefined`, so the handler falls back to `status = "NEW"`.

## [1.0.0] — 2026-05-15

Initial release. Single-user AI job-search app with end-to-end CV ingestion, multi-source job aggregation, AI scoring, and a board UI.

### Added — CV ingestion

- `POST /api/cv` accepts PDF, DOCX, TXT, MD (≤ 8 MB).
- PDF extraction via `unpdf`; DOCX via `mammoth`; TXT/MD inline.
- One-call Claude Sonnet 4.6 parse via the `save_cv_profile` tool into `summary / skills / tools / industries / keywords / seniority / yearsExperience`.
- `Profile` singleton (id `"singleton"`) — replaced wholesale on each new upload. Stores both the raw CV text and the structured profile.

### Added — Job sources

Five real sources, all wired:

- **BA Jobbörse** (Bundesagentur für Arbeit) — primary, free public German API, no key. Up to 200 jobs per title × location query (4 pages × 50).
- **JSearch** — primary, RapidAPI aggregator covering LinkedIn / Indeed / Glassdoor / ZipRecruiter.
- **Fantastic.jobs / Active Jobs DB** — primary, RapidAPI. 3M+ career-site listings via 54 ATS platforms (Workday, Greenhouse, Ashby, …), hourly refresh. Title filter built as a Postgres tsquery.
- **Adzuna** — backup, free credentials. Up to 150 jobs per query (3 pages × 50).
- **JobSpy** — fallback, open-source Python scraper. Spawned via `scripts/jobspy_bridge.py` from a project-local `.venv-jobspy/`. Indeed + Glassdoor by default; configurable via `JOBSPY_SITES`.

Each source implements the `JobSource` interface (`id / label / tier / connected / configured / search`).

### Added — Tiered orchestrator (`src/lib/sources/search.ts`)

- Tier 1 (primary) runs in parallel.
- Tier 2 (backup) runs only when the primary tier returns fewer than 10 results combined.
- Tier 3 (fallback) runs unless blocked.
- Per-source reports: `{ id, ran, count, skippedReason? }`.

### Added — Dedupe & similarity

- `dedupeRawJobs` collapses cross-source duplicates by SHA-1 of `normalize(title)|normalize(company)|normalize(city)`. Gender markers like `(m/w/d)`, `(all genders)`, `m/w/x` are stripped before hashing.
- `isLikelySameJob` filters fresh candidates against starred/applied jobs to catch cross-source title variants — same company, same city, same seniority words, ≥ 70 % distinct-word overlap on the shorter title.

### Added — AI scoring

- Claude Haiku 4.5 via the `save_scores` tool — `{ score 0-100, explanation, missingSkills[] }`.
- Batches of 10 jobs per call.
- CV profile sent in `system` with `cache_control: { type: "ephemeral" }` for cross-batch cache hits.

### Added — Board UI

- Three tabs: New / Starred / Applied.
- Filters: Location, Seniority, Job type, Source — with the defensive "filter only narrows when something is deselected" rule.
- Circular score meter (chartreuse 90+, lavender 70+, muted below).
- Per-card actions: Star / Hide / Apply (Apply opens the listing URL and marks `APPLIED`).
- Bulk **Clear list** (sets every visible job to `DELETED`).
- Editorial design system (Fraunces display, Inter body, JetBrains Mono numbers; warm-cream light / deep-ink dark; chartreuse accent).
- Light/dark theme via `next-themes` (system default).

### Added — Settings UI

- CV upload card (drag-and-drop + click-to-browse).
- Multi-input job-title list.
- Toggle groups for locations / seniority / job types / sources.
- Per-source runtime status badge (`ready`, `API key needed`, `disabled`).

### Added — API routes

- `GET /api/cv`, `POST /api/cv`
- `GET /api/jobs` (filtered by tab + filters)
- `POST /api/jobs/refresh`
- `PATCH /api/jobs/:id` — actions: `star / unstar / apply / delete`
- `POST /api/jobs/bulk` — bulk delete
- `GET /api/settings`, `PUT /api/settings`
- `GET /api/sources` — runtime connection + configuration status

### Added — Infrastructure

- Postgres 16 (alpine) via `docker-compose.yml` on port 5433 (`jobhunter / jobhunter / jobhunter`).
- Prisma 7.8 with `@prisma/adapter-pg`; generated client at `src/generated/prisma/`.
- Migrations:
  - `20260514213910_init` — Profile / Settings / Job tables + initial enums.
  - `20260514222541_add_aggregator_sources` — adds `JSEARCH / ADZUNA / JOBSPY` and the `publisher` column.
  - `20260515192829_add_fantastic_jobs_source` — adds `FANTASTIC_JOBS`.
- `prisma/seed.ts` — upserts the `Settings` singleton with all sources enabled by default.

### Notes

- No tests, no CI workflows, no Dockerfile for the app itself, no license file. See `docs/TESTING.md` and `docs/DEPLOYMENT.md` for what's documented and what isn't.
- Six legacy `JobSourceId` enum values (`INDEED`, `LINKEDIN`, `STEPSTONE`, `XING`, `GLASSDOOR`, `MONSTER`) are kept for historical rows; they are not surfaced in the UI.

[Unreleased]: #unreleased
[1.1.0]: #110--2026-05-16
[1.0.0]: #100--2026-05-15
