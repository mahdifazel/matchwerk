# Technical Decisions

A record of *why* each non-obvious choice in the codebase exists. New contributors: read this before suggesting "shouldn't we just ____?" — usually the alternative was considered and there's a reason it's not here. Where the rationale is not derivable from the code or repository memory, that's flagged explicitly.

---

## 1. Multi-tenant with Auth.js v5 (was: single-user)

**Decision.** The app authenticates users with **Auth.js v5 (NextAuth)** — a Google provider and an email/password Credentials provider, JWT session strategy (`src/auth.ts` / `src/auth.config.ts`). Every data model (`Profile`, `Settings`, `Job`, `SourceCredential`) carries a `userId` and is scoped to its owner; `Profile` / `Settings` are one-per-user (`userId @unique`). Page routes are gated by `src/proxy.ts`; API routes self-guard via `getSessionUserId()`.

**History.** It started single-user: `Profile` and `Settings` were Prisma singletons with `id = "singleton"`, no users table, no auth — the project was the owner's personal tool, and multi-tenant scaffolding would have doubled the surface area for zero value. That rewrite has now happened (migration `20260524154733_add_auth_multitenant`). The `userId` columns are nullable purely so the original single-tenant rows survived the migration as orphans; they're claimed by the first account to sign in (see #9), after which every query carries a non-null `userId`.

**Why the change.** Supporting more than one account was worth the surface area once the app was good enough to share. JWT sessions (rather than DB sessions) keep reads off the database on every request; passwords are bcrypt-hashed and OAuth-only users carry `password = null`.

**Implication.** "Current user" is no longer implicit — every new query must scope by `getSessionUserId()`, and every new route must return a JSON 401 when it's null. Forgetting to scope is now a cross-tenant data leak, not a no-op.

---

## 2. Real jobs only, no mock data

**Decision.** Sources without credentials return `[]`. Stubs do not synthesize listings. There are no demo fixtures.

**Why.** Project memory (`project_job_hunter.md`): "Don't propose mock/fake job data — the user explicitly rejected it." Fake job listings would defeat the entire point of an honest job-hunt tool and would silently fail in production if not removed.

**Implication.** The empty-state UX has to be good — see `src/components/empty-state.tsx`. A first-run user with no API keys sees an honest "no listings" rather than a populated demo board.

---

## 3. Two Claude models: Sonnet for CV, Haiku for scoring

**Decision.** `src/lib/anthropic.ts` pins:

```ts
MODELS = {
  cvParse: "claude-sonnet-4-6",
  scoring: "claude-haiku-4-5-20251001",
}
```

**Why.**

- **CV parse runs once per upload.** Quality matters: misclassifying seniority or missing core skills propagates into every later score. Sonnet pays for itself in a single call.
- **Scoring runs over every new job on every refresh** — often 50–100 jobs per scan. Haiku is roughly an order of magnitude cheaper and fast enough to keep the refresh under a minute. Tool-use forces a structured output, so the cheaper model doesn't compromise schema reliability.

**Why those exact IDs.** `claude-sonnet-4-6` and `claude-haiku-4-5-20251001` are the Claude 4.x family IDs current at project start (May 2026). Update both together when migrating to a newer family.

---

## 4. Tool-use instead of JSON-in-text

**Decision.** Both `parseCvProfile` (in `cv-parser.ts`) and `scoreJobs` (in `matcher.ts`) use Anthropic tool-use with `tool_choice: { type: "tool", name: <tool> }`.

**Why.** Asking a model to "return JSON" is fragile — extra prose, fenced code blocks, escaped characters all need parsing. Tool-use returns a typed `input` object directly, validated against an `input_schema`. The schema doubles as documentation.

The narrow casts (`block.input as { … }`) at lines 110–118 of `matcher.ts` and 120–129 of `cv-parser.ts` are the only `as` casts in the production code paths. They live at the trust boundary between the SDK and our types — acceptable.

---

## 5. Cached CV in the scoring system prompt

**Decision.** `matcher.ts` sends the system prompt with `cache_control: { type: "ephemeral" }`:

```ts
system: [
  { type: "text", text: buildSystemPrompt(profile, jobTitles),
    cache_control: { type: "ephemeral" } },
],
```

**Why.** Scoring batches 10 jobs per request. Without caching, the entire CV profile is re-tokenised on every batch. Ephemeral caching (5-minute TTL) means the second-through-Nth batch pay only for the user-message delta.

---

## 6. Source orchestrator driven by `tier`, not a hardcoded list

**Decision.** `searchEnabledSources` (`src/lib/sources/search.ts`) filters `ALL_SOURCES` by `source.tier`. There is no explicit `[baJobboerse, jsearch]` array in the orchestrator any more.

**Why.** An earlier version hardcoded the primary tier as `[baJobboerse, jsearch]`, which silently skipped Fantastic.jobs when it was added even though its `SOURCE_META` entry said `tier: "primary"`. Driving the orchestrator from the data fixes the class of bug — adding a source now requires zero changes to `search.ts`.

---

## 7. The 10-result backup threshold

> **Superseded.** The threshold gate was removed — `searchEnabledSources` now runs **every enabled source in parallel** (recall-first; source priority is enforced downstream at dedup + the lexical pre-rank, not by skipping sources). Stale-listing cost is instead bounded by a per-source **freshness net** in `search.ts` (`MAX_JOB_AGE_DAYS`: default 40 days, Jooble 14; Adzuna/BA also cap natively). The original decision is kept below for history.

**Decision.** `PRIMARY_SUFFICIENT_THRESHOLD = 10`. If the primary tier returns ≥ 10 jobs, backups are skipped.

**Why.** Adzuna and Jooble exist to plug gaps. When BA + JSearch + Fantastic.jobs already return dozens of listings, querying the backups adds cost (extra API quota) for marginal extra signal — most of which would dedupe away anyway. 10 is small enough to trip when one or two primaries are misbehaving but large enough that a normal day doesn't tax the backups.

**Tradeoff.** With a CV scoped to a narrow city (e.g. "Berlin only, contract only"), 10 results from primary tier might mean you're missing valuable backup hits. If this matters in practice, lift the threshold or move Adzuna to `primary` tier.

---

## 8. Dedupe by hash, then by similarity

**Decision.** Two distinct passes:

1. `dedupeHash` (SHA-1 of `normTitle|normCompany|normCity`, with gender markers stripped) collapses cross-source duplicates and is stored as a `@unique` column so the DB is the last line of defense.
2. `isLikelySameJob` runs only against the user's *starred* and *applied* rows during refresh — title overlap ≥ 70 %, same company, same city, same seniority words.

**Why.** Hash-based dedupe is fast but exact. A listing posted as "Senior Product Designer" on LinkedIn and "Senior Product Designer — parental leave cover" on the company's career site would hash differently — and the user, having already applied to one, doesn't want the variant resurfacing two weeks later.

A full pairwise similarity sweep across all `RawJob`s would be O(n²) — running it only against the small set of starred/applied rows keeps the cost bounded.

> **Updated (see #52).** `isLikelySameJob` now runs against **every existing row in any tab/status** (not just starred/applied), blocked by normalized company so it stays bounded, and shares one normalizer with the hash. It also treats Remote/empty location as a wildcard. This fixes cross-source duplicates resurfacing in the Inbox across refreshes.

---

## 9. Per-user `Profile` / `Settings`, keyed by `userId @unique` (was: singleton id)

**Decision.** `Profile` and `Settings` are one-per-user: a `cuid` primary key plus `userId String? @unique`. Every read site uses `findUnique({ where: { userId } })` or `upsert({ where: { userId }, … })` via `getProfile(userId)` / `getSettings(userId)` in `src/lib/repo.ts`. There is no `PROFILE_ID` / `SETTINGS_ID` constant any more.

**History.** Originally both used `id String @id @default("singleton")` and every accessor looked up `{ id: "singleton" }` — unambiguous, constant-time, and `upsert` removed the create-if-not-exists race. Multi-tenancy (decision #1) replaced the literal id with the `userId @unique` constraint, which gives the same single-row-per-key guarantee and the same race-free `upsert`, now per tenant.

**Why `userId` nullable.** Only so the original `"singleton"` rows (which had no owner) survived the migration. They're adopted by the first account; thereafter the column is effectively non-null. See the claim mechanism in #1.

---

## 10. Prisma 7 with `@prisma/adapter-pg`

**Decision.** `src/lib/prisma.ts` uses `new PrismaPg({ connectionString })` rather than Prisma's default `pg` connection.

**Why.** Prisma 7's driver-adapter architecture decouples the engine from the database driver. Combined with `serverExternalPackages: ["pg", "@prisma/adapter-pg", …]` in `next.config.ts`, this is the configuration that runs cleanly inside the Next.js 16 / Turbopack runtime. The default Prisma client has had bundling issues in the App Router.

---

## 11. JobSpy as a Python sidecar — *removed*

**Superseded.** JobSpy (the open-source scraping fallback) ran in a project-local Python venv spawned via `child_process.spawn`. It couldn't run on serverless hosts (no Python runtime), added a slow/fragile scraping path, and the API sources (BA + JSearch + Fantastic.jobs + Adzuna + Jooble) cover the need. The adapter, the Python bridge, and the venv have been **deleted**; the `JOBSPY` enum value is kept only so historical `Job` rows stay valid. The tiered orchestrator now runs primary → backup with no fallback tier.

---

## 12. LinkedIn and friends as enum-only, no adapter

**Decision.** `JobSourceId` retains six legacy enum values — `INDEED`, `LINKEDIN`, `STEPSTONE`, `XING`, `GLASSDOOR`, `MONSTER` — but there are no adapters for them and they don't appear in `SOURCE_META`.

**Why.** Two reasons:

1. **No legal/practical API.** Project memory: "LinkedIn, Glassdoor, XING, Monster, StepStone, Indeed have no open API — they're stub adapters marked 'Not connected', added later only via a paid aggregator key." JSearch and Fantastic.jobs cover most of these via aggregation.
2. **Historical rows.** Earlier iterations of the project stored jobs with these source IDs. Removing the enum values would invalidate those rows. Keeping them in the enum but absent from `SOURCE_META` retires them from the UI without breaking the database.

---

## 13. Tailwind 4 with no config file

**Decision.** No `tailwind.config.*`. All tokens (palette, radii, fonts) declared in `src/app/globals.css` via `@theme inline`.

**Why.** Tailwind 4's CSS-first config model. Tokens, dark mode, and utilities all live in one CSS file, viewable next to the components that consume them. The `components.json` shadcn config (`baseColor: "neutral", cssVariables: true`) is compatible with this.

---

## 14. Fonts: Inter + Fraunces + JetBrains Mono

**Decision.** Three families via `next/font/google` with custom CSS-var names (`--font-jh-sans`, `--font-jh-display`, `--font-jh-mono`) to avoid collision with Tailwind's theme tokens.

**Why.**

- **Inter** for body — best-in-class screen legibility, mature optical sizing.
- **Fraunces** for display — substantial serif designed for screens, with an `opsz` axis we use at value 96 for headlines. Earlier versions used Instrument Serif; switched because it was too thin at body sizes.
- **JetBrains Mono** for tabular numerics — score values, stat counts, source IDs in toasts.

**Why the `--font-jh-*` prefix.** Tailwind 4's `@theme inline` block already defines `--font-sans` / `--font-mono` as theme tokens. Using those names for the next/font output variables creates a self-referential cycle (`var(--font-sans)` referencing itself). The `jh-` prefix breaks the cycle.

---

## 15. Defensive filter rule: UNKNOWN passes when narrowed

**Decision.** `GET /api/jobs` filters with `where.seniority = { in: [...seniority, "UNKNOWN"] }` *only* when `seniority.length < ALL_SENIORITY.length` (and similarly for `jobType`).

**Why.** Two failure modes are avoided:

1. **Default state.** When everything is selected, `where.seniority` is unset. Otherwise jobs whose seniority couldn't be inferred (a real outcome — many German listings don't use English seniority keywords) would be hidden from a user who hasn't touched the filter.
2. **Narrowed state.** When the user picks "Senior only", UNKNOWN-classified jobs still pass through. Otherwise the regex-based seniority inference's misses become user-visible holes.

The same logic applies to `jobType`. For `source`, no UNKNOWN passes because every job has a hard-known source. For `location`, the matching is substring-against-known-cities so there's no UNKNOWN equivalent.

---

## 16. Apply opens the URL *and* marks applied in one click

**Decision.** The Apply button in `job-card.tsx` is rendered as `<a target="_blank">` and also fires `onAction(job.id, "apply")` on click.

**Why.** A two-step "open the job, then come back and mark applied" workflow loses applications — users leave the tab and never come back. Coupling them costs one false-positive "applied" mark in the rare case the user opened the link but didn't apply (they can `Unstar`/`Hide` later) in exchange for never losing a real application from the log.

---

## 17. Dev-only Prisma `globalThis` cache

**Decision.** `src/lib/prisma.ts` caches the client on `globalThis.prisma` in non-production. In production a new client is constructed per process.

**Why.** Next.js dev mode hot-reloads server modules. Without the cache, every reload would instantiate a new `PrismaClient`, exhausting the Postgres connection pool within minutes. This is the standard Prisma + Next.js dev pattern.

---

## 18. Title filter for Fantastic.jobs is a Postgres tsquery, not a plain string

**Decision.** `buildTsQuery` in `src/lib/sources/fantastic-jobs.ts` tokenises each user-supplied title on non-alphanumerics, ANDs the tokens, then ORs the groups:

```
["Product Designer", "ux/ui designer"]
  → "(product & designer) | (ux & ui & designer)"
```

**Why.** The Active Jobs DB API parses `advanced_title_filter` as a Postgres tsquery. An earlier version sent the titles pipe-joined as a literal string, which the API rejected with `42601: syntax error in tsquery`. The fix isn't to switch to the simpler `title_filter` parameter — that supports only a single substring — but to honour the tsquery grammar.

---

## 19. JobSpy default sites — *removed*

**Superseded.** JobSpy has been removed (see #11), so its site-selection decision no longer applies.

---

## 20. Three Anthropic SDK usages, one client

**Decision.** `getAnthropic()` lazily constructs one process-singleton `Anthropic` client. No retry or backoff is configured at our layer.

**Why.** The SDK has its own retry logic built in for transient errors. Adding our own would mean tuning timeouts twice. A failure that escapes the SDK is genuinely terminal for that request — the user can hit Refresh again.

---

## 21. Things the codebase deliberately *doesn't* do

- **No queue / no worker.** Refresh runs inline — each refresh is one user's HTTP request, and the per-user `@@unique([userId, dedupeHash])` + `skipDuplicates` make concurrent refreshes by the same user safe without coordination.
- **No telemetry.** No Sentry / analytics. The `TokenLedger` is the closest thing to usage instrumentation — an append-only record of every charge per user — but it exists for billing transparency, not ops monitoring.
- **No i18n.** UI is German job market, English UI text. The owner reads both fluently.
- **No SWR / React Query.** `useEffect + fetch` is sufficient for the handful of endpoints; adding a cache layer would need invalidation strategy we don't have.
- **No tests.** See `docs/TESTING.md` for the honest reasoning and a roadmap.

---

## 22. DB-backed source credentials with env fallback

> **Superseded (2026-05-25).** Source keys are now **global**, not per-user, and managed in the admin backoffice rather than client Settings. They live in `PlatformCredential` (keyed by the env-var name), resolved DB → env via `src/lib/platform.ts` (`getSourceCredentials(sourceId)` in `src/lib/credentials.ts` no longer takes a `userId`). The client `CredentialEditor` and `/api/sources/[id]/credentials` were removed; the per-user `SourceCredential` table is legacy. The env-fallback rationale below still holds; the per-user / per-process-cache details do not.

**Decision.** A `SourceCredential` Prisma row (one per `JobSourceId`, `secrets: JSONB`) stores per-source API keys edited via Settings → API credentials. `getSourceCredentials(sourceId)` in `src/lib/credentials.ts` resolves DB-first, then `process.env[field.envFallback]` named in `SOURCE_CREDENTIAL_SCHEMA`. The UI never sees the raw value — only a `••••<last4>` mask.

**Why.** Editing `.env.local` and restarting the dev server every time a key needs to change is fragile and slow. DB-backed credentials let the user paste a key in the UI and have it take effect on the next refresh, no restart. Keeping env as the fallback means the existing onboarding (`.env.example` → `.env.local`) still works for first-run and CI.

**Why not skip env entirely.** Because (a) `.env.local` is convenient for development before any DB row exists, and (b) machine reprovisioning shouldn't require manually re-entering keys in the UI — env restores them.

**Why a per-process cache.** The dev app runs as a single process, so a per-process cache is enough; `setCredential` / `clearCredential` invalidate locally on write. The cache is keyed by `(userId, sourceId)`, so one tenant's saved key never leaks into another's resolution. A multi-instance deployment would need a shared cache or short TTL — flagged for whenever deployment is documented.

---

## 23. Editable CV profile without re-upload

**Decision.** `PATCH /api/cv` accepts `{ summary?, skills?, tools?, industries?, keywords? }` — partial Zod-validated updates. `cv-upload.tsx` renders an inline editor (chips with × buttons, summary textarea, Save / Discard).

**Why.** Re-uploading the CV to add a single skill or fix a parser miss is friction and costs a Sonnet call every time. The parsed fields are the matcher's input — letting the user nudge them directly is faster, cheaper, and preserves the rest of the parse.

**What `PATCH` deliberately can't touch.** `seniority`, `yearsExperience`, `rawCvText`, `fileName`, `parsedAt`, and the `suggestedJobTitles` side-effect. Those are CV-derived facts; editing them out of band would diverge from the source of truth.

---

## 24. CV-suggested job titles auto-overwrite Settings.jobTitles

**Decision.** The `save_cv_profile` tool returns exactly 3 `suggestedJobTitles`. `POST /api/cv` overwrites `Settings.jobTitles` with those three on every upload, no merge.

**Why.** Three concrete, model-picked titles is the fastest path to a usable search. Merging would mean stacking titles from different CVs — eventually you'd be searching for "Senior Product Designer" and "Backend Engineer" at once, which the matcher would have to dilute. The user can edit any of the three afterwards in Settings.

**Why exactly 3.** Enough to cover the obvious title variants (e.g. *Senior Product Designer / Product Designer / UX Designer*) without spamming source APIs. Each title fires one query per location per source.

---

## 25. New CV deletes all `NEW` jobs

**Decision.** `POST /api/cv` ends with `prisma.job.deleteMany({ where: { status: "NEW" } })`. `STARRED` and `APPLIED` are preserved.

**Why.** A new CV may represent a completely different profession. Leaving 80 Product Designer matches on the board after uploading a Lawyer CV is misleading — and the dedupe pool would keep those old rows blocking re-fetches of legitimately-different listings. Hard delete (rather than `status = DELETED`) removes them from the dedupe pool too, so genuinely-relevant re-postings can land cleanly.

**Why preserve `STARRED` and `APPLIED`.** Those are user actions and history; even after a career pivot, the record of "I applied to X" should stand. The `Applied` tab still shows them.

---

## 26. Role-agnostic scoring system prompt

**Decision.** `buildSystemPrompt` (`src/lib/matcher.ts`) no longer hardcodes *"You are a job-matching engine for a Product Designer"*. The role is derived from `jobTitles[0]`, and the prompt explicitly instructs the model: *"The candidate's profession is whatever their CV profile says it is — do not assume any specific industry or role beyond what's described below."*

**Why.** Decision #24 already lets the system retarget search; if the scoring prompt still pretended every candidate was a Product Designer, scores for a Lawyer CV would be biased toward design-adjacent jobs. The fix is upstream of any caching or filtering.

**Why keep "in Germany".** The app's source surface is German job boards; the geography stays fixed by infrastructure even if the role doesn't.

---

## 27. User preferences in the scoring system prompt

**Decision.** `scoreJobs` accepts a `ScoringPreferences` object — seniority / job types / locations sourced from `Settings.default*`. They're rendered into the system block as an explicit *"USER PREFERENCES (from Settings)"* section with instructions to penalize contradictions and reward fits. The system block is still ephemeral-cached, so the prefs ride along on the same cache hit.

**Why.** The CV says what the candidate *can* do; Settings says what they *want* right now (e.g. *"open to senior or lead, not internships; Berlin or remote only"*). Without preferences in the prompt, the model would score a Junior contract role in Hamburg the same regardless of whether the user has explicitly excluded all three traits in Settings.

**Why penalize contradictions instead of hard-filtering.** A pre-score filter already drops jobs that contradict narrowed seniority / job types (see #28). The prompt-level signal handles softer cases — e.g. a job whose location is mid-tier preferred — without binary cutoffs.

---

## 28. Pre-score personalization filter

**Decision.** In `POST /api/jobs/refresh`, after dedupe but before scoring, drop fresh jobs whose `seniority` / `jobType` contradict `Settings.defaultSeniority` / `defaultJobTypes`. The defensive narrow rule applies: filter only when subset selected, `UNKNOWN` always passes.

**Why.** Scoring tokens cost money. If the user has explicitly excluded a category in Settings, paying Haiku to score those jobs is waste. Filtering before scoring keeps the API bill aligned with the user's intent.

**Why `UNKNOWN` still passes.** Same reason as the board's `GET /api/jobs` filter (decision #15): the regex-based classifier misses real listings, and a misclassified-as-UNKNOWN senior role shouldn't be silently dropped.

---

## 29. Date posted filter — single-select with fetchedAt fallback

**Decision.** `DATE_POSTED_OPTIONS` in `src/lib/constants.ts` is single-select (`Any / 24h / 1w / 2w / 1m`). The `GET /api/jobs` cutoff is `publishedAt >= cutoff OR (publishedAt IS NULL AND fetchedAt >= cutoff)`.

**Why single-select.** "Past 24 hours" is a strict subset of "past week" — multi-select would create nonsense states (Past 24h *and* Past week selected together).

**Why the `fetchedAt` fallback.** Aggregator sources (especially JSearch) often leave `publishedAt` null. A naive `publishedAt >= cutoff` would silently filter out genuinely-fresh listings just because the source didn't fill the field. Falling back to `fetchedAt` preserves the user's mental model of "show me what's been on the board recently".

---

## 30. Clear List semantics split by tab

> **Superseded (2026-06-14, see #47).** Clear List is now a uniform non-destructive soft clear with the same confirmation on every status tab; the Applied bulk-unapply branch was removed.

**Decision.** `Clear List` on the Inbox and Starred tabs is a non-destructive view-only clear (no API call, no DB write — just `setJobs([])`). On the Applied tab, it opens a confirmation dialog and bulk-unapplies every visible job back to Inbox (`POST /api/jobs/bulk { action: "unapply", ids }`).

**Why split.** On Inbox / Starred, "clear from view" is a triage gesture — the user wants a fresh page to scroll. Persistent removal there would surprise (and the per-card *"Don't Show Again"* already covers permanent deletion). On Applied, "clear" without an undo would lose application history; bulk-unapply is reversible (the jobs go back to Inbox where the user can Apply again).

**Why a confirmation only on Applied.** It's the only branch with a DB write. Non-destructive Clear List doesn't need it.

---

## 31. `unapply` as a first-class action (not the inverse of `apply` via PATCH timing)

**Decision.** `JobAction` and the bulk endpoint both gain `"unapply"` explicitly: `status = NEW, appliedAt = null`. The bulk variant is guarded by `where: { status: "APPLIED" }` so a stale or malicious bulk call can't reset arbitrary rows.

**Why a separate action.** The board's per-card *"Back to Inbox"* button needs a way to move a job from Applied → New that's distinct from `unstar` (which assumes the prior state was `STARRED`). Conflating them at the API would force the client to inspect the row's current state before deciding which action to PATCH.

---

## 32. Renaming the "New" tab to "Inbox" without touching the enum

**Decision.** The default tab label is **Inbox** and the URL query key is `?tab=inbox`. The Prisma `JobStatus.NEW` enum is unchanged. `TAB_STATUSES.inbox = "NEW"` (in `src/lib/constants.ts`) is the only bridge.

**Why.** The internal enum value is correct ("a job that hasn't been acted on yet"). The UI label was misleading because the tab also receives jobs returned from Starred / Applied via `unstar` / `unapply` — those aren't new. "Inbox" matches the existing `Inbox` icon and the standard triage-queue UX pattern (Gmail / Linear / Things).

**Why not rename the enum too.** Migrating a Postgres enum value requires writing every row, generating a new client, and rewriting every `status: "NEW"` literal — for a label change that the user sees but the database doesn't care about. Decoupling tab id from status keeps the enum stable and the UI agile.

---

## 33. PDF / DOCX text sanitization for C0 control bytes

**Decision.** `sanitize()` in `src/lib/cv-parser.ts` strips `\x00-\x08`, `\x0B`, `\x0C`, `\x0E-\x1F` from extracted text before persisting. Tab / newline / carriage return are kept.

**Why.** `unpdf` occasionally emits embedded null bytes (`\x00`) when a PDF contains binary content (image dictionaries, font tables, encrypted streams). Postgres `text` columns reject those: `invalid byte sequence for encoding "UTF8": 0x00`. The fix is a narrow strip at extraction time — broad enough to cover real-world PDFs, narrow enough to leave legitimate whitespace alone.

**Why not strip in the Prisma layer.** The bytes need to be gone before the text hits Claude too (Anthropic accepts them, but they're noise that wastes tokens).

---

## 34. Favicon as `app/icon.svg`, not a generated `.ico`

**Decision.** The favicon lives at `src/app/icon.svg` (Next.js `app/icon` convention) — an SVG that redraws the header logo: ink rounded square (`#1A1233`), paper Fraunces "J" (`#F5F1E8`), chartreuse dot (`#DCCE40`). The scaffold `favicon.ico` was deleted.

**Why SVG over `.ico`.** One vector file scales to every tab/bookmark size, stays crisp on hi-DPI, and is editable in-repo without an image toolchain. Next.js auto-emits the `<link rel="icon" type="image/svg+xml">` tag.

**Why the accent dot sits *inside* the corner (cx=25, cy=7) instead of overflowing like the DOM logo.** The header logo uses negative offsets so the dot pokes past the square — fine in the DOM. In a fixed favicon canvas that overflow gets clipped, so the dot is nudged inside the bounds. The background-colored ring from the DOM version is dropped: at 16–32px it's invisible and only adds SVG weight. Don't "fix" these to match the DOM logo pixel-for-pixel — they're deliberate adaptations to the favicon canvas.

---

## 35. Token economy: meter cost, never block (debt instead of a hard cap)

> **Partially superseded (2026-05-25).** Tokens are now **purchasable via Stripe** (sandbox/test) on `/plans`, and two **balance gates** were added (`src/lib/limits.ts`): CV parse refuses below 25 tokens, Research refuses at 0 (402), plus admin rate limits (429). So usage *can* now be blocked — a deliberate reversal of "never block" for those two actions. `charge()` itself is unchanged (floors at 0, accrues `tokenDebt`); the gates run *before* it. Stripe is sandbox-only — no live billing.

**Decision.** `src/lib/tokens.ts` charges for AI actions (CV parse 25; research 0.5/job displayed + 1/job rated) against a 300-token signup grant. `charge()` floors the balance at 0 and records any overspend as `tokenDebt` — the run **always proceeds**. Balances are `Float` because charges move in 0.5 increments. Charging happens *after* the work succeeds, and every charge writes one `TokenLedger` row.

**Why meter at all.** AI calls cost real money (Sonnet per upload, Haiku per job × every refresh). Surfacing that as a visible balance makes the cost legible to the user instead of hiding it in an invoice — see decision #3 (the reason there are two models is the same: cost).

**Why debt instead of a hard cutoff.** Blocking a refresh mid-flow because the balance dipped below the run's cost would be a worse experience than letting it finish and going slightly negative-on-paper. Debt keeps the UI honest (the balance pill never shows a negative number) while still recording the overspend. There is no payment provider or top-up flow — this is an internal accounting of usage, not a paywall. Adding a real paywall would gate on `balance >= cost` *before* the run; that's a deliberate future change, not the current behaviour.

**Why charge after success.** A source outage or a Claude error shouldn't cost the user tokens. Billing is the last step of `POST /api/jobs/refresh` and `POST /api/cv`, so a thrown error skips it. A repeats-only refresh (nothing new to rate) still bills the 0.5/job re-display but skips scoring.

**Why `Float`, not `Int` or cents.** The smallest charge is 0.5 (per-job display). Using an integer "half-token" unit would make every price and every display site do ×2/÷2 conversions; a `Float` with 0.5 increments is simpler and the magnitudes are tiny (no rounding-drift concern at this scale). `formatTokens()` renders integers cleanly and everything else to one decimal.

---

## 36. Lazy signup grant via `getTokenAccount`

**Decision.** The 300-token signup grant isn't written at registration time by a dedicated step. Instead `getTokenAccount(userId)` applies it on first access if `tokensGrantedAt` is null, using an atomic `updateMany({ where: { id, tokensGrantedAt: null } })` claim so concurrent callers can't double-grant.

**Why lazy.** Two entry points create users — the Auth.js `createUser` event (first Google sign-in) and `POST /api/register` (email/password). Putting the grant in a single lazily-invoked accessor means both paths get it for free, and — crucially — **accounts that existed before billing was added** still receive their 300 the first time anything reads their balance. No backfill migration was needed.

**Why the atomic claim.** `getTokenAccount` is called from `charge`, the header pill, the account page, and both sign-up paths. Without the `tokensGrantedAt: null` guard in the `updateMany`, two near-simultaneous first reads could each grant 150. The guard makes the grant idempotent: only the first writer flips the timestamp and increments the balance.

---

## 37. Legacy data claimed by the first account

**Decision.** `userId` is nullable on `Profile` / `Settings` / `Job` / `SourceCredential`. `claimOrphanDataForFirstUser` (`src/lib/claim.ts`) adopts all `userId = null` rows for the first account, guarded by `userCount === 1`; it runs from the Auth.js `createUser` event and from `POST /api/register`.

**Why nullable rather than a data migration that invents an owner.** When multi-tenancy landed there were already real rows (the owner's CV, settings, jobs) with no user to attribute them to. Making `userId` nullable let the migration run without fabricating a `User`; the first human to actually sign in inherits them. After that, the column is effectively non-null for all new rows.

**Why guard on `userCount === 1`.** The claim must only ever fire for the *very first* account — otherwise the second person to register would sweep up the first person's data. Counting users and bailing when it's not exactly 1 makes the claim a strict one-shot. On a fresh database with no orphan rows it's a harmless no-op.

---

## 38. Empty `Job.requiredLanguages` means English suffices

**Decision.** The scorer emits `requiredLanguages: string[]` ⊆ `["de", "en"]` per job, populating only the languages the JD *explicitly* requires (German triggers like "Deutschkenntnisse erforderlich", "fließend Deutsch", "C1/C2 Deutsch"; English triggers like "English required"). When neither is stated, the array stays empty. The board's "English" Language filter then accepts any job *without* `"de"` — empty arrays included — so jobs that simply don't mention a language requirement count as English-OK.

**Why.** In the Berlin/EU tech market, English is the implicit default; most postings that work for English speakers never mention it explicitly. Treating "unstated" as "English-required" matches the on-the-ground convention and prevents the filter from silently hiding legitimate matches behind silence. The alternative — defaulting to "requires both" or "unknown, exclude" — would zero out the English bucket for most aggregator listings.

**Trade-off.** A small number of German-only postings that *fail* to declare the requirement leak into the English bucket. The system-prompt's "penalize unmet languages" instruction softens this on the *score* side — even when a leaky JD slips through the filter, it gets a lower score and sinks down the inbox.

**Where it lives.** Filter math in `src/app/api/jobs/route.ts` (search for `languages.includes("de")`); scorer instructions in `src/lib/matcher.ts` (system-prompt language paragraph) + `src/lib/ai/{claude,gemini}.ts` (`requiredLanguages` field description).

---

## 39. 300-char description snippet at scoring time

**Decision.** `JobToScore.description?: string` carries the first 300 characters of each JD into the scoring batch's user prompt. Previously the model only saw title + company + location.

**Why.** Language requirements ("Deutschkenntnisse erforderlich"), specific tools, and seniority hints all live in the description, not the title. Without the snippet, the new `requiredLanguages` output (DECISIONS #38) would be a guess — and `missingSkills`/score quality would stay capped at "what can be inferred from the title alone".

**Cost.** Adds roughly 50 tokens per job to the input side of scoring — a ~2–3× bump on a previously tiny prompt (was ~30 tokens/job; now ~80). Negligible against `PER_JOB_RATING = 1` token charged to the user, and the system prompt is still cached on the Claude path so the CV doesn't re-bill across batches.

**Why 300 chars, not the full description.** "Deutschkenntnisse"-style flags and the first sentence of the role pitch almost always land in the JD's opening — 300 chars is enough signal without billing for the full text. Tunable: bump the slice in `src/lib/matcher.ts` if the cost/accuracy trade-off shifts.

---

## 40. `<NumberInput>` wraps the controlled-number pattern

**Decision.** Every admin/Settings numeric input goes through `src/components/ui/number-input.tsx`, not a raw `<Input type="number" value={number} onChange={(e) => set(Number(e.target.value))}>`. The wrapper keeps an internal string buffer, commits a parsed number to `onValueChange` while typing, and on blur snaps blank → `fallback` then clamps to `[min, max]`.

**Why.** The "obvious" controlled-number pattern is a usability trap: `Number("")` coerces to `0`, so when the user backspaces past every digit the field snaps back to "0" and they can't delete that leading zero to type a new number from scratch. The string buffer lets the input legitimately hold `""` mid-edit; parent state only sees a real number.

**Why a wrapper, not inline state at each site.** Plans, rate limits, budget alerts, and SMTP port all needed the same fix — duplicating the buffer + clamp + blur logic at each site would have made each form harder to read. One wrapper, used at every site (`plans-manager.tsx`, `rate-limit-settings.tsx`, `budget-settings.tsx`, `email-settings.tsx`).

**Pattern note.** Uses the render-time `setState` idiom (`if (value !== lastValue) { setLastValue(value); ... }`) to re-seed the buffer when the parent value changes out from under it, not `useEffect` — that's the React 19 recommended pattern for syncing state to changing props.

---

## 41. Auth illustration is inlined client-side, not served via `<img>`

**Decision.** `src/components/auth/auth-illustration.tsx` renders the brand SVG as `<img src="/auth-illustration.svg">` for instant first paint, then `fetch()`s the same URL and swaps to an inline SVG via `dangerouslySetInnerHTML`. After the swap, refs resolve into the `Open Eye` and `Close Eye` groups; effects drive a blink loop (random 6–10 s gap, 200 ms close), cursor tracking (window-level `mousemove` → translate, capped at 20 × 28 px around the eye's own resting center, rAF-throttled), and a click handler that triggers an immediate blink.

**Why inlining is required.** When an SVG is loaded via `<img>`, the browser isolates its DOM — page JavaScript can't reach the named groups, so the blink/tracking/click interactions can't run. Inlining via `dangerouslySetInnerHTML` puts the SVG into the document DOM where refs and event handlers work.

**Why also rendering it as `<img>` first.** The asset is 285 KB. An empty placeholder during the fetch would create a noticeable hole on first paint. Rendering `<img>` first lets the CSS-only micro-animations inside the SVG's own `<style>` block start playing immediately; the fetch then hits browser cache (same URL the `<img>` already pulled), so the swap to inline is near-instant and visually identical. Interactivity unlocks the moment `markup` arrives in state.

**Why animations live inside the SVG, not in `globals.css`.** They need to work in both `<img>` and inline modes. CSS inside the SVG's `<style id="auth-illustration-anim">` block applies in both. The block also sets `[id="Close Eye"]{visibility:hidden}` so the closed state never flashes before JS hydrates. A `@media (prefers-reduced-motion: reduce)` selector inside that block disables both the bob keyframe and the cursor-tracking transition, in lockstep with the page-level reduced-motion guard.

---

## 42. `svgo.config.mjs` disables `cleanupIds`

**Decision.** The project root carries an `svgo.config.mjs` that picks up automatically when `npx svgo` is run anywhere in the repo. It sets `cleanupIds: { remove: false, minify: false }` so SVG `id="…"` attributes are preserved verbatim — including Figma layer names with embedded spaces (`"10519287 9"`) and the `Hi-A`..`Hi-E` brand group names.

**Why preserve them.** Both the in-SVG CSS animations and the JS interactivity in `auth-illustration.tsx` target groups by ID. The default svgo behaviour would strip "unused" IDs (no `url(#…)` reference inside the SVG itself) and minify the rest to `a`, `b`, `c` — which would break every selector in the `<style>` block and every `querySelector` in the component on first optimization run.

**Trade-off.** The optimized SVG is ~50 KB larger than it would be with full ID cleanup (285 KB vs ~235 KB estimated). For an above-the-fold auth asset that gzips to ~80 KB on the wire, that's an acceptable price for keeping the IDs the rest of the app depends on.

---

## 43. `AbortController` cancels stale filter fetches on the board

**Decision.** `fetchJobs(signal?: AbortSignal)` in `src/components/job-board.tsx` takes an optional `AbortSignal` and passes it to the underlying `fetch()`. The `useEffect` that triggers fetches creates an `AbortController` per run and aborts on cleanup. When filters or tab change, the previous in-flight request is cancelled before the next one starts; `AbortError` is silently caught.

**Why.** Filter widgets — especially the Match-score slider — fire many `onValueChange` events per drag. Without cancellation, multiple in-flight requests can resolve out of order: a slow earlier fetch (e.g., for `minScore=30`) can arrive *after* a fast later fetch (e.g., for `minScore=90`) and overwrite the visible results. Visible symptom: "Match filter sometimes doesn't work" — slider shows 90, board shows jobs from 30+. Cancellation makes this race impossible because the older request never produces a `setJobs` call.

**Side benefit.** Every other multi-select filter (Location, Seniority, Job type, Language, Date posted) shared the same race. One fix wired into the shared `fetchJobs` resolves all of them at once.

---

## 44. Contact form is logged-in-only with mailto reply

**Decision.** `/contact` requires authentication; we don't expose a public form. Messages persist to a new `ContactMessage` table AND fire an email notification to the admin (`sendContactNotification`). Admin replies happen in the admin's own email client via a `mailto:` link — we don't ship a threaded reply UI.

**Why logged-in only.** Identity + email come from the session, so the form has no fields a spam bot can poison. We get the user's display name and account email "for free" and the rate limit (5/day per user via `checkContactMessage`) is enforced against a real userId, not a fragile IP/cookie. A public form would need Cloudflare Turnstile / hCaptcha + IP rate-limiting, and an extra "we never reply to spam" UX layer we don't yet have the volume to justify.

**Why persist AND email.** Email-only would risk missed messages if the admin doesn't read their inbox in time; DB-only would miss the real-time ping. Doing both gets a real-time alert AND a paper trail at `/admin/messages`, with the email able to fail without losing the message (the row is created first; the email is best-effort). Subject is prefixed `[Matchwerk · <Category>]` so the admin can client-side filter in their email client.

**Why mailto: instead of an in-app reply UI.** A reply UI would need a rich-text editor, HTML email templating, threading, and a "reply was sent" confirmation channel — significant scope creep. Reply via the admin's own email client uses tools they already know, threads naturally in the user's inbox (the user sees a normal reply from a real address, not a no-reply system), and the click-to-mailto also marks the message replied as a side-effect so the inbox status reflects intent without an extra click. A future v2 with a real ticketing system can replace this.

**Snapshot identity at submit time.** `ContactMessage.name` and `.email` are stored on the row (not just looked up via the FK) so the admin inbox stays accurate even if the user later renames or deletes their account. The FK cascades on user delete; the snapshot is what stays in the email notification regardless.

**Destination via AppSetting, not env-only.** `AppSetting("contact_to")` is read first, with env `CONTACT_TO` as a fallback. Same pattern as the AI keys — admin can edit it in `/admin/system` without a redeploy.

**Delete carries an audit trail.** `DELETE /api/admin/messages/[id]` writes `contact_message_delete` to `AdminAuditLog` capturing the sender's email, the subject, and the last-known status. The body itself is unrecoverable after delete, but the metadata survives.

---

## 45. Stripe Embedded Checkout, not Hosted redirect

**Decision.** The Stripe integration on `/plans` → `/checkout/[planId]` uses **Stripe Embedded Checkout** (`ui_mode: "embedded_page"`) — the form is mounted inside our own `/checkout/[planId]` page via `<EmbeddedCheckoutProvider>` from `@stripe/react-stripe-js`. The user never leaves `matchwerk.app`. Stripe still manages the actual payment form (PCI, fraud, payment methods, 3DS); we own the surrounding page.

**Why not Stripe Hosted Checkout (the previous redirect).** The hosted page renders Stripe's typography and layout for the entire merchant info panel. The only ways to influence it were richer `product_data` (a single name + description string) and Dashboard branding (logo + accent color) — both nibbled at the edges. Neither gave us editorial design control. For a brand-anchored product (the Atelier voice — Fraunces, Paper, Ink, chartreuse accent, italic taglines), hosted redirect read as "startup-y with a Stripe page tacked on the end." Embedded fixes that without touching the safety net.

**Why not fully-custom Stripe Elements / Payment Element.** Elements would mean we own every input (Card Element, Address Element, etc.) and the corresponding validation + state machine. Significantly more code, ongoing PCI considerations even with Stripe Elements, and we'd lose Stripe's own optimizations (Link one-click, Apple Pay button placement, regional method ordering). Embedded Checkout is the right point on the customization vs effort curve — full layout control on our side of the line, zero new responsibilities on Stripe's side.

**Why no `payment_method_types`.** For Checkout Sessions (unlike PaymentIntents), omitting the list tells Stripe to present whichever methods are enabled in our Stripe Dashboard. By default that includes Cards + Link + Apple Pay + Google Pay (no Dashboard changes required). EU methods (SEPA, Klarna, Sofort, iDEAL, Bancontact) are a Dashboard toggle. This lets us turn on local methods later without a code change.

**Why `customer_email` + `locale: "auto"` + `billing_address_collection: "auto"`.** Three small lines that visibly upgrade the right side: the email is prefilled from the session user (one less keystroke), the locale auto-detects DE / EN from the browser (German users see German UI), and the billing address only collects when the user's country requires it for tax / regulation (the form stays lean for most users).

**API version note.** Stripe SDK v22 targets API `2026-04-22.dahlia` by default. In that version Stripe renamed `ui_mode` values: `embedded` → `embedded_page`, `hosted` → `hosted_page`. Most of Stripe's public docs still show the old names (they document a mix of API versions); the SDK type union is the authoritative reference. Code uses the new names.

**Theming.** The embed iframe is always white internally (Stripe Embedded doesn't ship a dark theme — see Stripe docs). The merchant panel and card chrome are fully theme-aware (Atelier `bg-secondary` / `bg-card` + `bg-accent` for the top strip — the accent flips chartreuse ↔ lavender per theme). The **inner padding area around the iframe is pinned to `bg-white` in both modes** so the iframe and its padding read as one continuous white surface; otherwise dark-mode users would see a dark ring around a white iframe.

**Same idempotency contract.** The webhook + `/api/checkout/confirm` flow is unchanged — both still call `creditCheckoutSession` keyed on the unique `TokenLedger.stripeSessionId`. Embedded vs hosted is purely a rendering choice; the credit / refund machinery is identical.

**Required env.** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (a `pk_test_…` or `pk_live_…`) must be set client-side so `loadStripe()` can initialize the SDK. Without it the embed renders a clear inline error instead of silently failing. The server-side `STRIPE_SECRET_KEY` (already required for hosted mode) still applies.

## 46. Six-stage application pipeline + Pipeline table view

**Decision.** The board is a six-stage pipeline — `NEW`/`STARRED`/`APPLIED`/`INTERVIEWING`/`OFFER`/`ARCHIVED` (plus `DELETED` for "Don't Show Again"). Interviewing jobs carry a color-coded `interviewStage` (Recruiter Screen → Waiting for Decision); Archived jobs carry an `archiveReason` (Rejected/Withdrawn/Closed). A separate **Pipeline** tab renders Applied/Interviewing/Offer/Archived as a spreadsheet (`pipeline-table.tsx`) with inline auto-saving notes (`Job.note`) and a styled `.xlsx` export.

**Why permissive server-side transitions.** `PATCH /api/jobs/[id]` records whatever target stage it's sent rather than enforcing a legal-transition graph. The card UI only ever *offers* the legal moves per stage, so the constraint lives in one place (the UI). The server still guards the two correctness-critical rules: `archive` requires a reason (400), and `setInterviewStage`/`setArchiveReason` 409 if the job isn't in that stage. Keeping the server permissive avoids duplicating the transition table and matches the pre-existing pattern.

**Why "View Job Details" stopped applying.** The old primary button both opened the listing *and* set `status = APPLIED`. That conflated "I looked at this" with "I applied" and made it impossible to read a JD without polluting the Applied tab. The link is now inert re: stage; applying is an explicit `Update Status` choice.

**Why a sub-stage/outcome instead of more top-level statuses.** Interview steps (recruiter screen, technical, panel…) and archive reasons (rejected/withdrawn/closed) are *attributes of* a stage, not stages themselves — modelling each as its own `JobStatus` would explode the enum and the tab bar. A nullable `interviewStage`/`archiveReason` keeps the pipeline to six visible stages while still capturing the detail, and clearing them on stage-exit avoids stale data.

**Why XLSX (exceljs), server-side.** CSV can't carry the table's structure/colors. `exceljs` produces a real workbook (column widths, frozen header, autofilter, per-cell fills/borders/hyperlinks). It runs in the route handler (in `serverExternalPackages`) so the ~MB library never reaches the client bundle, and the export re-queries the DB so it always reflects the latest auto-saved notes. The Status/Stage cell colors are the on-screen badge tints flattened onto white (the table sits on `bg-card` = white in light mode) so the sheet matches the UI.

**Why `tab=pipeline` ignores filters.** The Pipeline is an application tracker, not a discovery surface — every job you're actively pursuing should appear regardless of how it scored or which location/seniority chips happen to be set. It's a deliberate early return in `/api/jobs` that skips the narrowing filters and the `minScore` floor (which would otherwise drop unscored rows).

---

## 47. Clear List is a uniform soft clear across all status tabs

**Decision.** `Clear List` now behaves identically on every status tab (Inbox / Starred / Applied / Interviewing / Offer / Archived): it opens the **same confirmation dialog**, then soft-clears the visible rows — their IDs go into the `localStorage` set `mw:clearedJobIds` and are filtered out of subsequent fetches until the next Research. No DB write; nothing is moved or deleted. The Applied-only bulk-unapply branch (DECISIONS #30) and its separate dialog/handler were removed. The Pipeline tab has no Clear List and ignores the cleared set, so the tracker always shows the full pipeline.

**Why.** The split behavior (view-only on Inbox/Starred, destructive-ish bulk-unapply on Applied) surprised users: the same button did two very different things, and on the new Interviewing/Offer/Archived tabs the old code fell through to a soft clear with no confirmation. One predictable gesture — "hide these from view until I research again" — is easier to reason about and reversible everywhere (Research brings them back). The per-card *"Don't Show Again"* still covers permanent hiding; `Update Status` covers stage changes.

**Note.** `POST /api/jobs/bulk { action: "unapply" }` is left in place (still a valid endpoint) but is no longer called by the UI.

## 48. "New" badge tracked by returned IDs, not a timestamp

**Decision.** Freshly discovered jobs get a blue *New* badge on the board. `/api/jobs/refresh` returns **`newJobIds`** — the IDs of the rows it just inserted, resolved after `createMany` by a lookup on the run's dedupe hashes + `status: NEW` (which is exactly the new rows, since repeats were filtered by hash earlier in the run). The client stores that set in `localStorage` (`mw:newJobIds`, hydrated after mount to avoid a hydration mismatch) and **replaces** it on every Research run, so older flags clear and only the latest finds light up; an empty run clears all flags.

**Why not a `fetchedAt > lastSeen` timestamp.** A time-based rule has to compare a client-captured boundary against a server-set `fetchedAt`, which is fragile under clock skew and on repeats-only runs. `createMany` with `skipDuplicates` doesn't return IDs, so the route does an explicit follow-up `findMany` — cheap, and fully deterministic. The badge is intentionally **persistent** (survives reloads/tab switches) and only resets on the next Research, matching "show me what's new since I last researched."

## 49. Clear List acts on the whole tab + opt-in permanent delete

**Decision.** Clear List (DECISIONS #47) gained two capabilities, both in the one confirmation dialog:

1. **Whole-tab scope.** It now clears *every* job in the tab, not just the loaded page. The inbox listing is capped at `TOKEN.MAX_BOARD_JOBS` (70), so previously a user with more jobs had to clear repeatedly. On dialog-open the board fetches the full filtered ID set via `GET /api/jobs?…&idsOnly=1` (same `where`/filters, `select: { id: true }`, **no `take`**), and the dialog reports the true total ("Clear all N jobs in this tab?").
2. **Opt-in permanent delete.** A **"Permanently delete jobs"** checkbox (default off) switches the action from the soft clear to a hard delete: the full ID set is sent to `POST /api/jobs/bulk { action: "purge" }` (chunked 500/call to respect the endpoint cap), which runs `prisma.job.deleteMany` scoped to the caller. Unchecked behavior is unchanged (soft `localStorage` clear).

**Why the soft clear stays the default.** The reversible "hide until next Research" gesture is the common case and the safe one. Permanent delete is destructive, so it's an explicit opt-in with helper text and a destructive-styled confirm button.

**Consequence — a purged job can reappear.** `purge` removes the row entirely, unlike the soft `DELETED` status (which the refresh treats as a known repeat and keeps excluded forever, see `jobs/refresh/route.ts`). With no row left to match on `dedupeHash` / `(source, externalId)`, a still-live listing is seen as *fresh* on a later Research — re-scored, re-billed, re-shown. This was a deliberate, user-confirmed choice: "permanent" means "erased from your DB now", not "suppressed forever" (that's what the soft clear / *Don't Show Again* `DELETED` path is for).

**Filter-consistency.** Both paths reuse the board's active filters via the shared `buildJobsParams()` helper, so Clear List sweeps exactly the set the user is currently viewing across all batches — not the unfiltered tab.

---

## 50. Research is hard-capped at 2.5 minutes, client-orchestrated, priority-preserving

**Decision.** A single Research action is bounded by an overall **`RESEARCH_BUDGET_MS` = 150s** ceiling enforced in the board (`job-board.tsx`), not just by the per-request server budget. The client runs an auto-continue loop (DECISIONS #51); before each pass it computes the remaining overall budget and sends it as `budgetMs`, and the server scores for `min(budgetMs, REFRESH_BUDGET_MS)`. When the budget runs out before everything is scored, the run stops and the user sees "More jobs remain; run again to finish."

**Why this still returns the best jobs.** Scoring batches are fed in pre-rank order, which already encodes source priority (`prerank.ts` + `priority.ts`: JSearch/LinkedIn-origin → Fantastic → BA → Adzuna → Jooble) and lexical relevance. So a budget-trimmed run scores the highest-priority/best-matching candidates first; the remainder is picked up on the next Research. The per-pass `REFRESH_BUDGET_MS` (default 45s) must stay under the platform function cap so each pass returns/persists/bills before the cap kills it (`240000` on Pro/Fluid, `50000` on Hobby — see DEPLOYMENT.md). Latency was explicitly de-prioritized by the owner in favor of a predictable ceiling.

## 51. Auto-continue completes a run; continuation passes don't re-bill repeats

**Decision.** One Research click keeps calling `/api/jobs/refresh` while the response reports `pendingMore` (the per-pass scoring deadline left fresh jobs unscored — **not** the intended `MAX_SCORE_CANDIDATES` truncation, which never triggers continuation). The loop stops on completion, the 2.5-min ceiling (#50), a no-progress pass, or a 6-pass cap. Passes after the first send `{ continuation: true }`, and the server then bills only newly-rated jobs' display+rating, **skipping the re-display charge for repeats** (already billed on pass 1).

**Why.** Before this, a deadline-trimmed run scored only part of the set and the surfaced count grew run-over-run (the "38 then 70" report). Auto-continue makes one click score the whole set (or as much as 2.5 min allows), and the cost-neutral continuation keeps an N-pass run priced like a single complete run — honoring "complete every run" without a cost blow-up. `pendingMore` deliberately excludes cap-overflow so the loop never expands coverage/cost beyond the design.

## 52. One shared normalizer + company-only blocking + cross-tab fuzzy dedup

**Decision.** All cross-source duplicate detection routes through `src/lib/sources/normalize.ts` — the exact `dedupeHash`, the fuzzy `isLikelySameJob`, and the blocking keys share the same company/city/title normalization (legal-suffix strip, umlaut fold → digraphs, postal-code/country/region strip, `&`→`and`, German↔English city aliases). `isLikelySameJob` blocks by **normalized company only** (not company+city) and treats **Remote/empty location as compatible with any city**, keeping the balanced guard (same employer + matching seniority words + ≥70% title-word overlap). The refresh fuzzy filter now runs against **every existing row in any status/tab** (Inbox/pipeline/DELETED), not just starred/applied.

**Why.** `dedupe.ts` and `similarity.ts` previously normalized differently (only the matcher stripped legal suffixes), so near-duplicates slipped past whichever stage was weaker; the strict company+city block meant most cross-source variants ("Zalando SE"/"Zalando", "Berlin"/"10115 Berlin"/"Remote", "München"/"Munich") never even got compared; and the fuzzy filter ignored existing `NEW` rows, so the same job from a second source on a later refresh became a second card. Unifying normalization, loosening the block, and comparing against all tabs fixes the common duplicate. **Consequence:** the hash inputs changed, so historical `Job.dedupeHash` values won't match new ones — the `(source, externalId)` repeat check and the cross-tab fuzzy filter absorb the one-time transition (a few old rows may re-score once; no duplicate wave).

## 53. Platform config caches use a 30s TTL (not lifetime) + fresh admin reads

**Decision.** `src/lib/platform.ts`'s per-process `settingCache`/`credCache` carry a **30s TTL** and a `{ fresh: true }` bypass. `getAiConfig`/`getProviderStatuses` thread `fresh` through; the admin AI dashboard GET (`/api/admin/system/ai`) reads fresh so it's always authoritative.

**Why.** The app runs as many concurrent serverless instances, each with its own cache. A lifetime cache invalidated "on write" only updated the instance that served the write — every other instance kept its stale snapshot forever. Symptom: the admin "Active provider" appeared to flip (e.g. Gemini ↔ Groq) on refresh as the load balancer hit different instances, and — more seriously — scoring/CV-parsing could run on different providers per instance. The TTL converges the whole fleet within 30s; the fresh admin read removes the flip in the dashboard immediately. This is correct eventual consistency for a read-mostly config without adding pub/sub or a shared cache layer. Applies to all cached config (AI providers, source keys, `sources_disabled`, rate limits, budget alerts).
