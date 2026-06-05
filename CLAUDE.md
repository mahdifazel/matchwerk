# CLAUDE.md — Matchwerk

A guide for engineers (and Claude) working on this codebase. Read top-to-bottom on day one. Everything below is derived from the code as it exists today; anything not present in the codebase is explicitly flagged as such.

---

## 1. Project overview

**Matchwerk** is a multi-tenant web app that pulls real Product Design (and other) job listings from German job boards, deduplicates them across sources, scores each listing against the signed-in user's CV via the **active AI provider (Claude or Gemini)**, and presents them in a board where the user can star, mark applied, or hide jobs.

**Payments & admin.** Tokens (the in-app AI currency) are **purchasable via Stripe** on `/plans` (test mode by default; live mode behind the `STRIPE_ALLOW_LIVE` opt-in — see §4 Payments). A role-gated **admin backoffice** at `/admin` manages users, tokens, plans/pricing, AI providers + source API keys, rate limits, budget alerts, announcements, analytics, API health, and Stripe events. Roles: `USER` / `ADMIN` / `SUPER_ADMIN` (see §4).

**Auth & tenancy.** Users sign in with **Google** or with **email/password** (open registration). Auth is handled by **Auth.js v5 (NextAuth)** — see `src/auth.ts` / `src/auth.config.ts`. Every data model (`Profile`, `Settings`, `Job`, `SourceCredential`) carries a `userId` and is scoped to its owner; there is one `Profile` and one `Settings` row **per user** (`userId @unique`), not a global singleton. Page routes are gated by `src/proxy.ts` (Next 16 "Proxy", formerly Middleware); API routes self-guard with a JSON 401 via `getSessionUserId()` in `src/lib/repo.ts`.

> **Legacy single-tenant data** (rows with `userId = null`) is claimed by the **first** account to register or sign in — see `claimOrphanDataForFirstUser` in `src/lib/claim.ts`. `userId` is nullable purely so those pre-multi-tenancy rows survive migration; all app queries scope by the authenticated (non-null) `userId`.

The original audience is one person — the project owner, searching Product Designer / Senior Product Designer / UX-UI roles in Berlin, Munich, Hamburg and remote-Germany — but the app now supports any number of independent accounts.

**Real jobs only.** No fixture/mock data is ever shown. Sources without API credentials surface as visibly inactive in the UI.

---

