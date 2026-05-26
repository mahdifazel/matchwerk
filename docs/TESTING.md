# Testing

> **Status: a Vitest suite now exists, scoped to the payment / token-billing flow.** See **§7** for how to run it and what it covers. The rest of the app is still verified only by typecheck + ESLint + manual smoke tests, as described below.
>
> - `package.json` has `test` (`vitest run`), `test:watch`, and `typecheck` (`tsc --noEmit`) scripts.
> - `vitest` is installed; tests live in `__tests__/` folders next to the code under test and run against a throwaway `jobhunter_test` Postgres (auto-created + migrated by `test/global-setup.ts`).
> - There is still no CI workflow (`.github/workflows/`), so nothing runs the suite automatically yet — run `npm test` locally before releasing.

This document records (a) what verification *is* possible today, (b) where the highest-value tests would go, (c) a sketch of how to bring up a fuller suite, and (d) **the implemented payment suite + the manual pre-release checkout checklist (§7)**.

---

## 1. What you can verify today

### TypeScript

```bash
npx tsc --noEmit
```

This is the only mechanical check that catches regressions. Run it before every commit. Strict mode (`tsconfig.json` already has `"strict": true`) catches:

- Missing or wrong types at boundaries.
- Misuse of the Prisma client (e.g. assigning `string[]` to a `JobSourceId[]` field).
- Unhandled `undefined` from `.find()`, `Map.get()`, etc.

### ESLint

```bash
npm run lint
```

Uses `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`. Catches React Hooks rule violations and common Next.js misuse.

### Build

```bash
npm run build
```

A successful production build verifies that:

- All routes compile.
- The Turbopack-incompatible server externals (`pg`, `@prisma/adapter-pg`, `mammoth`, `unpdf`) are declared correctly in `next.config.ts`.
- Tailwind tokens resolve.

### Manual smoke tests via `curl`

The endpoints below cover the user-visible critical paths. Run them after non-trivial changes.

**1. Source status**

```bash
curl -s http://localhost:3000/api/sources | python3 -m json.tool
```

Expected: array of 5 objects (`BA_JOBBOERSE`, `JSEARCH`, `FANTASTIC_JOBS`, `ADZUNA`, `JOBSPY`) each with `connected` and `configured` booleans.

**2. Settings round-trip**

```bash
curl -s http://localhost:3000/api/settings | python3 -m json.tool

curl -s -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  --data '{"jobTitles":["Product Designer"],"defaultLocations":["berlin"],"defaultSeniority":["SENIOR"],"defaultJobTypes":["FULL_TIME"],"defaultSources":["BA_JOBBOERSE"]}'
```

Expected: HTTP 200, returns the updated `settings` object. Invalid payload → HTTP 400 with `{ error, issues }`.

**3. Refresh (slow — 10–60 s)**

```bash
curl -s -X POST http://localhost:3000/api/jobs/refresh | python3 -m json.tool
```

Expected: `{ added, scanned, reports: [...5 entries] }`. Every source appears in `reports` with either `ran: true, count` or `ran: false, skippedReason`.

Common failure modes to watch for:

- `Invalid input value for enum "JobSourceId": "<NAME>"` — a Prisma enum migration was missed.
- A source reporting `count: 0` despite `ran: true` — the source-specific query format may have drifted.
- 500 with "ANTHROPIC_API_KEY is not set" — env not loaded.

**4. Job actions**

```bash
# Star
curl -s -X PATCH http://localhost:3000/api/jobs/<id> \
  -H "Content-Type: application/json" --data '{"action":"star"}'

# Apply
curl -s -X PATCH http://localhost:3000/api/jobs/<id> \
  -H "Content-Type: application/json" --data '{"action":"apply"}'

# Delete
curl -s -X PATCH http://localhost:3000/api/jobs/<id> \
  -H "Content-Type: application/json" --data '{"action":"delete"}'
```

**5. Sources runtime status (without keys)**

Temporarily unset a source key in `.env.local`, restart `npm run dev`, and confirm:

- `GET /api/sources` reports `configured: false` for that source.
- The corresponding toggle in `/settings` is disabled with a "Key needed" hint.
- A refresh's `reports` shows `{ ran: false, skippedReason: "API key not configured" }`.

