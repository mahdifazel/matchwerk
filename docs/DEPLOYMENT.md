# Deployment

> **Honest summary up front: there is no deployment recipe in this repository.**
>
> Nothing in the codebase defines a staging or production environment. The repo contains:
>
> - `docker-compose.yml` — **for local development only**. It provisions Postgres on port 5433 with hardcoded credentials (`jobhunter / jobhunter`).
> - `next.config.ts` — minimal, declares `serverExternalPackages` for Prisma + parser deps. No `output: "standalone"`, no asset prefix, no custom rewrites.
> - `package.json` — has `dev`, `build`, `start` scripts but no deploy-related tasks.
>
> There is **no** `Dockerfile` for the app, **no** `vercel.json`, **no** `.github/workflows/`, **no** Kubernetes manifests, **no** Terraform, **no** Pulumi, **no** Fly.io / Render / Railway config files.
>
> This document records what's missing and a sketch of what minimum-viable deployment would look like, based on what the app actually needs at runtime. **None of the procedures below have been executed against this repository — verify before relying.**

---

## What the app needs to run in production

Derived from the codebase:

1. **Node.js ≥ 20** (Next.js 16 + React 19).
2. **A PostgreSQL database** reachable as `DATABASE_URL`. Tested locally with PG 16. The Prisma client uses `@prisma/adapter-pg` so any Postgres-compatible service should work.
3. **Outbound HTTPS** to: `api.anthropic.com`, `rest.arbeitsagentur.de`, `jsearch.p.rapidapi.com`, `active-jobs-db.p.rapidapi.com`, `api.adzuna.com`. Also Indeed and Glassdoor *if* JobSpy is enabled.
4. **Environment variables** as documented in `.env.example`:
   - `DATABASE_URL` (required)
   - `AUTH_SECRET` (required — signs the session JWT; generate with `npx auth secret`). In production also set `AUTH_URL`/`NEXTAUTH_URL` to the deployed origin and `AUTH_TRUST_HOST=true` behind a proxy.
   - `ANTHROPIC_API_KEY` (required for the Claude AI path — CV upload + scoring; or set `GEMINI_API_KEY` and make Gemini the active provider in admin)
   - `SUPER_ADMIN_EMAILS` (optional, comma-separated — bootstraps admin access; set this to reach `/admin` at all)
   - `GEMINI_API_KEY` (optional — enables the Gemini AI provider)
   - `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (optional — token purchases). Test keys (`sk_test_…`) work as-is. **For live payments** set a `sk_live_…` key **and** `STRIPE_ALLOW_LIVE=true` (the app refuses a live key without that opt-in), plus `STRIPE_WEBHOOK_SECRET` from a **live** endpoint registered at `https://<host>/api/stripe/webhook`. Live mode also needs an activated Stripe account and is your responsibility for VAT/tax + terms.
   - `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` (optional — Google sign-in; register the prod redirect URI `https://<host>/api/auth/callback/google`. Email/password works without it.)
   - `JSEARCH_API_KEY`, `FANTASTIC_JOBS_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` (optional, per source — env fallbacks; can also be set in admin)
   - `JOBSPY_SITES` (optional, JobSpy only)

   > **Note (2026-05-25):** AI + source keys are also settable in the **admin backoffice** (stored in `PlatformCredential`, DB-first over env). The env vars above remain the first-run/CI fallback.