## 2. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16.2.6 (App Router, Turbopack dev) | `next.config.ts` declares `pg`, `@prisma/adapter-pg`, `mammoth`, `unpdf`, `stripe` as `serverExternalPackages` |
| Language | TypeScript 5, strict, ES2017 target, `module: esnext` | Alias `@/*` → `./src/*` |
| UI | React 19, Tailwind CSS 4, `shadcn/ui` (style: `base-nova`), `@base-ui/react` primitives, `lucide-react` icons, `next-themes` | Tailwind 4 is config-less — tokens live in `src/app/globals.css` under `@theme inline` |
| Fonts | `Inter` (sans body), `Fraunces` (editorial display), `JetBrains Mono` (tabular) — all via `next/font/google` with CSS vars `--font-jh-sans`, `--font-jh-display`, `--font-jh-mono` |
| Database | PostgreSQL 16 (alpine) in Docker on port **5433** | `docker-compose.yml`. Credentials: `jobhunter` / `jobhunter` / db `jobhunter` |
| ORM | Prisma 7.8 with `@prisma/adapter-pg` | Custom client output at `src/generated/prisma` (gitignored) |
| Auth | Auth.js v5 (`next-auth@5.0.0-beta`) + `@auth/prisma-adapter`, `bcryptjs` for password hashing | Google OAuth + email/password credentials; JWT session strategy. See `src/auth.ts` / `src/auth.config.ts` |
| Billing | In-app token economy (`src/lib/tokens.ts`) | Float balances + debt on `User`, append-only `TokenLedger`. **Balance gates** on CV/Research + admin-set **rate limits** (`src/lib/limits.ts`) |
| Payments | Stripe (`stripe` SDK) | Hosted Checkout for token top-ups. Test by default; live (`sk_live_…`) requires `STRIPE_ALLOW_LIVE=true` (`src/lib/stripe.ts`). DB-backed `Plan` table |
| AI | Anthropic SDK + Google GenAI (`@google/genai`) | Provider abstraction in `src/lib/ai/*`: active provider (Claude Sonnet/Haiku or Gemini Flash) + fallback chain; switchable in admin |
| Admin | Role-gated backoffice (`/admin`) | `UserRole` enum; DB-authoritative guards (`src/lib/admin.ts`); `AdminAuditLog`; reports via CSV + `pdf-lib` |
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
│   ├── schema.prisma           # User(+role/disabledAt), Account, Session, Profile, Settings, SourceCredential(legacy), Job, TokenLedger, AdminAuditLog, AppSetting, PlatformCredential, Plan, RequestLog, Announcement, WebhookEvent, ContactMessage; enums (+ UserRole, ContactMessageStatus, ContactMessageCategory)
│   ├── seed.ts                 # No-op — Settings/Profile are created per-user on first use
│   └── migrations/             # …add_auth_multitenant, add_token_billing, add_token_purchase, add_admin_roles, add_platform_config, add_plans, add_request_log, add_announcement, add_webhook_event
├── prisma.config.ts            # Loads schema + DATABASE_URL via dotenv
├── svgo.config.mjs             # Picked up by `npx svgo`; preserves Figma layer IDs (cleanupIds disabled)
├── scripts/
│   └── jobspy_bridge.py        # Python bridge for the JobSpy adapter
├── .venv-jobspy/               # Gitignored Python venv for jobspy
├── public/                     # Static assets
└── src/
    ├── auth.ts                 # NextAuth init: Google + Credentials providers, JWT session, createUser event (claim orphans + signup grant)
    ├── auth.config.ts          # Edge-safe auth config (providers list, pages) shared with the proxy
    ├── proxy.ts                # Next 16 "Proxy" (formerly Middleware) — gates page routes by session
    ├── types/                  # Ambient type augmentation (next-auth session/JWT)
    ├── app/
    │   ├── layout.tsx          # Loads fonts, ThemeProvider, Toaster
    │   ├── icon.svg            # Branded favicon (ink "M" mark + chartreuse accent dot) — Next.js app/icon convention
    │   ├── globals.css         # Atelier design system: palette + tokens + utilities
    │   ├── page.tsx            # Board page (job feed)
    │   ├── login/page.tsx      # Sign-in (Google + email/password)
    │   ├── register/page.tsx   # Open registration (email/password)
    │   ├── account/page.tsx    # Account settings: name, password, token balance, GDPR export/delete
    │   ├── settings/page.tsx   # CV upload + job titles (source keys/Sources moved to admin)
    │   ├── plans/page.tsx      # Token purchase plans → Stripe Checkout
    │   ├── admin/              # Role-gated backoffice: layout + dashboard, users/[id], plans, system, health, announcements, webhooks, roles, messages, messages/[id]
    │   ├── contact/page.tsx    # Logged-in feedback channel
    │   ├── checkout/[planId]/page.tsx  # Embedded Checkout: custom merchant panel + Stripe form mounted inline
    │   └── api/
    │       ├── auth/[...nextauth]/route.ts          # Auth.js handlers (signin/callback/signout)
    │       ├── register/route.ts                    # POST email/password registration (+ claim orphans, signup grant)
    │       ├── account/route.ts                     # GET account + token balance / PATCH display name
    │       ├── account/password/route.ts            # PUT set/change password
    │       ├── tokens/route.ts                       # GET token balance + debt
    │       ├── cv/route.ts                          # GET / POST (multipart, charges) / PATCH (edit summary + chips)
    │       ├── jobs/route.ts                        # GET filtered listings by tab (+ datePosted cutoff + minScore threshold)
    │       ├── jobs/refresh/route.ts                # POST → fetch, dedupe, pre-score filter, score, persist, charge
    │       ├── jobs/[id]/route.ts                   # PATCH star/unstar/apply/unapply/delete
    │       ├── jobs/bulk/route.ts                   # POST bulk delete or bulk unapply
    │       ├── settings/route.ts                    # GET + PUT
    │       ├── sources/route.ts                     # GET runtime source status (now global creds; per-user [id]/credentials route deleted)
    │       ├── checkout/route.ts, checkout/confirm/route.ts  # Stripe Checkout session + return confirmation (credits)
    │       ├── stripe/webhook/route.ts              # Verifies events, credits, records to WebhookEvent
    │       ├── announcements/route.ts               # GET active in-app banners
    │       ├── impersonate/route.ts                 # GET status / DELETE stop (admin "view as user")
    │       └── admin/                               # All role-guarded: users, users/[id] (+tokens/refund/export/impersonate), plans, analytics(+pdf), alerts, webhooks, admins, system/{ai,sources,limits,budget}
    ├── components/
    │   ├── app-chrome.tsx          # Persistent header + page transition + impersonation/announcement banners (non-admin/auth routes)
    │   ├── app-header.tsx, theme-toggle.tsx, theme-provider.tsx   # header: token pill (links to /plans), Admin link for admins
    │   ├── announcement-banner.tsx, impersonation-banner.tsx
    │   ├── auth/                   # auth-shell.tsx (split-screen layout), auth-illustration.tsx (interactive eye SVG), google-button.tsx
    │   ├── account-form.tsx        # Account form (name, password, balance, Buy tokens, GDPR export/delete)
    │   ├── pricing-table.tsx       # /plans cards → routes to /checkout/[planId]
    │   ├── checkout-embed.tsx      # Stripe Embedded Checkout wrapper (loadStripe + EmbeddedCheckoutProvider)
    │   ├── job-board.tsx, job-card.tsx, match-badge.tsx (exports ScoreMeter)
    │   ├── filter-bar.tsx, refresh-button.tsx, empty-state.tsx
    │   ├── cv-upload.tsx           # Drag-and-drop + inline profile editor
    │   ├── settings-form.tsx       # Job titles list only (API credentials + Sources moved to admin)
    │   ├── admin/                  # Sidebar + manager/viewer components for every admin page
    │   └── ui/                     # shadcn primitives wrapping @base-ui/react
    └── lib/
        ├── prisma.ts             # Global Prisma client (dev-mode warning logs)
        ├── ai/                   # Provider abstraction: types, claude, gemini, index (runWithAi, fallback chain, config)
        ├── platform.ts           # SERVER-ONLY: global secrets (PlatformCredential, DB→env) + config (AppSetting)
        ├── stripe.ts             # SERVER-ONLY: lazy Stripe client; test keys always, live keys only with STRIPE_ALLOW_LIVE=true
        ├── plans.ts / plans-repo.ts  # CLIENT-SAFE plan type+formatters / SERVER-ONLY DB-backed plan CRUD
        ├── admin.ts              # SERVER-ONLY: role guards (requireAdminPage, getAdminUser…), logAdminAction
        ├── limits.ts             # SERVER-ONLY: balance gates + rate limits (checkCvUpload, checkResearch)
        ├── budget.ts, gdpr.ts, impersonation.ts, health.ts, analytics.ts, request-log.ts
        ├── claim.ts              # claimOrphanDataForFirstUser — legacy userId=null rows → first account
        ├── tokens.ts             # SERVER-ONLY: TOKEN prices, getTokenAccount, charge, grant, adminAdjustTokens, creditCheckoutSession, reverseCheckoutTokens
        ├── use-token-balance.ts  # Client hook + notifyTokensUpdated() event + formatTokens()
        ├── cv-parser.ts          # extractCvText (PDF/DOCX/TXT, C0-byte sanitized) + parseCvProfile (via runWithAi; emits 3 suggestedJobTitles)
        ├── matcher.ts            # scoreJobs — batched tool-use via runWithAi; role-agnostic prompt + ScoringPreferences from Settings
        ├── repo.ts               # getSessionUserId/getSessionUser (honor impersonation), getSettings, getProfile
        ├── constants.ts          # SOURCE_META, LOCATION_OPTIONS, SENIORITY/JOBTYPE options, DATE_POSTED_OPTIONS, TAB_STATUSES
        ├── credential-schema.ts  # CLIENT-SAFE: per-source field defs + env-fallback names
        ├── credentials.ts        # SERVER-ONLY: GLOBAL source-key resolution (PlatformCredential→env) + global enable/disable
        ├── infer.ts              # inferSeniority / inferJobType regex heuristics
        ├── types.ts              # DTOs sent over the wire
        ├── use-source-status.ts  # Client hook fetching /api/sources (with refetch)
        ├── utils.ts              # cn() helper
        └── sources/
            ├── index.ts            # ALL_SOURCES (in tier order)
            ├── types.ts            # JobSource, RawJob, SearchParams interfaces (configured() is async)
            ├── search.ts           # Tiered orchestrator (primary → backup → fallback)
            ├── dedupe.ts           # SHA-1 hash from normalized title|company|city
            ├── similarity.ts       # isLikelySameJob — used to protect starred/applied jobs
            ├── ba-jobboerse.ts     # Public German API, no key
            ├── jsearch.ts          # RapidAPI aggregator (reads getSourceCredentials("JSEARCH"))
            ├── fantastic-jobs.ts   # RapidAPI Active Jobs DB (tsquery title filter)
            ├── adzuna.ts           # Adzuna /de/search
            ├── jooble.ts           # Jooble aggregator (POST /api/{apiKey})
            └── jobspy.ts           # Spawns the Python bridge
