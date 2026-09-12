# Deploying

## What happens if you deploy right now

Every UI page works with **no database at all**. `/day`, `/day/merged`, `/workout`,
`/trends` and `/components` are client components rendering `lib/fixtures.ts`; nothing
reads Postgres yet.

`/api/health` is the only route that touches a dependency, and it will return
`503 degraded` until `DATABASE_URL` and the storage variables point somewhere real.
That is the expected first result, not a misconfiguration.

## Vercel

### 1. Postgres

There is no database on Vercel and `docker-compose.yml` does not deploy. Pick a
managed provider — Neon, Vercel Postgres (Neon underneath), or Supabase.

Two connection strings are needed, and they are not interchangeable:

| Variable | Which endpoint | Why |
| --- | --- | --- |
| `DATABASE_URL` | the **pooled** endpoint | Every warm serverless instance holds its own connections |
| `DATABASE_ADMIN_URL` | the **direct** endpoint | Migrations take locks and run DDL; a transaction pooler is the wrong place for that |

The pool sizes itself to 1 per instance when `VERCEL` is set (`lib/db/client.ts`),
so the provider's pooler does the multiplexing. Overriding `DATABASE_POOL_MAX`
upward on serverless is how you get intermittent `too many clients`.

`withUser()` is pooler-safe by construction: it uses
`set_config('app.user_id', …, true)` **inside a transaction**, so the whole unit of
work lands on one server connection. A plain `SET` would not survive transaction
pooling, and the resulting cross-user read would be silent.

### 2. Roles

Row-level security only works if the application connects as a role that is neither
a superuser nor `BYPASSRLS`. Locally `scripts/ensure-local-roles.ts` creates one;
against a managed database, run the equivalent once by hand on the **direct**
endpoint:

```sql
create role tricky_app with login password '<strong password>'
  nosuperuser nocreatedb nocreaterole nobypassrls;

grant connect on database <db> to tricky_app;
grant usage on schema public to tricky_app;

-- Survives a transaction pooler dropping startup options.
alter role tricky_app set search_path = app, public;
```

Then verify, because getting this wrong leaves RLS configured and completely inert:

```sql
select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'tricky_app';
-- expect: f, f
```

`pnpm test:rls` asserts exactly this and will tell you if the deployed role is wrong.
The schema grants are issued by the baseline migration.

### 3. Migrations

**Do not run migrations from the Vercel build command.** Builds run on every push
including preview deployments, all of which point at the same database — a preview
branch would migrate production.

Run them from CI after a successful deploy, or by hand against
`DATABASE_ADMIN_URL`:

```bash
DATABASE_ADMIN_URL=<direct url> pnpm db:migrate:latest
```

The `migrate` Docker target exists for the same job in a container-based deploy:

```bash
docker build --target migrate -t tricky:migrate .
docker run --rm -e DATABASE_ADMIN_URL=<direct url> tricky:migrate
```

### 4. Object storage

MinIO is local only. The client is S3-compatible (`lib/storage.ts`), so Cloudflare R2
or S3 needs nothing but different values:

```
STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_BUCKET=tricky
STORAGE_ACCESS_KEY=…
STORAGE_SECRET_KEY=…
```

Vercel Blob would need a different client and is not wired.

Nothing uses storage until Phase 3, so leaving it unset only keeps `/api/health`
amber.

### 5. Environment variables

Set on the Vercel project: `DATABASE_URL`, `DATABASE_ADMIN_URL`, `STORAGE_ENDPOINT`,
`STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`.
`ANTHROPIC_API_KEY` is not used until Phase 2.

`output: "standalone"` in `next.config.ts` is for the Docker image. Vercel ignores it.

## What Vercel cannot host

Per `specs/health-ingest/FEATURE_SPEC.md`, the Apple Health ingest worker streams a
500 MB–2 GB XML document and runs for minutes. That exceeds both the execution time
and the memory of a serverless function, in both dimensions at once. It needs a
long-lived container — which is what `Dockerfile` and `docker-compose.prod.yml` are
for, and why they stay in the repo even if the web app lives on Vercel.

Deploying the app to Vercel and that one worker to a container host is a coherent
split, not a contradiction.

## Local development

Unchanged: `pnpm dev:all` then `pnpm dev`. The compose stack stays the development
environment regardless of where production runs, and CI runs that same stack so the
two cannot drift.