5. **If JobSpy is needed:** Python 3.10+ runtime alongside Node + the `.venv-jobspy/` venv with `python-jobspy` installed. Most managed Node hosts don't provide a Python runtime — this means JobSpy effectively cannot run on Vercel, Netlify, or similar serverless platforms. Use a container host or a VM if you need it.
6. **Persistent disk for Postgres** (if you're hosting the DB yourself).

The app **does not** need:

- A separate worker process.
- A Redis / queue.
- A CDN (Next.js serves static assets fine).
- An object store (CVs are stored as `Profile.rawCvText` in the DB, not on disk).

---

## Migrations

Schema changes ship as Prisma migrations under `prisma/migrations/`. In production:

```bash
npx prisma migrate deploy
```

(not `migrate dev` — `deploy` applies pending migrations non-interactively and refuses to drop/reset). This needs `DATABASE_URL` set; the migration history is part of the repo, so a fresh DB will be brought up to schema state by running `migrate deploy` against it once.

There is **no seed step** to run. The app is multi-tenant — each user's `Settings` row is created on first access and their `Profile` when they upload a CV, so `npm run db:seed` is a no-op. The first account to register or sign in claims any legacy `userId = null` rows (a no-op on a fresh database). Just make sure `AUTH_SECRET` is set so users can actually sign in.

---

## Sketch: containerised single-VM deployment

Conservative recipe. **Not present in the repo** — would need to be added. Adapt to your hosting target.

### Dockerfile (proposed, not committed)

```Dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node node_modules/next/dist/bin/next start -p 3000"]
```

Caveats:

- Sets `next.config.ts: { output: "standalone" }` would shrink the runtime image but is not currently configured.
- Does *not* include the JobSpy venv. To include it, add `apk add python3 py3-pip` to the runner stage and bake in `python-jobspy`, then ensure `.venv-jobspy/bin/python` resolves at runtime (or rewrite `jobspy.ts` to look up `which python3`).
- Does *not* include a healthcheck endpoint. `GET /api/sources` now requires a session and returns **401** when unauthenticated — a 401 still proves the process is up, but it's not a clean `200` liveness probe. Adding a public `/api/health` returning `{ ok: true }` is the cleaner fix (see "What needs to be added").

### docker-compose.prod.yml (proposed, not committed)

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: ${PG_USER}
      POSTGRES_PASSWORD: ${PG_PASSWORD}
      POSTGRES_DB: ${PG_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
  app:
    build: .
    restart: always
    depends_on: [db]
    environment:
      DATABASE_URL: postgresql://${PG_USER}:${PG_PASSWORD}@db:5432/${PG_DB}?schema=public
      AUTH_SECRET: ${AUTH_SECRET}
      AUTH_URL: ${AUTH_URL}                 # e.g. https://jobs.example.com
      AUTH_TRUST_HOST: "true"               # behind a reverse proxy
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      AUTH_GOOGLE_ID: ${AUTH_GOOGLE_ID}     # optional — Google sign-in
      AUTH_GOOGLE_SECRET: ${AUTH_GOOGLE_SECRET}
      JSEARCH_API_KEY: ${JSEARCH_API_KEY}
      FANTASTIC_JOBS_API_KEY: ${FANTASTIC_JOBS_API_KEY}
      ADZUNA_APP_ID: ${ADZUNA_APP_ID}
      ADZUNA_APP_KEY: ${ADZUNA_APP_KEY}
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

Run on the host:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

**This is not the docker-compose.yml in the repo.** The committed compose file is for local development only — it exposes Postgres on the host network at :5433 with throwaway credentials.

---

## Sketch: Vercel + managed Postgres

Possible but with caveats:

- Set the same env vars (use Vercel's encrypted env UI, **never** commit them).
- Use a managed Postgres (Neon, Supabase, Render Postgres) — Vercel doesn't provide one bundled.
- Run `npx prisma migrate deploy` from a one-off CLI session against the managed DB before deploying, or wire it into a `postbuild` script (`"postbuild": "prisma migrate deploy"`) — **this is not currently configured**.
- **JobSpy will not work.** Vercel functions have no Python runtime and no persistent venv. The adapter will see `existsSync(VENV_PYTHON) === false`, return `[]`, and the source will silently skip. That's the designed-in fallback behaviour.
- Long refresh runs (~30 s) approach Vercel's free-tier timeout (10 s for Edge, 60 s for Pro Functions). On free tier, expect refreshes to time out before all sources complete.

---

## Pre-deploy checklist

Before the first deploy of any environment, run locally:

```bash
npx tsc --noEmit                # must exit 0
npm run lint                    # must exit 0
npm run build                   # must succeed
```

Then against the target environment:

```bash
DATABASE_URL=<prod-url> npx prisma migrate deploy   # apply schema (no seed step — see Migrations)
```

Smoke-test after deploy:

```bash
curl -i https://<host>/api/sources
# Expect: HTTP 401 {"error":"Sign in to continue."} — proves the app is up and auth is enforced.
# Then register/sign in in the browser and load /api/sources from an authenticated session;
# expect { "sources": [...] } with 5 entries.
```

If `AUTH_SECRET` is unset, sign-in fails and every gated route is unreachable. If `ANTHROPIC_API_KEY` is unset, the CV upload route returns a 500 with a clear message. Once authenticated, the Sources endpoint responds fine even without any source keys — it just shows `configured: false` for the dependent sources.

---

## Rollback

There is no documented rollback procedure. The conservative approach:

1. Migrations are **forward-only** in Prisma (no `down` files). If a migration goes wrong, restore the database from a backup, then deploy the previous code revision.
2. Application rollback is whatever your hosting layer offers (redeploying a previous image / Git SHA).
3. **Backups are your responsibility** — there is no automated backup in the repo.

---

## What needs to be added before this is a real production deployment

In rough priority order:

1. **A real `Dockerfile`** (or `vercel.json`, depending on target) committed and tested.
2. **Backup strategy** for Postgres — managed Postgres providers handle this; if self-hosting, schedule `pg_dump`.
3. **A health endpoint** — `GET /api/sources` is *functional* but returns a heavy object. A lightweight `/api/health` returning `{ ok: true }` would be cheaper to ping.
4. **Tests** — see `docs/TESTING.md`. Without them, every deployment is a manual smoke test.
5. **CI pipeline** that runs typecheck + lint + build on every push. No `.github/workflows/` exist.
6. **Observability** — log aggregation, error tracking (Sentry), uptime monitoring. None currently configured.
7. **Secrets management** — secrets currently live in `.env.local`. In production, route them through your platform's secret store.
8. **Rate-limit & cost controls** — *partially built (2026-05-25).* `src/lib/limits.ts` now enforces **balance gates** (CV ≥ 25 tokens; Research > 0 → 402) and admin-configurable **rate limits** (research/hour, CV/day → 429) on the two AI actions, and `src/lib/budget.ts` raises **dashboard alerts** on daily token/request/error thresholds. Still open: the source-API fan-out within a single refresh is unthrottled, and there's no global spend ceiling across users.

---

## Open questions

These are not answered by the codebase and require a product decision:

- **Who hosts it?** No deploy target is implied anywhere.
- **What's the SLA?** Multi-tenant now (Auth.js), though still owner-operated — probably "best effort", but worth stating once there are real users.
- **Backups: hot or cold?** `Profile.rawCvText` holds each user's raw CV; losing it means every user re-uploading. `User`, `Settings`, `Job`, and the `TokenLedger` (the billing audit trail) are not re-derivable either — there's no seed to fall back on.
- **Scheduled refresh?** Currently refresh is manual (button-triggered). If you want a CRON refresh, you'd add a `/api/jobs/refresh` cron call (Vercel Cron, GitHub Actions cron, host cron, etc.) — none configured.
