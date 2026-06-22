# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Multi-tenancy with Auth.js, an in-app token economy, **Stripe payments**, a
**multi-provider AI layer (Claude + Gemini + Groq)**, and a full **admin backoffice**.

### Fixed — JSearch & Fantastic.jobs returned 0/few jobs on the free RapidAPI tier

- Both adapters fired one request per title×location in parallel, tripping the free tier's per-second throttle and burning its tiny monthly quota (Active Jobs DB: ~25 requests/month) — so Fantastic returned **0** every run and JSearch only a fraction.
- **JSearch:** location collapsed to a single nationwide `"Germany"` query (`country=de` scopes results), cutting requests from title×city (~12) to **≤MAX_TITLES**, kept parallel + a **429 retry** (honors `Retry-After`).
- **Fantastic.jobs:** collapsed to **≤2 sequential queries** (nationwide + remote, `location_filter=Germany` covers the cities) spaced 1.2s, + the same 429 retry.
- City granularity is recovered downstream from each job's city/state and the board's location filter. See DECISIONS #54. *(Operational note: a stale/over-quota **DB-stored** API key silently shadows a working env key — `PlatformCredential` overrides `process.env` — so also verify which key resolves.)*

### Added — admin AI cost controls (scoring provider, fallback order, volume cap)

- **Scoring provider selector** (System Settings → AI providers): job scoring can run on any configured+enabled provider (e.g. Gemini Flash, ~3× cheaper than Claude Haiku) while CV parsing stays on the active provider. Generalises the old Groq-only toggle; `null` = "Same as active".
- **Reorderable fallback chain:** up/down per provider + Reset; switching the active provider or toggling enablement no longer wipes a custom order.
- **"Jobs scored per Research"** number field (`AppSetting "scoring_limits"`, bounds 10–`MAX_SEARCH_JOBS`, default 80) tunes the scoring volume/cost without a redeploy; the refresh route reads it via `getScoringLimits()`. Pre-rank keeps the strongest matches, so lowering it drops only the weakest tail. See DECISIONS #55.

### Added — Research is gated on a CV profile

- Clicking **Research** without a parsed CV profile now opens a dialog prompting the user to set up their profile in Settings (with a "Go to Settings" link), instead of firing a request the server would reject. `hasProfile === null` (still loading) falls through to the existing server-side gate as a backstop.

### Changed — Research: complete-every-run, hard-capped at 2.5 minutes

- **Auto-continue.** One Research click now scores the whole candidate set: the board keeps calling `/api/jobs/refresh` (with `{ continuation: true }` + a `budgetMs`) while the response reports `pendingMore`, so the surfaced count no longer grows across consecutive runs. Continuation passes don't re-bill repeats, so an N-pass run costs the same as one complete run.
- **2.5-minute ceiling.** The whole action is bounded by `RESEARCH_BUDGET_MS` (150s) in `job-board.tsx`; each pass scores for `min(remaining budget, REFRESH_BUDGET_MS)`. When time runs out, source-priority + pre-rank ordering means the best/highest-priority jobs were the ones scored; the rest come next run. See DECISIONS #50–#51.
- **Throughput.** `SCORING_CONCURRENCY` 4 → 6; Claude scoring batch timeout 20s → 15s so a stalled batch can't eat a pass budget.
- **Freshness.** Pre-rank recency weight 0.10 → 0.15 (title 0.45 → 0.40).
- **ETA.** Research progress estimate recalibrated for multi-pass runs and capped at 150s.

### Changed — Cross-source duplicate detection overhaul

- **Shared normalizer** (`src/lib/sources/normalize.ts`): the exact hash and the fuzzy matcher now share one normalization — legal-suffix stripping (`Zalando SE`→`zalando`), umlaut folding (`München`→`muenchen`), postal-code/country/region stripping (`10115 Berlin`→`berlin`), `&`→`and`, and German↔English city aliases (`Munich`→`muenchen`).
- **Looser, smarter matching.** `isLikelySameJob` blocks by normalized **company only** and treats **Remote/empty location as compatible with any city**, so a "Berlin" copy and a "Remote" copy of the same role merge (balanced guard kept: same employer + seniority + ≥70% title overlap).
- **Cross-tab.** The refresh fuzzy filter now compares fresh candidates against **all existing rows in any tab/status** (Inbox/pipeline/DELETED), killing the common case of a job resurfacing from a second source on a later refresh. See DECISIONS #52. *(One-time: the dedupe hash inputs changed, so a few pre-existing rows may re-score once.)*