```

---

## 4. Architecture & data flow

### CV upload (one-time per CV)
1. User drops a PDF/DOCX/TXT in `/settings`.
2. `POST /api/cv` reads the file (≤ 8 MB), routes to `extractCvText` (`unpdf` for PDF, `mammoth` for DOCX, raw for TXT/MD). Output is sanitized of C0 control bytes (Postgres rejects null bytes in `text` columns).
3. `parseCvProfile` runs the **active AI provider** via `runWithAi` (default Claude Sonnet 4.6; Gemini Flash if active) to populate `summary / skills / tools / industries / languages / keywords / seniority / yearsExperience` **plus exactly 3 `suggestedJobTitles`** ordered by best fit. `languages` is free text copied as the CV writes it (e.g. `"German (native)"`, `"English (fluent)"`) and drives both the scoring penalty for unmet language requirements and the board's Language filter. (Gate: the user needs ≥ 25 tokens and must be under the CV/day rate limit, checked first — see Guardrails below.)
4. `prisma.profile.upsert({ where: { userId } })` replaces that user's previous profile wholesale.
5. `Settings.jobTitles` is overwritten with the 3 suggested titles.
6. Every `status = NEW` job is hard-deleted so old matches from the previous profile don't pollute the board. `STARRED` and `APPLIED` rows are preserved.
7. The user is charged `TOKEN.CV_PARSE` (25) for the AI parse — once per upload (inline `PATCH` edits are free).

### CV profile editing (no re-upload)
- `PATCH /api/cv` accepts `{ summary?, skills?, tools?, industries?, languages?, keywords? }`. Zod-validated; trims, drops empty strings, caps lists at 200, summary ≤ 4000 chars. `cv-upload.tsx` renders the inline editor (chip lists for each array field; the new **Languages** section sits between Industries and Keywords) and dispatches `cv-updated` on save so `settings-form.tsx` re-fetches.

### Refresh (the main loop)
`POST /api/jobs/refresh` (`src/app/api/jobs/refresh/route.ts`):
1. Requires a CV profile; refuses with 400 otherwise. **Gate** (`checkResearch`): refuses with 402 if balance ≤ 0, or 429 if over the per-hour rate limit.
2. Reads `Settings` (job titles, default locations, default seniority / job types). **Which sources run is now a global admin setting** (`getEnabledSourceIds`), not per-user.
3. **`searchEnabledSources`** (`src/lib/sources/search.ts`) runs sources by tier:
   - **Primary** (`BA_JOBBOERSE`, `JSEARCH`, `FANTASTIC_JOBS`) in parallel.
   - **Backup** (`ADZUNA`, `JOOBLE`) only if the primary tier returned fewer than **10** results total.
   - **Fallback** (`JOBSPY`) runs unless blocked (disabled / no key / adapter not connected).
   - Each source reports `{ ran, count, skippedReason? }`.
4. `dedupeRawJobs` collapses cross-source duplicates by SHA-1 of `normalize(title)|normalize(company)|normalize(city)` (after stripping gender markers like `(m/w/d)`).
5. Filter against the DB by `dedupeHash` — anything already stored (any status, including `DELETED`) is dropped, so previously-hidden jobs stay hidden.
6. Filter again with `isLikelySameJob` (`src/lib/sources/similarity.ts`) against starred/applied jobs — catches cross-source title variants like *"Senior Product Designer — parental leave cover"*.
7. **Pre-score personalization filter:** when `Settings.defaultSeniority` / `Settings.defaultJobTypes` is narrowed (subset selected), drop jobs that contradict them. `UNKNOWN` always passes (defensive narrow rule — matches `/api/jobs`).
8. **`scoreJobs`** (`src/lib/matcher.ts`) batches the fresh jobs (10 per call) and asks the **active AI provider** via `runWithAi` (default Claude Haiku 4.5) to return `{ score 0-100, explanation, missingSkills[], requiredLanguages[] }` per job. The user prompt now carries a **300-char description snippet** per job (so the model can spot "Deutschkenntnisse erforderlich"-style signals that don't live in title+company+location); the system prompt surfaces the candidate's `languages` and instructs the model to penalize unmet language requirements but **not** to penalize when no language is stated (the product rule — see §10 and DECISIONS #38). `requiredLanguages` is normalised to a subset of `["de", "en"]`; an empty array means no requirement was found. On the Claude path the profile system block is sent with `cache_control: { type: "ephemeral" }` so the same CV doesn't re-cost across batches (Gemini uses `systemInstruction`). The system prompt is otherwise **role-agnostic** — `Settings.jobTitles[0]` and the parsed CV define the candidate's profession; user preferences (seniority, job types, locations) are surfaced as explicit "USER PREFERENCES (from Settings)" with instructions to penalize contradictions. Each provider attempt is logged to `RequestLog`.
9. `prisma.job.createMany({ skipDuplicates: true })`.
10. **Charge** once the run has succeeded (so a failed run isn't billed): `TOKEN.PER_JOB_DISPLAY` (0.5) per surfaced job (fresh + repeats) plus `TOKEN.PER_JOB_RATING` (1) per freshly-rated job. A repeats-only run still bills the re-display but never re-rates.

### Contact form (logged-in feedback channel)
- **User side**: `/contact` (`src/app/contact/page.tsx` + `src/components/contact-form.tsx`) — auth-gated; subject + category (`QUESTION`/`BUG`/`FEATURE_REQUEST`/`OTHER`) + 2000-char body. Name + email snapshot at submit time from the session. **5 messages per user per rolling 24h**, enforced server-side by `checkContactMessage(userId)` in `src/lib/limits.ts` (counts directly from `ContactMessage`, no token cost).
- **Server**: `POST /api/contact` validates + rate-limits + inserts `ContactMessage` + best-effort fires `sendContactNotification()` (`src/lib/email.ts`) to a configured admin address. Destination resolved from `AppSetting("contact_to")` → env `CONTACT_TO` → null (in which case the row still saves; the admin sees it in the inbox without an email ping). Outgoing subject: `[Matchwerk · <Category>] <user subject>`.
- **Admin inbox**: `/admin/messages` (`ContactMessagesManager`) — newest-first list with status chips (NEW/READ/REPLIED), category badge, search across subject/name/email, debounced 200 ms client-side. Detail at `/admin/messages/[id]` (`ContactMessageDetail`) shows full body, sender card with deep-link to `/admin/users/[userId]`, action row: **Reply via email** (mailto: with quoted body — opens admin's default mail client and also marks the message replied as a side-effect), **Mark read** / **Mark replied** / **Reset to New**, and a destructive **Delete** behind an `AlertDialog` confirmation. Status transitions and deletes write `contact_message_status` / `contact_message_delete` to `AdminAuditLog`.
- **Entry points**: header user menu ("Contact us"), `/account` "Need help?" card, admin sidebar Messages item.
- **Admin config**: `/admin/system` → Contact destination section (writes `AppSetting("contact_to")`; clear to fall back to env).

### Auth pages (login / register)
- **Shared shell** `src/components/auth/auth-shell.tsx` — single-column centered card by default. When `illustrationSrc` is passed (login only), switches to a **split-screen on `lg+`**: form on the left over a pinned Sage `#C7D7A0` surface, brand illustration on the right over a pinned Paper `#F5F1E8` surface. Below `lg`, falls back to single-column centered (no SVG shipped to phones — the asset is heavy and there's no room for it).
- **Interactive illustration** `src/components/auth/auth-illustration.tsx` — client component that renders `/auth-illustration.svg` as an `<img>` for instant first paint, then `fetch()`s the same URL (browser cache makes it near-free) and swaps to **inline SVG** via `dangerouslySetInnerHTML`. Inlining is required because the SVG is interactive: the named groups `Open Eye` and `Close Eye` are toggled via `visibility` for a **blink loop** (random 6–10 s gap, 200 ms close duration); the cursor-tracking translate (capped at 20 × 28 px around the **eye's own resting center**, not the SVG center) is applied to both eye groups in lockstep so they stay aligned; clicking the illustration triggers an immediate blink and resyncs the schedule.
- **CSS micro-animations** live inside the SVG as a `<style id="auth-illustration-anim">` block so they run whether the SVG is loaded via `<img>` or inlined. A `hi-bob` keyframe (translateY + scale, 3.5 s, evenly phase-offset across six groups via negative delays) plays on `Hi-A`…`Hi-E` and `10519287 9`. The block also sets `[id="Close Eye"]{visibility:hidden}` so the closed state never flashes before JS hydrates. A page-level `@media (prefers-reduced-motion: reduce)` block in `globals.css` plus an in-SVG one disable all motion for users who ask.
- **SVG asset prep** — sourced from `Eye.svg` (1.18 MB), optimised via `npx svgo` to 285 KB. The project-level `svgo.config.mjs` disables `cleanupIds` so the Figma layer names (`Hi-A`…`Hi-E`, `Open Eye`, `Close Eye`, `10519287 9`) survive optimization — these IDs are what the CSS animations and JS event targeting hook onto.

### Token billing
- **`src/lib/tokens.ts`** is the single billing surface. `TOKEN` holds the prices/limits: `SIGNUP_GRANT 300`, `CV_PARSE 25`, `PER_JOB_DISPLAY 0.5`, `PER_JOB_RATING 1`, `MAX_SEARCH_JOBS 150` (cap on jobs considered per refresh), `MAX_BOARD_JOBS 70` (cap on the Inbox listing). Balances move in 0.5 increments, hence `Float`.
- **`getTokenAccount(userId)`** returns `{ balance, debt }`, applying the one-time 150 signup grant lazily on first access if `tokensGrantedAt` is null (an atomic `updateMany` claim, so it can't double-grant). Called on first Google sign-in (`createUser` event in `src/auth.ts`) and on email/password registration (`/api/register`).
- **`charge(userId, amount, reason, metadata?)`** never blocks the run: the balance floors at 0 and any overspend is recorded as `tokenDebt` (the UI never shows a negative). One `TokenLedger` row per charge.
- **`grant(userId, amount, reason)`** pays down debt before crediting balance.
- **Balance API/UI:** `GET /api/tokens` and `GET /api/account` expose `{ balance, debt }`. The header pill (`src/components/app-header.tsx`) reads `useTokenBalance()`; after any charging action the client calls `notifyTokensUpdated()` (a `tokens-updated` window event) so the pill refetches. `formatTokens()` renders integers as-is, otherwise one decimal.

### Board listing (`GET /api/jobs`)
Filters by tab (`inbox` / `starred` / `applied` → `NEW` / `STARRED` / `APPLIED` via `TAB_STATUSES` in `src/lib/constants.ts`), `sources`, `seniority`, `jobTypes`, `locations`, `languages`, `datePosted`, `minScore`. **Defensive filter rule**: a filter only narrows when the user has deselected at least one option; when everything is on (the default), no filter is applied — otherwise `UNKNOWN`-classified jobs would be hidden. When narrowed, `UNKNOWN` is always included so listings aren't lost to weak classification. See lines 49–67 of `src/app/api/jobs/route.ts`.

`datePosted` accepts `any` / `24h` / `1w` / `2w` / `1m`. Cutoff is applied as `publishedAt >= cutoff OR (publishedAt IS NULL AND fetchedAt >= cutoff)` — aggregators that don't report a publish date use `fetchedAt` so fresh listings don't get silently filtered out.

`languages` accepts `de` and/or `en` and maps against `Job.requiredLanguages` (which the scorer emits per job). Defensive rule with one twist driven by the product rule (DECISIONS #38): both checked or neither = no filter; "de" only → `requiredLanguages has "de"`; "en" only → `NOT (requiredLanguages has "de")` — i.e. any job whose JD doesn't explicitly require German qualifies as "English suffices", because that's the German tech-market default.

`minScore` is the **Match** slider in the filter bar (`src/components/ui/slider.tsx`, a base-ui `Slider` wrapper; reversed/active fill, value bubble) — a minimum match-score threshold from 0–90 in steps of 10. When `> 0` it adds `matchScore >= minScore` (showing jobs scoring value → 100); `0` applies no filter. Unlike the defensive multi-selects it filters directly, so high thresholds can legitimately empty the board. The board's per-user **Source** filter UI was removed; `sources` is still accepted by the API and defaults to all.

Order: starred/inbox sort by `matchScore DESC, fetchedAt DESC`; applied sorts by `appliedAt DESC`.

**Cancel stale filter fetches.** Filter widgets (especially the Match slider) fire many `onValueChange` events as the user interacts. The client `fetchJobs(signal?)` (`src/components/job-board.tsx`) takes an `AbortSignal`; each effect run creates an `AbortController`, hands its signal to the fetch, and aborts on cleanup. So when filters change, the previous in-flight request is cancelled before the next one starts — an older response can never overwrite a newer one (the "Match filter sometimes doesn't work" race).

### Job actions
- `PATCH /api/jobs/[id]` accepts `star / unstar / apply / unapply / delete`. `apply` writes `appliedAt = now()`; `unapply` sets `status = NEW, appliedAt = null`; `delete` sets `status = DELETED` (the row stays so dedupe permanently excludes it).
- `POST /api/jobs/bulk` accepts `{ action: "delete" | "unapply", ids }`. `unapply` is guarded by `where: { status: "APPLIED" }` so a mistargeted bulk call can't reset arbitrary rows.

### Source credentials (now global / admin-managed)
- Source API keys are **global platform secrets**, not per-user. Adapters call `getSourceCredentials(sourceId)` from `src/lib/credentials.ts`, which resolves `PlatformCredential` (keyed by the field's env-var name) → `process.env` → undefined, via `src/lib/platform.ts` (per-process cache).
- Managed in **Admin → System Settings → Job sources** (`/api/admin/system/sources` + `[id]`): set/clear keys, and a per-source **global enable/disable** (`AppSetting "sources_disabled"`, surfaced via `getEnabledSourceIds`).
- `GET /api/sources` still reports `{ id, label, tier, connected, configured, editable, credentialSource }` (used by the board's filter bar). The per-user `/api/sources/[id]/credentials` route + client editor were removed; the per-user `SourceCredential` model is legacy/unused.

### Payments (Stripe — Embedded Checkout, test by default, live behind an opt-in)
- `/plans` lists DB-backed `Plan`s. Click a plan → `/checkout/[planId]` (server component, auth-gated) — our own page with a custom merchant panel on the left (brand lockup, plan summary, usage anchor, trust band) and **Stripe Embedded Checkout** mounted on the right via `<CheckoutEmbed>` (`src/components/checkout-embed.tsx`). The user never leaves `matchwerk.app`.
- **Session creation**: `POST /api/checkout` runs `stripe.checkout.sessions.create({ ui_mode: "embedded_page", customer_email, locale: "auto", billing_address_collection: "auto", return_url, metadata: { userId, planId } })` and returns `{ clientSecret, sessionId }` to the embed. (API version `2026-04-22.dahlia` — the SDK v22 default — renamed `ui_mode` values: `embedded` → `embedded_page`, `hosted` → `hosted_page`.) No hard-coded `payment_method_types`; Stripe presents whichever methods are enabled in Dashboard (Cards + Link + Apple Pay + Google Pay by default; SEPA / Klarna / Sofort / iDEAL / Bancontact opt-in).
- **Confirmation**: when the embed finishes, Stripe redirects to `return_url = /plans?checkout=success&session_id=…`. The `PricingTable` redirect handler picks this up and calls `POST /api/checkout/confirm`. The authoritative path is still the webhook (`POST /api/stripe/webhook`); both call `creditCheckoutSession` (idempotent via the unique `TokenLedger.stripeSessionId`).
- **Refunds** (`/api/admin/users/[id]/refund`): retrieves the session's `payment_intent`, `stripe.refunds.create` (idempotency key), then `reverseCheckoutTokens` (deducts; overspend → debt).
- **Mode guard** (`src/lib/stripe.ts`): `sk_test_…` keys always work. A live key (`sk_live_…`) is accepted **only when `STRIPE_ALLOW_LIVE=true`** — otherwise `getStripe()` throws, so real charges can't happen by accident. `getStripeMode()` returns `"test" | "live" | "off"`. Verified webhook events are recorded to `WebhookEvent` (Admin → Stripe Events). Live mode also needs an activated Stripe account + a live webhook endpoint; VAT/tax/terms are out of scope of the code.
- **Card chrome on `/checkout/[planId]`**: hairline Ink/8% border + two-layer Ink-tinted shadow + 2px `bg-accent` strip at the top of the embed wrapper (chartreuse light, lavender dark — Atelier accent flips by theme). The **inner padding area is pinned to `bg-white`** in both themes so it visually merges with the Stripe iframe (which is always white internally — Stripe Embedded Checkout doesn't support a dark theme). The merchant panel is `bg-secondary` (Sand light / muted plum dark) — theme-aware.

### AI providers (`src/lib/ai/*`)
- `runWithAi(fn, op?)` tries the **active** provider then the **fallback chain** (enabled + configured only), logging each attempt to `RequestLog`. Providers (`claude`, `gemini`) implement `parseCvProfile`, `scoreBatch`, `ping` + `isConfigured`.
- Config (active / fallback / enabled) lives in `AppSetting "ai_providers"`; keys (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) in `PlatformCredential`→env. Managed in **Admin → System Settings → AI providers** (`/api/admin/system/ai` + `/key`). No redeploy to switch.

### Admin backoffice & roles
- `UserRole` (`USER`/`ADMIN`/`SUPER_ADMIN`) + `disabledAt` on `User`. Super Admin bootstrapped via `SUPER_ADMIN_EMAILS` (promoted in the `jwt` callback on sign-in). Role is **DB-authoritative**: guards in `src/lib/admin.ts` (`requireAdminPage`, `getAdminUser`, `getSuperAdminUser`) read the DB; the session carries role only for client UI. Every privileged action calls `logAdminAction` → `AdminAuditLog`.
- `/admin` (sidebar layout, gated): Dashboard (analytics + CSV/PDF), User Management, Plans & Pricing, System Settings, API Health, Announcements, Stripe Events, Role Management (Super-Admin-only). **Impersonation**: an admin can "view as user" via a signed cookie (`src/lib/impersonation.ts`); `getSessionUserId`/`getSessionUser` resolve to the target only when the genuine JWT belongs to the matching admin.

### Guardrails (`src/lib/limits.ts`)
- **Balance gates** (a deliberate change from "never block"): CV upload needs ≥ `TOKEN.CV_PARSE` (25); Research needs balance > 0 — else **402**. **Rate limits** (admin-set in `AppSetting "rate_limits"`, counted from `TokenLedger`): research/hour + CV/day — else **429**. **Budget alerts** (`src/lib/budget.ts`): daily thresholds surfaced on the dashboard.
- **GDPR** (`src/lib/gdpr.ts`): per-user JSON export (secrets stripped) + hard erasure (`prisma.user.delete` cascades), admin-side and self-serve in `/account`.

---

## 5. Database model

`prisma/schema.prisma`:

- **`User`** — Auth.js account: `email @unique`, `name?`, `image?`, `emailVerified?`, `password?` (bcrypt hash for email/password users; `null` for OAuth-only). **Role/state:** `role UserRole @default(USER)`, `disabledAt DateTime?` (deactivation). **Token billing:** `tokenBalance Float`, `tokenDebt Float`, `tokensGrantedAt DateTime?`. Owns `Profile?`, `Settings?`, `Job[]`, `SourceCredential[]`, `TokenLedger[]` (all `onDelete: Cascade`).
- **`Account` / `Session` / `VerificationToken`** — standard Auth.js adapter tables. `Session` is unused under the JWT session strategy but kept to satisfy the `@auth/prisma-adapter` contract.
- **`TokenLedger`** — append-only audit trail. One row per action: `delta` (− charge / + grant), `balanceAfter`, `reason` (`signup_grant | cv_parse | research | purchase | admin_grant | admin_deduct | refund`), `metadata: Json?`, **`stripeSessionId String? @unique`** (idempotency key for purchase crediting + `refund:<id>` for reversals), `createdAt`. Indexed by `[userId, createdAt]`.
- **`AdminAuditLog`** — append-only record of privileged actions; self-contained (`actorId`/`actorEmail`/`targetId?`/`targetEmail?`/`action`/`metadata?`), no FK so it survives user deletion.
- **`AppSetting`** (`key @id`, `value Json`) — global config (AI provider config, `sources_disabled`, `rate_limits`, `budget_alerts`). **`PlatformCredential`** (`name @id`, `value`) — global secrets (AI + source API keys), keyed by env-var name, never returned raw.
- **`Plan`** (`id` slug `@id`, name/tagline/`priceEur`/`tokens`/`durationMonths`/`recommended`/`sortOrder`/`active`) — admin-editable token plans; seeded Starter/Plus/Pro.
- **`RequestLog`** — one row per AI provider attempt (`provider`/`operation`/`ok`/`durationMs`/`error?`); powers analytics + API health. **`Announcement`** — admin banners (`message`/`level`/`active`/window). **`WebhookEvent`** (`id` = Stripe event id) — verified webhook events for the inspector.
- **`Profile`** — one per user (`userId String? @unique`) — `fileName`, full `rawCvText`, structured fields (`summary`, `skills[]`, `tools[]`, `industries[]`, `languages[]` (free text — e.g. `"German (native)"`), `keywords[]`, `seniority`, `yearsExperience`), `parsedAt`, `updatedAt`.
- **`Settings`** — one per user (`userId String? @unique`) — `jobTitles[]`, `defaultLocations[]`, `defaultSeniority[]`, `defaultJobTypes[]`, `defaultSources[]`.
- **`SourceCredential`** — **legacy/unused**. Source keys are now global (`PlatformCredential`); this per-user table is kept only for historical rows.
- **`Job`** — `userId`, `source` (enum), `externalId`, `dedupeHash`, title/company/location/url/description, `publisher` (for aggregators), `jobType`/`seniority` enums, `publishedAt`, `matchScore`/`matchExplanation`/`missingSkills[]`/`requiredLanguages[]`/`scoredAt`, `status` (`NEW`/`STARRED`/`APPLIED`/`DELETED`), `appliedAt`. **`requiredLanguages`** is a `String[] @default([])` normalised to a subset of `["de", "en"]`; the scorer fills it from the JD, and **an empty array is meaningful**: per DECISIONS #38, it means no language requirement was stated, so the board's "English" filter treats the job as English-suffices. Dedupe uniqueness is **per user** (`@@unique([userId, dedupeHash])`). Indexed by `[userId, status]`, `status`, and `source`.
- **`ContactMessage`** — user-submitted feedback. FK to `User` (`onDelete: Cascade`). Snapshots `name` + `email` at submit time so the admin inbox stays accurate even if the user later renames or deletes. `subject`, `category` (enum), `body`, `status` (enum), `createdAt`, `readAt?`, `repliedAt?`. Indexed by `[status, createdAt]` and `[userId, createdAt]`.
- **Enums** — `UserRole` (`USER`/`ADMIN`/`SUPER_ADMIN`); `JobSourceId` (`BA_JOBBOERSE`, `JSEARCH`, `ADZUNA`, `JOBSPY`, `FANTASTIC_JOBS`, `JOOBLE`, plus 6 legacy values kept for historical rows: `INDEED`, `LINKEDIN`, `STEPSTONE`, `XING`, `GLASSDOOR`, `MONSTER`); `JobStatus`; `Seniority`; `JobType`; `ContactMessageStatus` (`NEW`/`READ`/`REPLIED`); `ContactMessageCategory` (`QUESTION`/`BUG`/`FEATURE_REQUEST`/`OTHER`).

> `userId` is nullable on the four data models only so pre-multi-tenancy rows survive migration as orphans until the first account claims them (`src/lib/claim.ts`). New rows always get the authenticated `userId`, and every query scopes by it.

> The board's tab labels are decoupled from `JobStatus`. The default tab is **Inbox** (id `"inbox"`), which `TAB_STATUSES.inbox = "NEW"` maps to the `NEW` enum value — no migration was needed to rename the tab.

The Prisma client is generated to `src/generated/prisma/` (gitignored) — import types from `@/generated/prisma/client` and `@/generated/prisma/enums`.

---

## 6. Setup instructions

```bash
# 1. Install Node deps
npm install

# 2. Environment — two gitignored files (see .env.example):
#    .env       → DATABASE_URL (Prisma reads .env, not .env.local)
#    .env.local → ANTHROPIC_API_KEY, AUTH_SECRET (required), optional
#                 AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET, and source API keys
#
#    Copy the example, then fill in real values.
#    Generate AUTH_SECRET with: npx auth secret
#    Google sign-in is optional — email/password registration works without it.

# 3. Start Postgres in Docker (port 5433)
npm run db:up

# 4. Apply schema migrations
npm run db:migrate

# 5. (Optional) Seed — no-op now. Settings/Profile are created per-user on first
#    use, so there's no global singleton to bootstrap.
npm run db:seed

# 6. (Optional) Set up the JobSpy Python venv if you want the scraping fallback
python3.12 -m venv .venv-jobspy
.venv-jobspy/bin/pip install python-jobspy

# 7. Dev server (Turbopack)
npm run dev   # http://localhost:3000
```

**First-run checklist:**
1. Open `/register` (or `/login` → Google) and create an account → you receive 300 tokens.
2. Open `/settings`, drop a CV → wait for the toast (costs 25 tokens).
3. Open `/`, click **Research jobs** → results stream in 5–60s depending on which sources are configured (costs 0.5/job shown + 1/job rated).

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
| `npm run db:seed` | `tsx prisma/seed.ts` — no-op (Settings/Profile are created per-user on first use) |
| `npm run db:studio` | `prisma studio` — DB browser |
| `npm test` | `vitest run` — payment/token-billing suite (needs Postgres up; auto-creates + migrates `jobhunter_test`) |
| `npm run test:watch` | `vitest` — interactive watch mode |
| `npm run typecheck` | `tsc --noEmit` |

**Test scope** (flagged): the only automated suite is the payment/token-billing tests (see §10 and `docs/TESTING.md` §7). The rest of the app is still covered only by typecheck + lint + manual smoke. There is no CI yet.

---

## 8. Environment variables

`.env` (loaded by Prisma):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string. For local Docker: `postgresql://jobhunter:jobhunter@localhost:5433/jobhunter?schema=public` |

`.env.local` (loaded by Next.js):

| Variable | Required by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude provider (`src/lib/ai/claude.ts`) | CV parsing + scoring on the Claude path. Fallback for the admin-stored key. |
| `AUTH_SECRET` | Auth.js (NextAuth) | ✅ Required. Signs the session JWT + the impersonation cookie. Generate with `npx auth secret` (or `openssl rand -base64 33`). |
| `SUPER_ADMIN_EMAILS` | `src/auth.ts` | Optional, comma-separated. Emails promoted to `SUPER_ADMIN` on sign-in — bootstraps admin access. |
| `GEMINI_API_KEY` | Gemini provider (`src/lib/ai/gemini.ts`) | Optional. Enables the Gemini Flash provider (switch/fallback in admin). Fallback for the admin-stored key. |
| `STRIPE_SECRET_KEY` | `src/lib/stripe.ts` | Optional. `sk_test_…` works as-is; `sk_live_…` is accepted **only with `STRIPE_ALLOW_LIVE=true`**. Enables token purchases. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `src/components/checkout-embed.tsx` | **Required** when payments are enabled. `pk_test_…` for dev, `pk_live_…` for prod. Used on the client to mount Stripe Embedded Checkout on `/checkout/[planId]`. Stripe Dashboard → Developers → API keys. Without it, the embed renders an inline error and Stripe can't load. |
| `STRIPE_ALLOW_LIVE` | `src/lib/stripe.ts` | Optional. `"true"` opts into real charges with a live key — required for live mode, prevents accidental live use otherwise. |
| `STRIPE_WEBHOOK_SECRET` | `/api/stripe/webhook` | Optional, `whsec_…` from `stripe listen` (test) or a live webhook endpoint. The success redirect also credits without it. |
| `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` | Google provider | Google OAuth client (Cloud Console → Credentials → OAuth client ID, "Web application"). Redirect URI: `http://localhost:3000/api/auth/callback/google`. Optional — email/password registration works without it. |
| `JSEARCH_API_KEY` | `jsearch` adapter | RapidAPI key for JSearch |
| `FANTASTIC_JOBS_API_KEY` | `fantastic-jobs` adapter | RapidAPI key for Active Jobs DB. Can reuse the JSearch key (same RapidAPI account). |
| `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | `adzuna` adapter | Free credentials at developer.adzuna.com |
| `JOOBLE_API_KEY` | `jooble` adapter | API key from your Jooble account (jooble.org/api/about). Key is sent as the URL path on each POST. |
| `JOBSPY_SITES` | `jobspy` adapter | Optional comma-separated override. Default: `indeed,glassdoor`. LinkedIn intentionally left out — it aggressively blocks scrapers. |

Sources without their key set surface in the UI as disabled with the hint *"Key needed"* — the toggle is greyed and `configured: false` comes back from `GET /api/sources`.

**Admin-stored keys override env vars.** AI keys and source keys are **global**: a value saved in **Admin → System Settings** lives in `PlatformCredential` (keyed by the env-var name) and takes precedence over `process.env`. Resolution is `getPlatformCredential(name)` in `src/lib/platform.ts` → DB → env. The env entries above are fallbacks for first-run / CI; clear the DB entry to fall back to env again. (There is no longer a per-user credential editor in client Settings.)

The mapping of source → editable fields → env-fallback name lives in `SOURCE_CREDENTIAL_SCHEMA` (`src/lib/credential-schema.ts`). Editable in admin: `JSEARCH` (1 field), `FANTASTIC_JOBS` (1 field), `ADZUNA` (2 fields), `JOOBLE` (1 field). `BA_JOBBOERSE` and `JOBSPY` have no editable credentials.

**Security**: `.env` and `.env.local` are both gitignored. Never paste secrets in chat or in tracked files. `secrets` columns are never returned over the wire — only a `••••<last4>` masked tail.

---

## 9. Coding conventions

Strictly observed in the existing code:

- **TypeScript strict mode**. No `any` outside of narrow tool-input casts (`block.input as { … }`) at trust boundaries.
- **Path alias** `@/*` → `src/*`. Use it; never write deep relative imports.
- **Imports** ordered as: node built-ins → external → `@/…` → relative `./…`, with blank-line separation in some files. Match the surrounding file's style if mixed.
- **Comments** are scarce. They're present only where the *why* would be non-obvious (e.g. the "UNKNOWN passes the narrow-filter" comment in `jobs/route.ts:46-48`; the threshold rationale on `search.ts:8-10`). Don't add explanatory comments for code that's already self-evident.
- **Server-only files** never import client-only deps. Adapters in `src/lib/sources/*` use `process.env` directly and are imported by route handlers under `src/app/api/`.
- **Client components** carry the `"use client"` directive on the top line (`job-board.tsx`, `cv-upload.tsx`, `settings-form.tsx`, etc.). Server components don't.
- **Number inputs** use **`<NumberInput>`** from `src/components/ui/number-input.tsx`, not the raw `<Input type="number" value={number} onChange={(e) => set(Number(e.target.value))}>` pattern. The raw pattern is a trap: `Number("")` coerces to `0`, so backspacing past every digit silently snaps the field back to "0" and the user can't clear the leading zero. The wrapper keeps a string buffer internally (so empty is allowed mid-edit), commits a parsed number to `onValueChange` while typing, snaps blank → `fallback` and clamps to `[min, max]` on blur. Already used by all admin number fields (plans, rate limits, budget alerts, SMTP port).
- **Zod** is used at every external boundary that takes JSON (`PATCH /jobs/[id]`, `PUT /settings`, `POST /jobs/bulk`). The Settings PUT derives its source-id enum from `ALL_SOURCE_IDS` so adding a source doesn't require updating the schema.
- **Errors**: route handlers always return `{ error: string }` with a 4xx/5xx code on failure; the client surfaces these via `sonner.toast.error`.
- **Tenant scoping**: every data access is scoped to the authenticated user. API routes call `getSessionUserId()` from `src/lib/repo.ts` first and return a JSON 401 when it's null; page routes are gated by `src/proxy.ts`. `getSettings(userId)` upserts the row on first access; `getProfile(userId)` reads it. There is no `"singleton"` id any more — `Profile` / `Settings` are keyed by `userId @unique`.
- **AI calls** go through `runWithAi(fn, op?)` (`src/lib/ai`) — never call a provider SDK directly from a route. `cv-parser.ts` / `matcher.ts` are the only call sites.
- **Billing & gates**: any route driving an AI call (`/api/cv` POST, `/api/jobs/refresh`) must (1) gate first via `checkCvUpload` / `checkResearch` (`src/lib/limits.ts`) — these enforce the balance minimums + rate limits, returning 402/429; (2) `charge()` via `src/lib/tokens.ts` *after* the work succeeds; (3) the client calls `notifyTokensUpdated()` so the pill refetches. `charge` still floors at 0 and records overspend as debt — the gate, not `charge`, is what blocks.
- **Admin routes** call `getAdminUser()` / `getSuperAdminUser()` (`src/lib/admin.ts`) first (JSON 403 when null) and `logAdminAction()` for any mutation.
- **Source adapters** all implement `JobSource` from `src/lib/sources/types.ts`: `id / label / tier / connected / configured() / healthCheck() / search(params)` (`configured()` and `healthCheck()` take no args). Adding a source requires (a) adding the enum value to `prisma/schema.prisma` + a migration, (b) the new adapter file, (c) entries in `ALL_SOURCES` (`src/lib/sources/index.ts`) and `SOURCE_META` (`src/lib/constants.ts`), (d) field defs in `SOURCE_CREDENTIAL_SCHEMA` if it needs a key. The orchestrator picks it up automatically based on `tier`.

**Design system** (`src/app/globals.css`): warm cream paper background, deep ink foreground, chartreuse as the single accent. CSS custom properties drive both light and dark modes. Utilities: `.font-display` (Fraunces 550, opsz 96), `.display-italic`, `.eyebrow` (uppercase tracked), `.dot-sep` (middot separator), `.rule`, `.lift-on-hover`. The favicon (`src/app/icon.svg`) reuses the same palette — ink square (`#1A1233`), paper "M" (`#F5F1E8`), chartreuse dot (`#DCCE40`) — so the browser-tab mark matches the in-app header logo.

---

## 10. Things a new developer should know

- **Tests cover the payment flow only.** A Vitest suite (`npm test`) exercises the Stripe/token-billing money paths — `src/lib/__tests__/{tokens,stripe}.test.ts` plus route tests under `src/app/api/{checkout,checkout/confirm,stripe/webhook,admin/users/[id]}/__tests__/`. It runs against a throwaway `jobhunter_test` Postgres (auto-created + migrated by `test/global-setup.ts`, which refuses any DB not ending in `_test`); Stripe and auth are mocked, the DB is real so the `@unique` idempotency constraints are genuinely exercised. Helpers in `test/helpers/db.ts`; config in `vitest.config.ts` (`@test/*` alias, `.env.test`). Everything else is still untested — see `docs/TESTING.md` §7 for coverage + the manual pre-release checklist.
- **There is no CI.** No `.github/workflows`, so nothing runs `npm test` automatically yet — run it locally before releasing payment changes.
- **There is no Dockerfile for the app itself** — only `docker-compose.yml` for Postgres. The app is meant to be run locally with `npm run dev` or built and started with `npm start`. Production deployment is not documented in the repo — see `docs/DEPLOYMENT.md`.
- **There is no license file.** `package.json` has no `license` field and there is no `LICENSE`. Treat the code as "all rights reserved" until the owner declares one.
- **Six legacy enum values** (`INDEED`, `LINKEDIN`, etc.) exist on `JobSourceId` for historical rows only. Do not surface them in the UI or add adapters for them — the project memory rejects scraping LinkedIn/Glassdoor directly.
- **JobSpy needs Python 3.10+**. macOS system Python is often 3.9 — use Homebrew Python (`/opt/homebrew/bin/python3.12`).
- **Hydration warning at boot** is harmless and comes from browser extensions (`cz-shortcut-listen`).
- **Memory-resident state**: `src/lib/prisma.ts` keeps a single Prisma client across dev-mode hot reloads via `globalThis`. Don't `new PrismaClient()` anywhere else.
- **Tokens are now purchasable (Stripe, test mode).** Beyond the 300-token signup grant, users top up on `/plans` via Stripe Checkout. Two **balance gates** exist (CV needs ≥ 25; Research needs > 0) plus admin rate limits — so AI usage *can* be blocked now (a change from the original "never block" design). `charge` itself still floors at 0 and accrues `tokenDebt`; the gates are what refuse. Stripe defaults to test mode; **live billing is supported** but gated — a `sk_live_…` key only works with `STRIPE_ALLOW_LIVE=true`, and going live also needs an activated Stripe account + live webhook (see §4 Payments, §8).
- **Admin access** is DB-authoritative via `UserRole`. Bootstrap the first Super Admin with `SUPER_ADMIN_EMAILS` in `.env.local`, then manage roles in **Admin → Role Management**. No env var = no admin access (everyone is `USER`).
- **Legacy single-tenant data** (`userId = null`) is claimed by the **first** account to register or sign in (`src/lib/claim.ts`, guarded by `userCount === 1`). On a fresh database with no orphan rows this is a no-op.

---

## 11. AGENTS.md (already in repo)

The repo includes a short `AGENTS.md` flagging that this is Next.js 16 and that APIs differ from common training data. Read `node_modules/next/dist/docs/` before assuming a Next.js 13/14 idiom still works (e.g. `searchParams` is now a Promise in dynamic route handlers; see `src/app/api/jobs/[id]/route.ts` line 12).
