# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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
[1.0.0]: #100--2026-05-15
