# Contributing to Matchwerk

This is a small, owner-led project — now multi-tenant (Auth.js, Google + email/password), though the owner is still the primary user. Contributions are welcome but expect a high bar for additions: tight, honest code over feature breadth. Read `CLAUDE.md` before making non-trivial changes.

The repo is hosted at <https://github.com/mahdifazel/Job-hunter-list>. PRs land against `main`.

---

## Development environment

Prerequisites:

- Node.js ≥ 20, npm
- Docker (for Postgres 16)
- An Anthropic API key
- Python 3.10+ if you want to touch the JobSpy adapter (`brew install python@3.12` on macOS)

Bootstrap:

```bash
npm install
cp .env.example .env             # then edit DATABASE_URL line
# Create .env.local with ANTHROPIC_API_KEY and AUTH_SECRET (both required),
#   plus any source keys you have. AUTH_SECRET: npx auth secret
#   Google sign-in (AUTH_GOOGLE_ID/SECRET) is optional — email/password works without it.
npm run db:up
npm run db:migrate
npm run db:seed                  # no-op — Settings/Profile are created per-user on first use
npm run dev
```

Verify the dev server is healthy. API routes now require a session, so an unauthenticated request should return a JSON 401:

```bash
curl -s http://localhost:3000/api/sources   # → {"error":"Sign in to continue."} with HTTP 401
```

Sign in at `/register` (or `/login` → Google), then hit `/api/sources` from the browser — every source should appear with `connected: true | false` and `configured: true | false`.

To rebuild the JobSpy venv:

```bash
rm -rf .venv-jobspy
python3.12 -m venv .venv-jobspy
.venv-jobspy/bin/pip install python-jobspy
```

---

## Pre-flight checks (run before pushing)

There is no test suite (see `docs/TESTING.md`) and no CI. At minimum, run:

```bash
npx tsc --noEmit      # typecheck — must exit 0
npm run lint          # eslint — must exit 0
npm run build         # production build — must succeed
```

If you touched a Prisma model, run `npm run db:migrate` and commit the generated `prisma/migrations/<timestamp>_<name>/` directory.

---

## Branch naming

Convention:

- `main` — production-ready code
- `feat/<short-description>` — new features (`feat/score-history`, `feat/source-stepstone`)
- `fix/<short-description>` — bug fixes
- `chore/<short-description>` — infra, deps, docs
- `refactor/<short-description>` — non-feature internal changes

Keep branches short-lived. Squash on merge.

---

## Commit messages

