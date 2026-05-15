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
   - `ANTHROPIC_API_KEY` (required for any CV upload or refresh)
   - `JSEARCH_API_KEY`, `FANTASTIC_JOBS_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` (optional, per source)
   - `JOBSPY_SITES` (optional, JobSpy only)
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

After applying migrations, seed the singleton:

```bash
npm run db:seed
```

Run this **once per database** — `prisma.settings.upsert({ where: { id: "singleton" }, update: {} })` is a no-op if the row exists.

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
- Does *not* include a healthcheck endpoint — `GET /api/sources` will work as a liveness probe.

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
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
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
DATABASE_URL=<prod-url> npx prisma migrate deploy   # apply schema
DATABASE_URL=<prod-url> npm run db:seed             # seed Settings singleton (idempotent)
```

Smoke-test after deploy:

```bash
curl https://<host>/api/sources
# Expect: { "sources": [...] } with 5 entries
```

If `ANTHROPIC_API_KEY` is unset, the CV upload route will return a 500 with a clear message. The Sources endpoint will respond fine even without any keys — it just shows `configured: false` for the dependent sources.

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
8. **Rate-limit & cost controls** — refresh can issue dozens of API calls; without throttling a runaway client (or a CRON misconfiguration if you add scheduled refreshes) can burn quota fast.

---

## Open questions

These are not answered by the codebase and require a product decision:

- **Who hosts it?** No deploy target is implied anywhere.
- **What's the SLA?** Single-user tool — probably "best effort", but worth stating.
- **Backups: hot or cold?** Profile.rawCvText holds the raw CV; losing it means re-uploading. Settings can be re-seeded.
- **Scheduled refresh?** Currently refresh is manual (button-triggered). If you want a CRON refresh, you'd add a `/api/jobs/refresh` cron call (Vercel Cron, GitHub Actions cron, host cron, etc.) — none configured.
