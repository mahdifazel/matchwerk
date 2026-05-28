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

**Decision.** `PRIMARY_SUFFICIENT_THRESHOLD = 10`. If the primary tier returns ≥ 10 jobs, backups are skipped.

**Why.** Adzuna and JobSpy exist to plug gaps. When BA + JSearch + Fantastic.jobs already return dozens of listings, querying Adzuna adds cost (Adzuna quota / JobSpy scraping risk) for marginal extra signal — most of which would dedupe away anyway. 10 is small enough to trip when one or two primaries are misbehaving but large enough that a normal day doesn't tax the backups.

**Tradeoff.** With a CV scoped to a narrow city (e.g. "Berlin only, contract only"), 10 results from primary tier might mean you're missing valuable backup hits. If this matters in practice, lift the threshold or move Adzuna to `primary` tier.

---

## 8. Dedupe by hash, then by similarity

**Decision.** Two distinct passes:

1. `dedupeHash` (SHA-1 of `normTitle|normCompany|normCity`, with gender markers stripped) collapses cross-source duplicates and is stored as a `@unique` column so the DB is the last line of defense.
2. `isLikelySameJob` runs only against the user's *starred* and *applied* rows during refresh — title overlap ≥ 70 %, same company, same city, same seniority words.

**Why.** Hash-based dedupe is fast but exact. A listing posted as "Senior Product Designer" on LinkedIn and "Senior Product Designer — parental leave cover" on the company's career site would hash differently — and the user, having already applied to one, doesn't want the variant resurfacing two weeks later.

A full pairwise similarity sweep across all `RawJob`s would be O(n²) — running it only against the small set of starred/applied rows keeps the cost bounded.

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

## 11. JobSpy as a Python sidecar

**Decision.** JobSpy runs in a project-local Python venv (`.venv-jobspy/`) spawned via `child_process.spawn` from `src/lib/sources/jobspy.ts`. A bridge script (`scripts/jobspy_bridge.py`) reads JSON from argv, returns JSON on stdout.

**Why.** `python-jobspy` is Python-only and there's no maintained Node port. A Python sidecar is honest about the tradeoff: scraping is slow and fragile, so it's quarantined to its own process where a timeout (`setTimeout(120_000) → SIGKILL`) and silenced errors can't take down the rest of the refresh.

**Why a venv instead of a global install.** Reproducibility and to keep the Python deps off the system Python. The README documents the one-time bootstrap (`python3.12 -m venv .venv-jobspy && .venv-jobspy/bin/pip install python-jobspy`).

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

## 19. JobSpy default sites: Indeed + Glassdoor only

**Decision.** `DEFAULT_SITES = ["indeed", "glassdoor"]`. LinkedIn is left out unless the user explicitly opts in via `JOBSPY_SITES=indeed,glassdoor,linkedin`.

**Why.** LinkedIn aggressively blocks scrapers. Including it in the default site list tends to break entire JobSpy runs (the whole batch fails when LinkedIn 429s), even though the other sites would have succeeded. Indeed and Glassdoor are politer.

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

**Why the `fetchedAt` fallback.** Aggregator sources (especially JSearch and JobSpy) often leave `publishedAt` null. A naive `publishedAt >= cutoff` would silently filter out genuinely-fresh listings just because the source didn't fill the field. Falling back to `fetchedAt` preserves the user's mental model of "show me what's been on the board recently".

---

## 30. Clear List semantics split by tab

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