---

## 2. Where tests would matter most

In priority order, based on what would actually catch regressions:

### 2.1 `src/lib/sources/dedupe.ts`

Highest-value unit-testable surface. Pure functions, deterministic, no I/O.

```ts
// proposed: src/lib/sources/dedupe.test.ts

import { describe, expect, it } from "vitest";
import { dedupeHash, dedupeRawJobs } from "./dedupe";

describe("dedupeHash", () => {
  it("hashes identical jobs identically", () => {
    const a = { title: "Senior PD", company: "Acme", location: "Berlin" };
    const b = { title: "senior pd", company: "ACME", location: "Berlin, DE" };
    expect(dedupeHash(a)).toBe(dedupeHash(b));
  });

  it("strips (m/w/d) gender markers", () => {
    expect(
      dedupeHash({ title: "Senior PD (m/w/d)", company: "Acme", location: "Berlin" }),
    ).toBe(
      dedupeHash({ title: "Senior PD", company: "Acme", location: "Berlin" }),
    );
  });

  it("strips bare m/w/x style markers", () => {
    expect(
      dedupeHash({ title: "Senior PD m/w/x", company: "Acme", location: "Berlin" }),
    ).toBe(
      dedupeHash({ title: "Senior PD", company: "Acme", location: "Berlin" }),
    );
  });

  it("differs on different city", () => {
    const a = { title: "Senior PD", company: "Acme", location: "Berlin" };
    const b = { title: "Senior PD", company: "Acme", location: "Munich" };
    expect(dedupeHash(a)).not.toBe(dedupeHash(b));
  });
});

describe("dedupeRawJobs", () => {
  it("keeps the first occurrence on a collision", () => {
    // ... see source for shape ...
  });
});
```

### 2.2 `src/lib/sources/similarity.ts`

The `isLikelySameJob` function decides whether a candidate is collapsed against a starred row — false positives lose listings, false negatives surface duplicates.

```ts
// proposed: src/lib/sources/similarity.test.ts

describe("isLikelySameJob", () => {
  it("matches with parenthetical suffix variant", () => {
    expect(isLikelySameJob(
      { title: "Senior Product Designer", company: "Acme", location: "Berlin" },
      { title: "Senior Product Designer - parental leave cover", company: "Acme", location: "Berlin" },
    )).toBe(true);
  });

  it("does not match across seniority words", () => {
    expect(isLikelySameJob(
      { title: "Junior Product Designer", company: "Acme", location: "Berlin" },
      { title: "Senior Product Designer", company: "Acme", location: "Berlin" },
    )).toBe(false);
  });

  it("ignores legal company suffix", () => {
    expect(isLikelySameJob(
      { title: "Product Designer", company: "Acme GmbH", location: "Berlin" },
      { title: "Product Designer", company: "Acme", location: "Berlin" },
    )).toBe(true);
  });

  it("requires same city", () => {
    expect(isLikelySameJob(
      { title: "Product Designer", company: "Acme", location: "Berlin" },
      { title: "Product Designer", company: "Acme", location: "Munich" },
    )).toBe(false);
  });
});
```

### 2.3 `src/lib/infer.ts`

Pure regex, easy to test.

```ts
describe("inferSeniority", () => {
  it.each([
    ["Senior Product Designer", "SENIOR"],
    ["Sr. UX Designer", "SENIOR"],
    ["Junior Visual Designer", "JUNIOR"],
    ["Lead Product Designer", "LEAD"],
    ["Head of Design", "LEAD"],
    ["Werkstudent UX", "JUNIOR"],
    ["Product Designer", "UNKNOWN"],
  ])("classifies %s as %s", (title, expected) => {
    expect(inferSeniority(title)).toBe(expected);
  });
});
```

### 2.4 `src/lib/sources/search.ts` — orchestrator

Test against fake `JobSource` objects. No network.

```ts
describe("searchEnabledSources", () => {
  const primary = (id, n) => fakeSource(id, "primary", () => Array(n).fill(rawJob()));
  const backup  = (id, n) => fakeSource(id, "backup",  () => Array(n).fill(rawJob()));
  const fallback= (id, n) => fakeSource(id, "fallback",() => Array(n).fill(rawJob()));

  it("skips backup when primary returns >= 10", async () => { /* … */ });
  it("runs backup when primary returns < 10", async () => { /* … */ });
  it("reports disabled-in-settings reason", async () => { /* … */ });
  it("reports adapter-not-implemented reason", async () => { /* … */ });
  it("reports API-key-not-configured reason", async () => { /* … */ });
});
```

