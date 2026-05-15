# Technical Decisions

A record of *why* each non-obvious choice in the codebase exists. New contributors: read this before suggesting "shouldn't we just ____?" — usually the alternative was considered and there's a reason it's not here. Where the rationale is not derivable from the code or repository memory, that's flagged explicitly.

---

## 1. Single-user, no authentication

**Decision.** `Profile` and `Settings` are Prisma singletons with `id = "singleton"`. There is no users table, no sessions, no auth provider.

**Why.** The project is the owner's personal job-search tool — one human, one machine. Building multi-tenant scaffolding would more than double the surface area for zero value.

**Implication.** If this ever becomes multi-user, every singleton lookup (`getProfile`, `getSettings`) and every API route's implicit "current user" needs a real foreign key. That's a deliberate rewrite, not a refactor.

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

## 9. Singleton id `"singleton"` instead of a `boolean isCurrent`

**Decision.** Profile and Settings have `id String @id @default("singleton")`. Every read site uses `findUnique({ where: { id: "singleton" } })` or `upsert({ where: { id: "singleton" }, … })`.

**Why.** It's unambiguous, it makes every accessor a constant-time lookup by primary key, and `upsert` with a known id removes any race window for "create if not exists." The downside (collision if you ever wanted two profiles) is a feature — see decision #1.

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

- **No queue / no worker.** Refresh runs inline (decision #1 implies it: one user, one request at a time — there's no concurrency to coordinate).
- **No telemetry.** Single-user; nothing to monitor.
- **No i18n.** UI is German job market, English UI text. The owner reads both fluently.
- **No SWR / React Query.** `useEffect + fetch` is sufficient for the handful of endpoints; adding a cache layer would need invalidation strategy we don't have.
- **No tests.** See `docs/TESTING.md` for the honest reasoning and a roadmap.