Convention — [Conventional Commits](https://www.conventionalcommits.org/), as used in the existing log:

```
<type>(<optional-scope>): <imperative summary, ≤ 72 chars>

<optional body — what changed and why, wrapped at 72 chars>
```

Types used in practice:

- `feat` — user-facing capability
- `fix` — bug
- `refactor` — internal change, no behaviour delta
- `perf` — measurable performance change
- `style` — formatting only
- `docs` — docs only
- `chore` — build, deps, tooling

Examples:

```
feat(sources): wire Fantastic.jobs adapter
fix(api/settings): derive zod source enum from ALL_SOURCE_IDS
refactor(sources): drive orchestrator from tier field instead of hardcoded list
```

---

## Pull request process

1. Open the PR against `main`.
2. Title should be the same form as a commit message (a final squash commit will inherit it).
3. Description must answer: *what changed*, *why*, and *how was it verified* (manual steps if no tests).
4. If touching a route handler or DB model, include before/after `curl` examples or a Prisma Studio screenshot.
5. CI / required checks: **none currently configured**. The reviewer will run `tsc --noEmit && npm run lint && npm run build` locally.
6. Self-review the diff for anything in the "House rules" below before requesting review.

---

## House rules — code style

Strictly observed in the existing code. Match them.

### TypeScript

- **Strict mode** (`tsconfig.json` already has `"strict": true`).
- Prefer **type-only imports** (`import type { … }`) for values that are only used in type position.
- The path alias is `@/*` → `./src/*`. Use it. Don't write deep relative imports.
- Cast only at trust boundaries (e.g. Anthropic tool input → `block.input as { … }`), never to silence the compiler in business logic.
- **No `any` in route handlers or adapter code.** If something is genuinely dynamic, type it as `unknown` and narrow.

### React / Next.js

- Server components by default. Add `"use client"` *only* on files that use hooks, state, refs, or browser APIs.
- Route handlers live under `src/app/api/.../route.ts`. They export named functions per HTTP verb (`GET`, `POST`, …).
- Dynamic route handlers receive `{ params }: { params: Promise<{ … }> }` (Next.js 16 — see `src/app/api/jobs/[id]/route.ts`).
- Run external work in parallel with `Promise.all` where it doesn't introduce a race. The source adapters do this — copy the pattern.

### API design

- Every JSON-accepting route validates with **Zod** at the top of the handler. Return `{ error: string }` on failure with an appropriate 4xx/5xx status.
- Source-id enums in Zod should be derived from `ALL_SOURCE_IDS`, not duplicated as a string literal list. (Earlier versions of `/api/settings` had the literal list hardcoded and silently rejected new sources — don't reintroduce that.)
- A route that drives a Claude call must `charge()` the user (`src/lib/tokens.ts`) **after** the work succeeds — never before, so a failed run isn't billed. Have the client call `notifyTokensUpdated()` so the header balance pill refetches. Don't gate the run on balance; `charge()` floors at 0 and records overspend as debt.
- Client surfaces failures via `sonner.toast.error(data.error)`.

### Comments

- Default to **no comments**. The code names should carry the meaning.
- Add a one-line comment only when the *why* would surprise a reader (e.g. the threshold reasoning in `search.ts`, the UNKNOWN-passthrough rule in `jobs/route.ts`, the gender-marker stripping in `dedupe.ts`).
- **No** decorative banners, no "// ===…===" section markers, no rephrasing what the code already says.

### Imports

- Order: node built-ins → external packages → `@/…` → relative `./…`.
- Group with blank lines if you have all three.
- Sort within a group alphabetically (the existing code is mostly consistent on this).

### Source adapters

Adding a job source:

1. Add the enum value to `prisma/schema.prisma`:
   ```prisma
   enum JobSourceId {
     ...existing...
     NEW_SOURCE
   }
   ```
2. Create a migration: `npx prisma migrate dev --name add-<source>-source`.
3. Create the adapter at `src/lib/sources/<source>.ts` exporting a `JobSource` (see `src/lib/sources/types.ts` for the interface and any existing adapter for a template). Implement `configured()` (async) — read credentials via `getSourceCredentials("NEW_SOURCE")` from `src/lib/credentials.ts` so DB-saved keys take effect at refresh time and env vars are the fallback.
4. Register it:
   - Add to `ALL_SOURCES` in `src/lib/sources/index.ts`.
   - Add a `SOURCE_META` entry in `src/lib/constants.ts` (id, label, tier, connected, short note).
5. If the source has user-editable credentials, add an entry to `SOURCE_CREDENTIAL_SCHEMA` in `src/lib/credential-schema.ts` (field id, label, env-fallback var name, `secret: true/false`). The Settings UI will auto-render an editor for it.
6. Document the env var(s) in `.env.example`.
7. Don't hardcode the new source ID into `searchEnabledSources` or `/api/settings` — both already read from `ALL_SOURCES` / `ALL_SOURCE_IDS`.

### Database migrations

- Schema changes go through `npm run db:migrate`. **Never** `prisma db push` against the dev DB.
- Migration name format: `add-<thing>-<noun>`, kebab-case (`prisma migrate dev --name <name>`).
- Commit the entire generated migration directory.

### Secrets

- **Never** paste API keys in chat, PR descriptions, commit messages, or any tracked file.
- `.env` and `.env.local` are gitignored — keep them that way.
- If a secret leaks (in chat, in a screenshot, anywhere), regenerate the key at the provider before doing anything else.

### Design system

When touching UI:

- Use the design tokens from `src/app/globals.css` (`--primary`, `--accent`, `--muted-foreground`, etc.) — don't hardcode hex values for new components. Existing hex literals inline in JSX are *only* for the chartreuse/lavender accent ramp and the score-meter rings.
- Display headings use the `.font-display` (Fraunces) or `.display-italic` utility.
- Section eyebrows use `.eyebrow`. Inline meta with separators uses `.dot-sep`. Card hover uses `.lift-on-hover`.

---

## What we won't accept

- **Mock or fake job data.** This is a hard project rule (`CLAUDE.md` § 1).
- **Direct scraping of LinkedIn / Glassdoor / XING / Indeed / StepStone / Monster** from inside the Next.js process. Use a paid aggregator API (JSearch, Fantastic.jobs, Adzuna) or the open-source JobSpy fallback in its sandboxed venv.
- **Unscoped queries.** Every data read/write must scope by `getSessionUserId()` (API) and live behind `src/proxy.ts` (pages). An unscoped Prisma query is a cross-tenant data leak — see `CLAUDE.md` § 9 and `docs/DECISIONS.md` #1.
- **A payment provider / hard paywall** bolted on without discussion. Tokens (`src/lib/tokens.ts`) meter AI cost and accrue debt rather than blocking; turning that into a gate is a product decision, not a drive-by change.
- **PRs without a typecheck-clean diff.** No exceptions.

---

## Questions

This is a personal project. Open a GitHub issue if/when the repo is published; otherwise contact the project owner directly.
