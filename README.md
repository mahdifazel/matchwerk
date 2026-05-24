# Matchwerk

A multi-tenant AI job-search web app for Product Design (and other) roles in Germany. Sign in with Google or an email/password account, upload your CV once — it's parsed and remembered — then refresh to pull real listings from multiple job APIs, deduplicate them across sources, and rank each one against your profile with an AI match score. Each account has its own isolated workspace (CV, settings, jobs, API keys).

> **Status:** personal tool, now multi-tenant with Auth.js (Google + email/password). Not a hosted product.

## Features

- **Accounts & sign-in.** Google OAuth or email/password (open registration), via Auth.js v5. Page routes are gated by `src/proxy.ts`; each account's data is fully isolated. The first account to sign in inherits any pre-existing single-tenant data.
- **Token economy.** Every account starts with **150 tokens** (granted once on first sign-in). AI actions cost tokens: a CV parse is **25**, and a job research run is **0.5 per job shown + 1 per job freshly rated**. Spending never blocks — if you run out, the run still proceeds and the overspend is tracked as debt, so the balance never goes negative. A balance pill lives in the header; full balance and account details are on `/account`. There's no payment provider — the economy just makes AI cost visible.
- **One-time CV ingestion.** Drop a PDF, DOCX, TXT, or Markdown file. Claude (Sonnet 4.6) parses it into a structured profile (summary, skills, tools, industries, keywords, seniority, years of experience) and proposes **3 search-ready job titles** which are written straight into your settings. The profile is replaced wholesale on each new upload.
- **Editable profile.** Skills, tools, industries, keywords, and the summary are all editable in Settings without re-uploading the CV (PATCH on `/api/cv`).
- **Personalized matching, end-to-end.** Search queries come from your saved job titles; scoring derives the candidate role from the CV (no hardcoded profession) and factors in your seniority / job-type / location preferences. Upload a CV for a different role and the system retargets — the next refresh stops surfacing the old profession.
- **Five real job sources** ([details](#job-sources)). Sources without API credentials surface as disabled — no fixture data is ever shown.
- **In-app credential editor.** Paste API keys for JSearch, Fantastic.jobs, and Adzuna in Settings → API credentials. Values live in the database, override `.env.local`, are returned masked, and can be cleared back to env fallback at any time.
- **Tiered orchestration.** Primary sources run in parallel; backup runs only when the primary tier is short; an open-source scraping fallback is wired but rate-limit-aware.
- **Cross-source deduplication.** A SHA-1 hash of `normalize(title)|normalize(company)|normalize(city)` (with gender markers like `(m/w/d)` stripped) collapses duplicates from different boards.
- **Smart protection.** Cross-source title variants of jobs you've starred or applied to are filtered out before scoring — *"Senior Product Designer"* and *"Senior Product Designer — parental leave cover"* at the same company in the same city don't both show up.
- **AI match scoring.** Claude (Haiku 4.5) scores every new job 0–100, batched, with the CV cached as an ephemeral system block so the same profile isn't paid for across batches. Each job gets a one-sentence explanation and a list of missing skills.
- **Board** with three tabs (Inbox / Starred / Applied), filters by location / seniority / job type / source / date posted, and a circular score meter on every listing. Per-card actions: Star, Apply, **Don't Show Again**, and (on Applied jobs) **Back to Inbox**. A non-destructive **Clear List** wipes the current view; on Applied it instead bulk-moves jobs back to Inbox after a confirmation.
- **Editorial UI** ("Atelier" design system): Fraunces display serif + Inter body + JetBrains Mono numbers, warm-cream light / deep-ink dark, single chartreuse accent.

## Prerequisites

- **Node.js** ≥ 20 and **npm**
- **Docker** (for the local Postgres instance)
- An **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com/)) — required for CV parsing and scoring
- **Python 3.12** (optional — only needed if you want the JobSpy scraping fallback). On macOS: `brew install python@3.12`.

## Installation

```bash
# 1. Clone the repo, then:
npm install

# 2. Copy the env template and fill it in
cp .env.example .env       # then paste your DATABASE_URL line
#                            (the example below works for the Docker Postgres)
# .env.local is created by you with your secret keys (see .env.example):
#   ANTHROPIC_API_KEY (required), AUTH_SECRET (required), and optionally
#   AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET for Google sign-in.
npx auth secret           # generates AUTH_SECRET into .env.local

# 3. Bring up Postgres 16 in Docker (port 5433)
npm run db:up

# 4. Apply migrations (seed is a no-op now — data is created per-user on use)
npm run db:migrate

# 5. (Optional) JobSpy scraping fallback
python3.12 -m venv .venv-jobspy
.venv-jobspy/bin/pip install python-jobspy

# 6. Run the dev server
npm run dev
```

Open <http://localhost:3000>.

## Usage

