# Matchwerk

A multi-tenant AI job-search web app for Product Design (and other) roles in Germany. Sign in with Google or an email/password account, upload your CV once — it's parsed and remembered — then refresh to pull real listings from multiple job APIs, deduplicate them across sources, and rank each one against your profile with an AI match score. Each account has its own isolated workspace (CV, settings, jobs, API keys).

> **Status:** personal tool, now multi-tenant with Auth.js (Google + email/password). Not a hosted product.

## Features

- **Accounts & sign-in.** Google OAuth or email/password (open registration), via Auth.js v5. Page routes are gated by `src/proxy.ts`; each account's data is fully isolated. The first account to sign in inherits any pre-existing single-tenant data.
- **Token economy + payments.** Every account starts with **150 tokens** (granted once on first sign-in). AI actions cost tokens: a CV parse is **25**, and a job research run is **0.5 per job shown + 1 per job freshly rated**. **Top up via Stripe** on `/plans` (test mode by default; live payments via the `STRIPE_ALLOW_LIVE` opt-in). Two balance gates apply — a CV parse needs ≥ 25 tokens and Research needs a positive balance — otherwise spending floors at 0 and overspend is tracked as debt (the balance never shows negative). A balance pill lives in the header; full balance and account details are on `/account`.
- **One-time CV ingestion.** Drop a PDF, DOCX, TXT, or Markdown file. The active AI provider (Claude Sonnet 4.6 by default; Gemini Flash selectable in admin) parses it into a structured profile (summary, skills, tools, industries, keywords, seniority, years of experience) and proposes **3 search-ready job titles** written straight into your settings. The profile is replaced wholesale on each new upload.
- **Multi-provider AI.** A provider abstraction (`src/lib/ai/*`) runs CV parsing and scoring through the **active** provider — Claude or Gemini Flash — with an automatic fallback chain. The active provider, fallback, enable/disable, and API keys are all managed in the **admin backoffice**, no redeploy.
- **Admin backoffice** (`/admin`, role-gated). User management (search/filter, activate/deactivate, token grant/deduct, refunds, GDPR export/erase, impersonate), an analytics dashboard (CSV + PDF export), plans & pricing editor, system settings (AI providers, job-source keys, rate limits, budget alerts), API health monitoring, announcements, a Stripe-events inspector, and role management. Roles: `USER` / `ADMIN` / `SUPER_ADMIN`.
- **Editable profile.** Skills, tools, industries, keywords, and the summary are all editable in Settings without re-uploading the CV (PATCH on `/api/cv`).
- **Personalized matching, end-to-end.** Search queries come from your saved job titles; scoring derives the candidate role from the CV (no hardcoded profession) and factors in your seniority / job-type / location preferences. Upload a CV for a different role and the system retargets — the next refresh stops surfacing the old profession.
- **Five real job sources** ([details](#job-sources)). Sources without API credentials surface as disabled — no fixture data is ever shown.
- **Admin-managed source keys.** API keys for JSearch, Fantastic.jobs, and Adzuna are global platform secrets managed in the admin backoffice (**System Settings → Job sources**), resolved DB-first with `.env.local` fallback and returned masked. (The old per-user editor in client Settings was removed in favor of central management.)
- **Tiered orchestration.** Primary sources run in parallel; backup runs only when the primary tier is short; an open-source scraping fallback is wired but rate-limit-aware.
- **Cross-source deduplication.** A SHA-1 hash of `normalize(title)|normalize(company)|normalize(city)` (with gender markers like `(m/w/d)` stripped) collapses duplicates from different boards.
- **Smart protection.** Cross-source title variants of jobs you've starred or applied to are filtered out before scoring — *"Senior Product Designer"* and *"Senior Product Designer — parental leave cover"* at the same company in the same city don't both show up.
- **AI match scoring.** The active provider (Claude Haiku 4.5 by default) scores every new job 0–100, batched, with the CV cached as an ephemeral system block (on Claude) so the same profile isn't paid for across batches. Each job gets a one-sentence explanation and a list of missing skills.
- **Board** with three tabs (Inbox / Starred / Applied), filters by location / seniority / job type / date posted plus a **match-score** slider (minimum-threshold, 0–90% in 10% steps), and a circular score meter on every listing. Per-card actions: Star, Apply, **Don't Show Again**, and (on Applied jobs) **Back to Inbox**. A non-destructive **Clear List** wipes the current view; on Applied it instead bulk-moves jobs back to Inbox after a confirmation.
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
2. **Settings** (`/settings`) — drop your CV (costs 25 tokens; needs ≥ 25 in your balance). The model auto-fills 3 target job titles; you can edit the list, the profile chips, and the summary. (Source API keys and which sources are enabled are managed centrally in the admin backoffice, not here.)
3. **Board** (`/`) — click **Research jobs** (costs 0.5/job shown + 1/job freshly rated). The first scan pulls a few dozen listings across enabled sources, scores them against your profile and Settings preferences, and renders the board. The hero title reflects your first job title (e.g. *"Senior Product Designer jobs, ranked for you."*).
4. Each card shows the match score, a one-line explanation, and any gaps the model flagged. Use the row of actions: **Star**, **Apply** (opens the job URL in a new tab and marks it applied), or **Don't Show Again**. On the Applied tab, **Back to Inbox** returns a job to your inbox.

### Environment variables

Two gitignored files. See `.env.example` for the canonical list and inline docs.

| File | Variable | Notes |
|---|---|---|
| `.env` | `DATABASE_URL` | Used by Prisma. Default: `postgresql://jobhunter:jobhunter@localhost:5433/jobhunter?schema=public` |
| `.env.local` | `ANTHROPIC_API_KEY` | Required (for the Claude provider). CV parse + scoring. |
| `.env.local` | `AUTH_SECRET` | Required. Signs the session JWT (and the impersonation cookie). Generate with `npx auth secret`. |
| `.env.local` | `SUPER_ADMIN_EMAILS` | Optional. Comma-separated emails promoted to Super Admin on sign-in (bootstraps admin access). |
| `.env.local` | `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` | Optional. Google OAuth client (Cloud Console). Email/password sign-in works without it. |
| `.env.local` | `GEMINI_API_KEY` | Optional. Enables the Gemini Flash AI provider (switch/fallback in admin). |
| `.env.local` | `STRIPE_SECRET_KEY` (+ `STRIPE_ALLOW_LIVE`) | Optional. `sk_test_…` enables token purchases; a `sk_live_…` key also requires `STRIPE_ALLOW_LIVE=true`. |
| `.env.local` | `STRIPE_WEBHOOK_SECRET` | Optional. `whsec_…` from `stripe listen`; enables the authoritative webhook (the success redirect also credits without it). |
| `.env.local` | `JSEARCH_API_KEY` | Optional. RapidAPI key for JSearch. |
| `.env.local` | `FANTASTIC_JOBS_API_KEY` | Optional. RapidAPI key for Active Jobs DB (same RapidAPI account as JSearch is fine). |
| `.env.local` | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | Optional. Free credentials at [developer.adzuna.com](https://developer.adzuna.com/). |
| `.env.local` | `JOBSPY_SITES` | Optional. Comma-separated override; default `indeed,glassdoor`. |

> The AI and source API keys above are **fallbacks**. Once a matching key is saved in the **admin backoffice** (System Settings), the DB-stored value wins and you can leave the env entry blank. Clear the DB entry to fall back to env again.

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
| `npm test` | Run the payment/token-billing test suite (Vitest; needs `npm run db:up`) |
| `npm run test:watch` | Vitest watch mode |
| `npm run typecheck` | `tsc --noEmit` |

> **Tests cover the payment flow** (Stripe + token billing) against a throwaway `jobhunter_test` Postgres. The rest of the app relies on typecheck + lint + manual smoke. See `docs/TESTING.md` §7.

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

Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui · `@base-ui/react` · Prisma 7 · PostgreSQL 16 · Auth.js v5 · Anthropic SDK + Google GenAI (Gemini) · Stripe · pdf-lib · Zod · Sonner. Fonts via `next/font/google`: Inter, Fraunces, JetBrains Mono.

## Project structure

See `CLAUDE.md` for the full annotated tree. Highlights:

```
src/app/                 # App Router pages + API routes
src/app/admin/           # Admin backoffice pages (dashboard, users, plans, system, …)
src/app/api/admin/       # Admin APIs (role-guarded)
src/components/          # UI components (job board, cards, settings forms, theme)
src/components/admin/    # Admin UI components
src/components/ui/       # shadcn primitives
src/lib/ai/              # AI provider abstraction (claude, gemini, runWithAi)
src/lib/sources/         # Source adapters + tiered orchestrator + dedupe + similarity
src/lib/platform.ts      # Global config (AppSetting) + secrets (PlatformCredential)
src/lib/matcher.ts       # Batched job scoring (via the active AI provider)
src/lib/cv-parser.ts     # PDF/DOCX/TXT → structured profile (via the active AI provider)
src/lib/{tokens,plans-repo,limits,budget,gdpr,impersonation,health,analytics}.ts
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
- [`docs/TESTING.md`](./docs/TESTING.md) — *payment-flow Vitest suite + the manual pre-release checkout checklist*

## License

**Not declared.** `package.json` has no `license` field and there is no `LICENSE` file in the repo. Treat the code as proprietary / all-rights-reserved until the project owner declares a license. Open a discussion before redistributing.