### 2.5 Source adapter title/location builders

Test the pure helpers inside each adapter (the parts that don't hit the network):

- `buildLocationPhrases` (jsearch)
- `buildLocationFilters` (fantastic-jobs)
- `buildTsQuery` (fantastic-jobs) — *especially* this; regression here means silent zero-result refreshes
- `buildWheres` (adzuna)
- `buildTargets` (ba-jobboerse)

### 2.6 API route integration (Postgres-backed)

A small set of black-box tests that exercise the routes against a real Postgres (use `docker compose up -d` in the test setup) and reset state between cases.

The highest-leverage cases:

- `PUT /api/settings` with every valid source ID — pinch-test that the Zod enum stays in sync with the Prisma enum.
- `POST /api/jobs/refresh` end-to-end against mocked source adapters — verifies dedupe + protected-job filtering.
- `GET /api/jobs?tab=new&seniority=SENIOR` — verify the UNKNOWN-passes-when-narrowed behaviour.

### 2.7 Components — *probably skip for now*

The components are thin glue around the API. Without React Testing Library set up, individual component tests are higher-overhead than playwright-style smoke tests of the page itself. Defer until pages have non-trivial client logic.

---

## 3. Recommended tooling (if you set up a suite)

These are conservative choices that fit the existing stack. None are installed.

| Layer | Tool | Why |
|---|---|---|
| Unit / integration | **Vitest** | Native ESM + TypeScript, no Babel; faster than Jest; the ergonomic default for Next.js + Prisma projects in 2026. |
| Test DB | **`pg` + `docker compose`** or `pg-mem` | The local Postgres on :5433 is already there. Use it and run `prisma migrate deploy` before the suite, truncate between cases. |
| API mocks | **`undici` `MockAgent`** or **`msw`** | For mocking the external source APIs (BA Jobbörse, RapidAPI, Adzuna) in adapter tests. |
| E2E (later) | **Playwright** | If `/` and `/settings` grow client-side logic worth gating on. |

Suggested `package.json` script additions:

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

---

## 4. Coverage approach (when there's something to cover)

No coverage target is currently set. A reasonable starting point:

- **`src/lib/sources/dedupe.ts`** and **`src/lib/sources/similarity.ts`** — aim for ~100 %, they're small pure modules and the cost of a regression is high.
- **`src/lib/infer.ts`** — ~100 %, trivially testable.
- **`src/lib/sources/search.ts`** — exercise every `blockedReason()` branch and every tier-cutoff branch.
- **API routes** — black-box tests against a real DB; coverage instrumentation is awkward here, so use behavioural assertions instead of line coverage.
- **Adapters' network code** — *don't* mock individual `fetch` calls in unit tests. Test the builders (pure) and call the adapter end-to-end only in a tagged "integration" test suite that hits the real APIs sparingly (and is opt-in via `RUN_INTEGRATION=1`).

Avoid the trap of chasing coverage on UI components — that's where false-positive coverage lives.

---

## 5. What *not* to test

- **The Anthropic API itself.** Wrap with a thin layer, mock that layer; don't try to assert on Claude's outputs.
- **Tool-use schemas.** Trust the SDK; assert on the *behaviour* of the function that wraps it (e.g. "given a CV with no skills, parseCvProfile returns `skills: []`").
- **Prisma's behaviour.** Don't unit-test that `prisma.job.findUnique` works — test the route logic on top of it.
- **CSS / design tokens.** Visual regressions are best caught by eye or by Playwright + screenshot diff; don't try to assert on Tailwind classnames.

---

## 6. Until tests exist…

Treat every non-trivial change with:

1. `npx tsc --noEmit` → exit 0
2. `npm run lint` → exit 0
3. `npm run build` → succeeds
4. Manual smoke of any affected route via `curl` (templates in §1)
5. Manual UI walkthrough of any affected page in the browser
6. If the change touched dedupe/similarity, hand-craft 2–3 representative inputs and trace them through

This is fragile and time-consuming — which is precisely why the test suite is the highest-leverage thing to add next.

---

## 7. Payment / token-billing test suite (implemented)

The money paths are the riskiest code in the app — a double-credit, a missed refund reversal, or a mis-handled webhook hits customers directly. Those guarantees (credit-once, refund-once, signup-grant-once) are enforced by the **`@unique` constraint on `TokenLedger.stripeSessionId`**, not by in-memory math, so the suite runs against a **real Postgres**.

### Running it

```bash
npm run db:up      # Docker Postgres on :5433 (same instance as dev)
npm test           # vitest run — creates + migrates jobhunter_test on first run
npm run test:watch # interactive
```

- `.env.test` points `DATABASE_URL` at a separate `jobhunter_test` database. `test/global-setup.ts` creates it (if missing) and runs `prisma migrate deploy`, and **refuses to run unless the DB name ends in `_test`** so the suite can `TRUNCATE` freely without ever touching dev data.
- `test/helpers/db.ts` provides `resetDb()` (called in `beforeEach`), `seedUser()`, `seedPlan()`, `ledgerCount()`.
- Tests run sequentially (`fileParallelism: false`) since they share the one database.

### What it covers

| File | Layer | Focus |
|---|---|---|
| `src/lib/__tests__/tokens.test.ts` | unit (real DB) | signup grant applied once; `creditCheckoutSession` credits once + **no-op on repeat session id** + amount from the DB plan + debt paydown + unknown-plan throws; `reverseCheckoutTokens` once + overspend→debt; `charge` overspend→debt + no-op; `grant` pays debt first; `adminAdjustTokens` grant/deduct + ledger reasons |
| `src/lib/__tests__/stripe.test.ts` | unit | `getStripe()` **rejects `sk_live_…`** and a missing key, accepts `sk_test_…` (cached); `hasStripeKey()` truthiness |
| `src/app/api/checkout/__tests__/route.test.ts` | route (Stripe + auth mocked) | 401 / 503 / 400 guards; price = `round(priceEur*100)`; `metadata {userId, planId}` from the **server** plan |
| `src/app/api/checkout/confirm/__tests__/route.test.ts` | route | 401 / 404 / 403; pending when unpaid; credits once then **idempotent**; unknown plan → 400 |
| `src/app/api/stripe/webhook/__tests__/route.test.ts` | route | bad/missing signature → 400; paid completion credits + records `processed`; **redelivered event ≠ double credit**; unpaid / missing metadata → `ignored`; credit failure → 500; other event types → `ignored` |
| `src/app/api/admin/users/[id]/__tests__/refund.test.ts` | route | role guards; not-a-purchase → 400; already-refunded → 409; happy path reverses tokens once, calls `refunds.create` with the `refund:<sessionId>` idempotency key, audit-logs |

Mocking strategy: **Stripe** (`@/lib/stripe`) and **auth** (`@/lib/repo`, `@/lib/admin`) are `vi.mock`-ed so no network/session is needed; the **database is real** so the idempotency constraints are genuinely exercised. To sanity-check the suite, temporarily defeat an idempotency guard (e.g. the `if (already)` early-return in `creditCheckoutSession`) and confirm a `tokens.test.ts` case goes red.

### Manual pre-release checklist (Stripe test mode)

Automated tests mock Stripe, so do one real round-trip against the Stripe **sandbox** before shipping payment changes (needs `STRIPE_SECRET_KEY=sk_test_…` and a `whsec_…` in `.env.local`):

1. `stripe listen --forward-to localhost:3000/api/stripe/webhook` → copy the printed `whsec_…` into `.env.local`, restart `npm run dev`.
2. On `/plans`, buy a plan and pay with test card **`4242 4242 4242 4242`** (any future expiry, any CVC, any ZIP).
3. Verify the balance increases by the plan's token count **exactly once** (header pill + `/account`), **Admin → Stripe Events** shows the event `processed`, and there's a single `purchase` row in the ledger.
4. Decline card **`4000 0000 0000 0002`** → no credit. Then in **Admin → user detail**, **refund** the purchase → tokens reverse once; refunding again → 409 / "already refunded".