1. **Sign up** (`/register`, or `/login` → Google). You get 150 tokens on first sign-in. The header shows your live balance; `/account` has your name, password, and full balance.
2. **Settings** (`/settings`) — drop your CV (costs 25 tokens). The model auto-fills 3 target job titles; you can edit the list, the profile chips, the summary, and your enabled sources. Add API keys for any paid sources under **API credentials** (collapsed by default).
3. **Board** (`/`) — click **Research jobs** (costs 0.5/job shown + 1/job freshly rated). The first scan pulls a few dozen listings across enabled sources, scores them against your profile and Settings preferences, and renders the board. The hero title reflects your first job title (e.g. *"Senior Product Designer jobs, ranked for you."*).
4. Each card shows the match score, a one-line explanation, and any gaps the model flagged. Use the row of actions: **Star**, **Apply** (opens the job URL in a new tab and marks it applied), or **Don't Show Again**. On the Applied tab, **Back to Inbox** returns a job to your inbox.

### Environment variables

Two gitignored files. See `.env.example` for the canonical list and inline docs.

| File | Variable | Notes |
|---|---|---|
| `.env` | `DATABASE_URL` | Used by Prisma. Default: `postgresql://jobhunter:jobhunter@localhost:5433/jobhunter?schema=public` |
| `.env.local` | `ANTHROPIC_API_KEY` | Required. CV parse + scoring. |
| `.env.local` | `AUTH_SECRET` | Required. Signs the session JWT. Generate with `npx auth secret`. |
| `.env.local` | `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` | Optional. Google OAuth client (Cloud Console). Email/password sign-in works without it. |
| `.env.local` | `JSEARCH_API_KEY` | Optional. RapidAPI key for JSearch. |
| `.env.local` | `FANTASTIC_JOBS_API_KEY` | Optional. RapidAPI key for Active Jobs DB (same RapidAPI account as JSearch is fine). |
| `.env.local` | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | Optional. Free credentials at [developer.adzuna.com](https://developer.adzuna.com/). |
| `.env.local` | `JOBSPY_SITES` | Optional. Comma-separated override; default `indeed,glassdoor`. |

> The source API keys above are **fallbacks**. Once you save a key in Settings → API credentials, the DB-stored value wins and you can leave the env entry blank. Clear the DB entry to fall back to env again.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run db:up` | Start Postgres (`docker compose up -d`) |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | No-op (Settings/Profile are created per-user on first use) |
| `npm run db:studio` | Open Prisma Studio |

> **No test script is defined.** See `docs/TESTING.md`.

## Job sources

| Source | Tier | Connection | Notes |
|---|---|---|---|
| **BA Jobbörse** (Bundesagentur für Arbeit) | primary | free, public, no key | Authoritative for German listings. Up to 200 jobs per title × location query. |
| **JSearch** | primary | RapidAPI key | Aggregates LinkedIn / Indeed / Glassdoor / ZipRecruiter. |
| **Fantastic.jobs** (Active Jobs DB) | primary | RapidAPI key | 3M+ career-site listings via 54 ATS platforms (Workday, Greenhouse, Ashby, …). Hourly refresh. Title filter is a Postgres tsquery. |
| **Adzuna** | backup | free credentials | Germany/EU coverage. Queried only when the primary tier collectively returns fewer than 10 results. |
| **JobSpy** (open-source) | fallback | Python venv | Scrapes Indeed and Glassdoor by default. Skipped when primary returns enough; opt-in for the LinkedIn scraper via `JOBSPY_SITES`. |

Adding a source requires (a) a new value on the `JobSourceId` Prisma enum + migration, (b) a new adapter implementing the `JobSource` interface, (c) entries in `ALL_SOURCES` and `SOURCE_META`, (d) an env var stub. The orchestrator picks it up automatically.

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui · `@base-ui/react` · Prisma 7 · PostgreSQL 16 · Anthropic SDK · Zod · Sonner. Fonts via `next/font/google`: Inter, Fraunces, JetBrains Mono.

## Project structure

See `CLAUDE.md` for the full annotated tree. Highlights:

```
src/app/                 # App Router pages + API routes
src/components/          # UI components (job board, cards, settings forms, theme)
src/components/ui/       # shadcn primitives
src/lib/sources/         # Source adapters + tiered orchestrator + dedupe + similarity
src/lib/anthropic.ts     # Claude client + model IDs
src/lib/matcher.ts       # Batched job scoring
src/lib/cv-parser.ts     # PDF/DOCX/TXT → structured profile via Claude tool-use
prisma/                  # Schema, migrations, seed
scripts/jobspy_bridge.py # Python sidecar for the JobSpy adapter
```

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — engineering guide
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — dev workflow
- [`CHANGELOG.md`](./CHANGELOG.md) — release log
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- [`docs/DECISIONS.md`](./docs/DECISIONS.md)
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — *currently flags what's undocumented*
- [`docs/TESTING.md`](./docs/TESTING.md) — *currently flags the absence of a test suite*

## License

**Not declared.** `package.json` has no `license` field and there is no `LICENSE` file in the repo. Treat the code as proprietary / all-rights-reserved until the project owner declares a license. Open a discussion before redistributing.