### Fixed — AI provider settings flipping across serverless instances

- The per-process `settingCache`/`credCache` (`src/lib/platform.ts`) had no expiry, so on multi-instance serverless each instance served its own stale config — the admin "Active provider" appeared to flip (e.g. Gemini ↔ Groq) on refresh, and scoring/CV-parsing could run on different providers per instance. Caches now carry a **30s TTL** (fleet converges within 30s) with a `{ fresh: true }` bypass; the admin AI dashboard GET reads fresh so it's always authoritative. See DECISIONS #53.

### Added — Clear List: whole-tab scope + permanent delete

- **Whole-tab Clear List.** Clear List now clears **every job in the tab in one action**, not just the loaded page. On open, the board resolves the full filtered ID set via `GET /api/jobs?…&idsOnly=1` (uncapped, so it reaches jobs past the `MAX_BOARD_JOBS` inbox cap) and the dialog reports the true total. Fixes having to clear repeatedly when there were more jobs than the listing cap.
- **Permanent delete option.** The Clear List dialog gained an opt-in **"Permanently delete jobs"** checkbox. Unchecked = the existing non-destructive soft clear; checked = a hard delete via the new `POST /api/jobs/bulk { action: "purge" }` (`prisma.job.deleteMany`, chunked 500/call). Irreversible — and because the row is gone, a still-live listing can resurface as a fresh find on a later Research (see DECISIONS #49).
- **Checkbox UI primitive** (`src/components/ui/checkbox.tsx`) wrapping `@base-ui/react/checkbox`.

### Added — board UX: pipeline search, "New" badges, sticky tabs, mobile polish

- **Pipeline search.** The Pipeline toolbar replaces the "N listings" count with a search box (case-insensitive over company, role, location, note, status). The count moves beside it and shows **matches when searching, total otherwise**; a custom clear (✕) button replaces the browser's native `type="search"` X, and a no-match state renders a "No matching jobs" empty state.
- **"New" badge.** `/api/jobs/refresh` now returns `newJobIds`; the board flags freshly discovered jobs with a blue *New* badge (distinct from the emerald *Offer* badge). Persisted in `localStorage` (`mw:newJobIds`) so it survives reloads/tab switches, and **replaced each Research run** so only the latest finds are flagged.
- **Sticky tab nav.** The tab row pins directly below the app header on scroll (frosted band, full content width); the toolbar, filters, and listings scroll underneath.
- **Back to top.** A floating button appears after scrolling down and smooth-scrolls to the top (respects `prefers-reduced-motion`).
- **Responsive board.** Mobile tabs become one horizontally-scrollable strip (Pipeline folded in; pinned right on desktop), the hero CTA goes full-width and the stats strip wraps, and job-card actions stack — all using existing design-system tokens.

### Added — application pipeline, sub-stages & Pipeline table view

- **Six-stage pipeline.** The board gained **Interviewing / Offer / Archived** tabs alongside Inbox / Starred / Applied (`JobStatus` enum + migrations). Stage moves happen via the star icon (→ Starred), an outlined **"Update Status"** dropdown, and **"Back to Inbox"**; `PATCH /api/jobs/[id]` now takes `star/apply/interview/offer/archive/inbox/delete`.
- **"View Job Details"** replaces the old **Apply** button — it's a pure link to the listing and no longer changes a job's stage.
- **Interview sub-stages & archive outcomes.** Interviewing jobs carry a color-coded `interviewStage` (Recruiter Screen → … → Waiting for Decision); Archived jobs carry an `archiveReason` (Rejected / Withdrawn / Closed). Both editable inline via a pill picker (`setInterviewStage` / `setArchiveReason`); new `InterviewStage` / `ArchiveReason` enums.
- **Pipeline tab** — a spreadsheet view (`pipeline-table.tsx`) over Applied/Interviewing/Offer/Archived with **Company · Role · Status · Stage · Link · Note** columns. Stage shows Applied → "Pending", Offer → "Thinking", else the chosen sub-stage. `tab=pipeline` in `/api/jobs` returns the cross-status set, ignoring board filters.
- **Inline notes with auto-save.** New `Job.note` + `setNote` action; the Note column saves on a 700 ms debounce + blur.
- **Styled XLSX export** (`GET /api/jobs/pipeline/export`, `exceljs`) — frozen/auto-filtered header, column widths, Status/Stage cells flattened to the exact on-screen badge colors, and blue underlined "Open" hyperlinks.
- **`postbuild` script** (`prisma migrate deploy`) so deploys apply pending migrations automatically.

### Changed — board layout & toolbar

- Wider desktop content (`max-w-7xl`), header aligned to match.
- The "N listings" count, Filters, and Clear List now share one toolbar row below the tabs; on the Pipeline tab that row shows **Export Table**.

### Added — Groq provider + per-operation scoring split

- **Groq as a free fallback provider** (`src/lib/ai/groq.ts`) — Llama 3.3 via Groq's OpenAI-compatible API (plain `fetch`, no SDK). Registered alongside Claude/Gemini; default fallback chain is **Gemini → Groq → Claude**. New `GROQ_API_KEY` (DB-stored or env). `getAiConfig` runs `reconcileFallback` so a newly-added provider lands at its canonical chain position without a manual re-save.
- **Opt-in "Run job scoring on Groq" toggle** (Admin → System Settings, a Switch). Adds `scoringActive` to the AI config + a `runScoringWithAi` lane: when on, job scoring leads with Groq (then falls through the normal chain) while CV parsing stays on the active/quality chain. Default off = identical to prior behavior. Toggle requires Groq configured + enabled.
- **Gemini transient retry** — rides out 503 "high demand" / 429 / `UNAVAILABLE` / `RESOURCE_EXHAUSTED` with a short jittered backoff before the chain falls through, so a brief spike no longer silently diverts traffic to Claude. `ping()` stays single-shot.

### Changed — source orchestration & freshness

- **Parallel orchestration, no tier gate.** `searchEnabledSources` now runs **every enabled source in parallel** (the "backup only if primary < 10" threshold was removed; priority is enforced at dedup + lexical pre-rank). Supersedes DECISIONS #7.
- **Per-source freshness net** in `search.ts` (`MAX_JOB_AGE_DAYS`): drop listings older than a max age before scoring/persistence — default **40 days**, **Jooble 14**; jobs with no publish date are kept. Adzuna caps natively at **31 days** (`max_days_old`), BA Jobbörse at **40** (`veroeffentlichtseit`) to save upstream quota.

### Fixed — applied/starred jobs reappearing + Clear List persistence

- **Repeat detection now matches `(source, externalId)` as well as `dedupeHash`** in `/api/jobs/refresh`, so an already-applied/starred listing no longer returns when an aggregator re-massages its title/location text between fetches (which shifted the text hash).
- **"Clear List" survives a reload.** The soft-cleared IDs are persisted in `localStorage` (`mw:clearedJobIds`) instead of a memory-only ref, so the cleared view stays clear across reloads/tab switches; a Research run still resets it.

### Removed — JobSpy scraping fallback

- **JobSpy is gone.** Deleted the adapter (`src/lib/sources/jobspy.ts`), the Python bridge (`scripts/jobspy_bridge.py`), the `.venv-jobspy/` gitignore entry, the `JOBSPY_SITES` env var, and every doc reference. It couldn't run on serverless hosts (no Python runtime) and the API sources (BA + JSearch + Fantastic.jobs + Adzuna + Jooble) cover the need. The tiered orchestrator now runs **primary → backup** with no fallback tier.
- The `JOBSPY` value on the `JobSourceId` enum is **kept as legacy** (alongside `INDEED`/`LINKEDIN`/…) so historical `Job` rows stay valid — no migration, no data loss. It's never surfaced in the UI.

### Fixed — first-research timeout

- `POST /api/jobs/refresh` no longer 504s on the first (heaviest) run. Scoring now respects a wall-clock budget (`REFRESH_BUDGET_MS`, default 45 s) and persists only what it scored; `maxDuration` raised to 300 (clamped by plan); each AI batch bounded to 20 s / 1 retry; all source fetches now time out at 12 s via a new `src/lib/sources/http.ts` helper.

### Added — Stripe payments & plans

- **Token purchases via Stripe Checkout** (sandbox/test mode). `/plans` pricing page → `POST /api/checkout` creates a hosted Checkout Session per plan → redirect → `POST /api/checkout/confirm` (idempotent crediting on return) and `POST /api/stripe/webhook` (authoritative). `src/lib/stripe.ts` refuses any non-`sk_test_` key.
- **Idempotent crediting** keyed on a new unique `TokenLedger.stripeSessionId` (`creditCheckoutSession`), so the webhook and the success redirect can both run safely. New `TokenReason` values: `purchase`, `admin_grant`, `admin_deduct`, `refund`.
- **DB-backed plans** — new `Plan` table (seeded Starter/Plus/Pro). `src/lib/plans.ts` is now type + formatters only; data lives in `src/lib/plans-repo.ts`. Pricing page, checkout, and crediting resolve plans from the DB. Admin-editable at **Admin → Plans & Pricing**.
- **Refunds** — `POST /api/admin/users/[id]/refund` issues a Stripe refund (idempotency key) and reverses the granted tokens (`reverseCheckoutTokens`); Refund button + "Refunded" badge on each purchase row.
- **Webhook inspector** — new `WebhookEvent` table records every verified event; **Admin → Stripe Events** viewer.
- New env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. New dep: `stripe`.

### Added — Multi-provider AI (Claude + Gemini)

- **Provider abstraction** in `src/lib/ai/*` (`types`/`claude`/`gemini`/`index`). `runWithAi()` tries the active provider, then a fallback chain (enabled + configured only). `cv-parser.ts` / `matcher.ts` delegate to it; the old `src/lib/anthropic.ts` was removed.
- **Gemini Flash** (`@google/genai`, `gemini-2.5-flash`, structured JSON output) wired alongside Claude; switch the active provider, fallback order, and per-provider enable/disable in **Admin → System Settings**, no redeploy.
- **Global platform config + secrets** — new `PlatformCredential` (keyed by env-var name, DB → env fallback) and `AppSetting` (JSON config) tables; `src/lib/platform.ts`. New env: `GEMINI_API_KEY`. New dep: `@google/genai`.
- **Request logging** — new `RequestLog` table records every AI provider attempt (provider, op, ok, duration, error), powering analytics + API health.

### Added — Source credentials are now global (moved out of the client)

- `src/lib/credentials.ts` rewritten to resolve source keys **globally** (`PlatformCredential` → env), no longer per-user. Adapters' `configured()` take no argument; per-source global enable/disable lives in `AppSetting`.
- The **"API credentials"** and **"Sources"** sections were **removed from client Settings**; managed in **Admin → System Settings → Job sources** instead. The per-user `/api/sources/[id]/credentials` route + `CredentialEditor` were deleted; the per-user `SourceCredential` model is now legacy/unused.

### Added — Admin backoffice

- **Roles** — `UserRole` enum (`USER` / `ADMIN` / `SUPER_ADMIN`) + `disabledAt` on `User`; Super Admin bootstrapped via `SUPER_ADMIN_EMAILS`. Role is DB-authoritative (`src/lib/admin.ts`); deactivation blocks sign-in and all API access. New `AdminAuditLog` table records every privileged action.
- **`/admin`** sidebar app: **Dashboard** (analytics — KPIs, daily trend, token flow, jobs by source, top users, provider usage, failed requests; CSV + PDF export), **User Management** (search/filter, activate/deactivate, edit, token grant/deduct, refunds, GDPR export/erase, impersonate), **Plans & Pricing**, **System Settings** (AI providers, job sources, rate limits, budget alerts), **API Health**, **Announcements**, **Stripe Events**, and **Role Management** (Super Admin only).
- New env: `SUPER_ADMIN_EMAILS`. New dep: `pdf-lib` (PDF reports).

### Added — Guardrails & ops

- **Balance gates** (new policy for two actions): CV upload requires ≥ 25 tokens; Research requires balance > 0 — both return 402 otherwise. **Rate limits** (admin-configurable: research/hour, CV/day) return 429. `src/lib/limits.ts`, enforced in `/api/cv` + `/api/jobs/refresh`.
- **Budget/cost alerts** — admin-set daily thresholds (tokens, AI requests, AI errors) surface a banner on the dashboard. `src/lib/budget.ts`.
- **GDPR** — per-user data export (JSON, secrets stripped) + hard erasure (cascade delete), admin-side and self-serve in `/account`. `src/lib/gdpr.ts`.
- **Impersonate** — admins can "view as user" via a signed cookie (`src/lib/impersonation.ts`); amber banner + audited start/stop.
- **In-app announcements** — admin-posted dismissible banner (`Announcement` table, `AnnouncementBanner`).
- **API health monitoring** — live ping/latency for AI providers + job sources (`src/lib/health.ts`, **Admin → API Health**).

### Migrations

`add_token_purchase`, `add_admin_roles`, `add_platform_config`, `add_plans`, `add_request_log`, `add_announcement`, `add_webhook_event` (hand-written, applied via `prisma migrate deploy`).

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

- In-app token economy in `src/lib/tokens.ts`. Prices: **signup grant 300** (bumped from 150 so a new account covers a CV parse + ~2 Researches out of the gate), **CV parse 25**, **0.5 per job displayed**, **1 per job freshly rated**. Limits: `MAX_SEARCH_JOBS 150` (considered per refresh), `MAX_BOARD_JOBS 70` (Inbox listing). Balances use 0.5 increments (`Float`).
- New `User` columns `tokenBalance`, `tokenDebt`, `tokensGrantedAt`, and an append-only `TokenLedger` model (`delta`, `balanceAfter`, `reason`, `metadata?`, indexed `[userId, createdAt]`). Migration `20260524180753_add_token_billing`.
- `getTokenAccount(userId)` applies the one-time 300 grant lazily (atomic `updateMany` claim — never double-grants); fired on first Google sign-in (`createUser` event) and on email/password registration.
- `charge()` never blocks the run: balance floors at 0 and overspend is recorded as `tokenDebt`, so the UI never shows a negative. One ledger row per charge. `grant()` pays down debt first.
- Charging wired into `POST /api/cv` (25 per upload; inline `PATCH` edits are free) and `POST /api/jobs/refresh` (billed after the run succeeds; repeats-only runs bill re-display but never re-rate).
- Balance surfaced via `GET /api/tokens` and `GET /api/account`; a header pill (`useTokenBalance`) refetches on a `tokens-updated` window event (`notifyTokensUpdated()` fired from the board and CV upload).

### Added — Jooble source

- New backup-tier adapter `src/lib/sources/jooble.ts`. POSTs `{ keywords, location, page, ResultOnPage, SearchMode }` against `https://jooble.org/api/{apiKey}`; HTML-stripped 4000-char snippets; infers seniority + job type. Caps at 4 titles × locations × 2 pages per run.
- New `JOOBLE` value on the `JobSourceId` enum (migration `20260529120000_add_jooble_source`). `SOURCE_CREDENTIAL_SCHEMA.JOOBLE = { apiKey → JOOBLE_API_KEY }`, `SOURCE_META` + `ALL_SOURCES` entries, and `JOOBLE_API_KEY` in `.env.example`. Editable in **Admin → System Settings → Job sources**.
- Tier: **backup** — runs alongside Adzuna when the primary tier returns fewer than 10 results.

### Added — Language hybrid (parse + score + filter)

- **Profile.languages** — free-text spoken languages parsed out of the CV (e.g. `"German (native)"`, `"English (fluent)"`); editable as a chip section between Industries and Keywords in Settings; carried in the scorer's system prompt so the model can penalize unmet language requirements. Schema + `parseCvProfile` (Claude `CV_TOOL` + Gemini `CV_SCHEMA`) + `cv-upload.tsx` UI + `PATCH /api/cv` Zod schema all updated.
- **Job.requiredLanguages** — normalised `string[]` ⊆ `["de", "en"]` emitted by the scorer per job. The user prompt now carries a **300-char description snippet** so the model can detect "Deutschkenntnisse erforderlich"-style flags that don't live in the title.
- **Board "Language" filter** — German / English multi-select in `filter-bar.tsx`. Maps against `Job.requiredLanguages` with the product rule (DECISIONS #38): both checked or neither = no filter; "de" only = job requires German; "en" only = job does NOT require German (so jobs with empty `requiredLanguages` qualify as English-suffices, matching the German tech-market default).
- Migration `20260529130000_add_language_filter` — both columns default to `'{}'`; existing rows behave as English-OK until they're re-scored.

### Changed / Fixed — UI

- **`<NumberInput>` wrapper** (`src/components/ui/number-input.tsx`) — fixes admin number fields where you couldn't backspace past the leading "0" (the `Number("") → 0` trap). String-buffered internally, commits parsed numbers to `onValueChange` while typing, snaps blank → `fallback` and clamps to `[min, max]` on blur. Used by `plans-manager.tsx`, `rate-limit-settings.tsx`, `budget-settings.tsx`, `email-settings.tsx`.
- **Filter bar redesigned** into two rows — row 1 a four-column CSS grid (Location, Seniority, Job type, Language); row 2 packs Date posted, the Match slider with "Any" / "Top" endpoint labels, and Reset on the far right. Active filters now flip their indicator to `text-foreground font-medium` so narrowed filters are visible at a glance.
- **Inbox Clear List → soft-clear** — rows stay in the DB; the click hides them from the current view via a session-local ref and they come back on the next Research. Click is now gated by an `AlertDialog` confirmation.
- **Refresh snackbar** stripped of the per-source breakdown (`JSearch: 0 · BA Jobbörse: 23 · …`); only the top-line summary ("Added N new jobs · spent X tokens") remains.
- **Hero & metadata generic when no job title is set** — board hero falls back to "Roles matched to you, ranked by fit." and the social-preview title/description ditch the "Product Design jobs" framing for profession-agnostic copy.
- **Match slider visual fix** — track now spans 0..100 (the 90→100 tail is always a visible active sliver); the threshold is still clamped to ≤90 in `onValueChange`. Previously the active fill collapsed to 0 px at value=90.

### Added — Editorial split-screen login page

- **Brand illustration on `/login`** (`public/auth-illustration.svg`, 285 KB svgo'd from 1.18 MB). New `AuthShell` API: `illustrationSrc?` + `illustrationTagline?` (ReactNode); when provided, the shell switches to a split-screen on `lg+` — form column on a pinned Sage `#C7D7A0` surface, illustration column on a pinned Paper `#F5F1E8` surface. Below `lg`, falls back to single-column centered.
- **Interactive eye** — new `src/components/auth/auth-illustration.tsx` client component. Renders the SVG as `<img>` for instant first paint, then `fetch()`s the same URL and swaps to inline SVG via `dangerouslySetInnerHTML` so refs can resolve into named groups. Once inlined: blink loop (random 6–10 s gap, 200 ms close duration via `Open Eye`/`Close Eye` visibility toggle), cursor tracking (window-level `mousemove`, eye groups translate together within a 20 × 28 px ellipse around the eye's own resting center, rAF-throttled), and click-to-blink that resets the random schedule.
- **In-SVG CSS animations** — `<style id="auth-illustration-anim">` block at the top of the file carries a `hi-bob` keyframe (translateY + scale, 3.5 s, evenly phase-offset across six groups via negative delays), a `[id="Close Eye"]{visibility:hidden}` initial state to avoid FOUC, and an in-SVG `@media (prefers-reduced-motion: reduce)` guard. Animations play in both `<img>` and inline modes.
- **`svgo.config.mjs`** at the project root — picked up automatically by `npx svgo`. Disables `cleanupIds` so Figma layer names (`Hi-A`..`Hi-E`, `Open Eye`, `Close Eye`, `10519287 9`) survive optimization for CSS+JS targeting.
- **Form polish**: `autoFocus` + `inputMode="email"` on the email field, password show/hide toggle (Eye/EyeOff in the right pad), submit-button spinner, chartreuse-tinted "or" divider hairlines (`bg-accent/30`), forgot-password link aligned to input's bottom edge, error message gets `role="alert"` + `aria-live="polite"`.
- New `globals.css` keyframe `authIllustrationMount` (fade + 8 px lift, 480 ms ease-out spring) + `.auth-illustration-mount` / `.auth-illustration-caption` classes for the column entrance.

### Fixed — Match filter race condition

- `fetchJobs(signal?: AbortSignal)` in `src/components/job-board.tsx` now takes an `AbortSignal` and passes it to the underlying `fetch()`. The `useEffect` that triggers fetches creates an `AbortController` per run and aborts on cleanup, so a slower earlier filter fetch can no longer resolve *after* a newer one and overwrite the visible results. Visible symptom this fixes: "Match filter sometimes doesn't work" — slider showed e.g. 90, but the board displayed jobs scoring 30+. Cancellation also applies to every other filter (Location, Seniority, Job type, Language, Date posted), so rapid chip-clicking is race-free.

### Added — Contact form & admin inbox

- New **`ContactMessage`** model (migration `20260602100000_add_contact_message`) with two enums: `ContactMessageStatus` (`NEW`/`READ`/`REPLIED`) and `ContactMessageCategory` (`QUESTION`/`BUG`/`FEATURE_REQUEST`/`OTHER`). FK to `User` (cascade on user delete). Indexes: `[status, createdAt]` and `[userId, createdAt]`.
- **`/contact`** — auth-gated feedback form (subject up to 120 chars + category + body up to 2000 chars). Identity (name, email) auto-populated from the session and shown as a read-only card above the form.
- **`POST /api/contact`** — Zod-validated; rate-limited 5/day per user via the new `checkContactMessage` in `src/lib/limits.ts` (counts directly from `ContactMessage`, no token cost). Inserts the row, then best-effort fires `sendContactNotification()` to the admin destination — message is saved even if the email fails.
- **`sendContactNotification`** in `src/lib/email.ts` — sits next to `sendPasswordResetEmail`, reuses the SMTP → Resend → console transport ladder. Outgoing subject prefixed `[Matchwerk · <Category>] <user subject>` for client-side filtering. HTML body HTML-escapes the user-supplied text and renders newlines as `<br>`.
- **Admin inbox** — `/admin/messages` lists messages newest-first with status filters (All / New / Read / Replied), a category badge, and a debounced search across subject/name/email. Click-through to `/admin/messages/[id]` shows the full body, sender card with a deep-link to `/admin/users/[userId]`, and an action row: **Reply via email** (mailto: with `Re: <subject>` and quoted body — opens the admin's default mail client and also marks the message replied), **Mark read** / **Mark replied** / **Reset to New**, plus a destructive **Delete** behind an `AlertDialog` confirmation. Status transitions write `contact_message_status` to `AdminAuditLog`; deletes write `contact_message_delete` preserving sender email + subject + last status.
- **Entry points** — header user menu ("Contact us" next to Settings), `/account` "Need help?" card, admin sidebar "Messages" item between Announcements and Stripe Events.
- **Admin config** — `/admin/system` gains a "Contact destination" section that writes `AppSetting("contact_to")` (env `CONTACT_TO` as fallback when DB is empty). Same DB-overrides-env pattern as the AI keys.

### Added — Stripe Embedded Checkout + custom merchant panel

- **`/checkout/[planId]`** — new server-component page (auth-gated). Two-column layout on `lg+`: a `bg-secondary` merchant panel on the left (Sand light / muted plum dark — fully theme-aware) carrying the brand lockup, plan summary, price, usage anchor (`≈ N jobs fully matched against your CV` derived from `TOKEN` constants), and a trust band; **Stripe Embedded Checkout** on the right via `<CheckoutEmbed>`. Replaces the previous `redirect to checkout.stripe.com` flow — users now stay on `matchwerk.app` throughout the payment.
- **`<CheckoutEmbed>`** (`src/components/checkout-embed.tsx`) — client component. `POST /api/checkout` on mount → fetch `{ clientSecret, sessionId }` → mount `EmbeddedCheckoutProvider` + `EmbeddedCheckout` from `@stripe/react-stripe-js`. Module-scoped `loadStripe()` so the SDK isn't re-loaded per mount. Skeleton fallback during the fetch + a clear inline error if the publishable key isn't set.
- **`/api/checkout`** switched to `ui_mode: "embedded_page"` (API `2026-04-22.dahlia` — the SDK v22 default — renamed `embedded` → `embedded_page` and `hosted` → `hosted_page`). Returns `{ clientSecret, sessionId }` (was `{ url }`). New params on the create call: `customer_email` prefilled from the session user, `locale: "auto"` for DE/EN auto-detection in the embed, `billing_address_collection: "auto"` so the form stays lean unless the user's country requires it.
- **Auto-discover payment methods** — dropped the hard-coded `payment_method_types: ["card"]`. For Checkout Sessions, omitting the list tells Stripe to present whichever methods are enabled in Dashboard. By default that's **Cards + Link + Apple Pay + Google Pay** (no Dashboard changes needed). SEPA / Klarna / Sofort / iDEAL / Bancontact / etc. become available the moment they're toggled on in Stripe Dashboard → Settings → Payment methods — no code change.
- **`PricingTable.handleContinue`** changed from `fetch + window.location.assign(stripeUrl)` to `router.push(`/checkout/${plan.id}`)`. The new page owns the session creation. Button label "Opening checkout…" (was "Redirecting…").
- **Editorial card chrome** around the embed: hairline `border-[#1A1233]/8` (light) / `border-white/8` (dark) + two-layer Ink-tinted shadow + `bg-accent` 2-px strip at the top edge (chartreuse light, lavender dark — Atelier accent flip). Loading skeleton lifted to the same chrome so the visual doesn't jolt at the swap.
- **Theme handling** — merchant panel uses Atelier semantic tokens throughout (`bg-secondary`, `bg-primary`/`bg-accent` for logomark, `bg-accent/10 border-accent/40` for the token chip — all flip per theme). Stripe iframe stays white internally (Stripe Embedded doesn't theme); the inner padding area inside `<CheckoutEmbed>` is pinned to `bg-white` in both modes so the iframe + its padding read as one continuous white surface, with the outer card chrome staying theme-aware around it.
- **New deps** — `@stripe/stripe-js` + `@stripe/react-stripe-js` (small; the official browser SDK loader + React bindings).
- **New required env** — `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (a `pk_test_…` for dev, `pk_live_…` for prod). Must be set in `.env.local` AND Vercel's Production env vars — without it the embed shows an inline error instead of failing silently inside Stripe's SDK.
- **Webhook + confirm flow unchanged** — still `creditCheckoutSession` idempotent on `TokenLedger.stripeSessionId`. Refunds + admin tooling unchanged.
- **Test coverage**: route test updated to assert the new `{ clientSecret, sessionId }` shape, the new `ui_mode: "embedded_page"`, `customer_email`, `locale`, `billing_address_collection`, the absence of `payment_method_types`, and a 502 case for missing `client_secret`. 45/45 still pass.

### Added — Settings → board CTA

- **`board-cta.tsx`** — new section at the end of `/settings`: a "Last step / You're all set" card with a readiness checklist (CV uploaded & parsed; at least one job title) and a **"Take me to the board"** button (→ `/`). Improves discoverability — users were having trouble finding the board after filling in their CV and preferences.
- **Gated navigation** — the button is only active once both requirements are met (manually or auto-filled by a CV upload), so users can't proceed before the board has what it needs to score jobs. The checklist shows a per-step done/pending state and an "X of 2 steps done" progress line.
- **Live readiness** — both inputs live in sibling components (`cv-upload.tsx` / `settings-form.tsx`), so the CTA re-derives readiness from `/api/cv` + `/api/settings` and re-checks on the existing `cv-updated` / `settings-updated` window events; the button lights up immediately after a CV upload or a settings save, no reload.
- **Design** — Atelier card with the `bg-accent` top strip (chartreuse light / lavender dark), `font-display` headline, theme-aware muted/accent surfaces, and the `render={<Link/>}` base-ui button pattern.

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
