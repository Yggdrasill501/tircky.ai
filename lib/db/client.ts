import { CamelCasePlugin, Kysely, PostgresDialect, sql, type LogEvent } from "kysely";
import { Pool, type PoolConfig } from "pg";
import type { DB } from "./types";
import { SEARCH_PATH } from "./search-path";

/**
 * Two pools, two privilege levels.
 *
 * `db` connects as a NON-SUPERUSER role, which is the only way row-level
 * security has any effect: superusers bypass RLS unconditionally, and FORCE
 * ROW LEVEL SECURITY does not change that. An app connecting as the owner has
 * RLS fully configured and fully inert — which looks correct in every schema
 * dump and in every migration.
 *
 * `adminDb` connects as the owner: migrations, seeds, and jobs that
 * legitimately span users. It must never be reachable from a request path.
 *
 * There is deliberately no in-band bypass setting: a GUC is something SQL
 * injection could flip, whereas a separate pool is not reachable from a query.
 */

const SLOW_QUERY_MS = Number(process.env.DB_SLOW_QUERY_MS ?? 200);

/**
 * Serverless platforms give every concurrent invocation its own process, so a
 * pool size that is sane on one long-lived container becomes that number times
 * the number of warm lambdas. A small Postgres tops out around 100 connections
 * and refuses the rest, which surfaces as intermittent "too many clients" under
 * exactly the load you least want it under.
 *
 * One connection per instance, and let the platform's own pooler do the
 * multiplexing — that is what a pooled connection string is for.
 */
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function defaultPoolMax(): number {
  const explicit = process.env.DATABASE_POOL_MAX;
  if (!explicit) return IS_SERVERLESS ? 1 : 10;

  const max = Number(explicit);
  // Explicit configuration is honoured — it is the operator's call — but a
  // large pool on serverless is almost always an .env copied from a local
  // machine rather than a decision, and it fails under load rather than at
  // boot. Say so.
  if (IS_SERVERLESS && max > 2) {
    console.warn(
      `[db] DATABASE_POOL_MAX=${max} on a serverless platform: each warm instance ` +
        `holds its own pool, so the real connection count is this times the number ` +
        `of instances. Unset it to use the serverless default of 1.`,
    );
  }
  return max;
}

export interface PoolMetrics {
  total: number;
  idle: number;
  waiting: number;
}

function basePoolConfig(connectionString: string, max: number): PoolConfig {
  return {
    connectionString,
    max,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    // Set on the connection itself rather than per-query. It must match
    // .config/kysely.config.ts — if they diverge, migrations create tables
    // somewhere the app cannot see and the failure reads as a missing table.
    //
    // Belt and braces: `ALTER ROLE ... SET search_path` is also applied to the
    // app role (scripts/ensure-local-roles.ts), because a transaction-mode
    // pooler such as PgBouncer may drop startup `options` entirely. The
    // server-side default survives that; this does not.
    options: `-c search_path=${SEARCH_PATH}`,
  };
}

function makePool(connectionString: string, max: number, label: string): Pool {
  const pool = new Pool(basePoolConfig(connectionString, max));

  // Without this handler an idle client erroring — a database restart, a
  // network blip, an idle-timeout kill — raises an unhandled 'error' event on
  // the Pool and takes the whole process down.
  pool.on("error", (err) => {
    console.error(`[db:${label}] idle client error:`, err.message);
  });

  return pool;
}

function makeKysely(pool: Pool, label: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
    // Pairs with kysely-codegen's --camel-case: the generated types are
    // camelCase, and this is what turns them back into the snake_case columns
    // the migrations actually create. Generating one half without the other
    // fails at runtime as "relation does not exist", not at compile time.
    plugins: [new CamelCasePlugin()],
    log: (event: LogEvent) => {
      if (event.level === "error") {
        console.error(`[db:${label}] query failed:`, {
          error: event.error instanceof Error ? event.error.message : event.error,
          sql: event.query.sql,
          ms: Math.round(event.queryDurationMillis),
        });
        return;
      }
      if (event.queryDurationMillis >= SLOW_QUERY_MS) {
        console.warn(`[db:${label}] slow query ${Math.round(event.queryDurationMillis)}ms:`, {
          sql: event.query.sql,
        });
      }
    },
  });
}

const g = globalThis as unknown as {
  __pgApp?: Pool;
  __pgAdmin?: Pool;
  __kyApp?: Kysely<DB>;
  __kyAdmin?: Kysely<DB>;
};

// Created on first use, not at import: `next build` imports every route module
// to collect page data, and connecting there would make the build depend on a
// reachable database.
function appPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  g.__pgApp ??= makePool(url, defaultPoolMax(), "app");
  return g.__pgApp;
}

function adminPool(): Pool {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is not set. Copy .env.example to .env.");
  g.__pgAdmin ??= makePool(url, 2, "admin");
  return g.__pgAdmin;
}

export function getKysely(): Kysely<DB> {
  g.__kyApp ??= makeKysely(appPool(), "app");
  return g.__kyApp;
}

export function getAdminKysely(): Kysely<DB> {
  g.__kyAdmin ??= makeKysely(adminPool(), "admin");
  return g.__kyAdmin;
}

/** Pool gauges, for a metrics endpoint or a log line. */
export function poolMetrics(): { app: PoolMetrics | null; admin: PoolMetrics | null } {
  const read = (p?: Pool): PoolMetrics | null =>
    p ? { total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount } : null;
  return { app: read(g.__pgApp), admin: read(g.__pgAdmin) };
}

/**
 * Run a unit of work as a given user, with RLS enforced.
 *
 * `set_config(..., true)` is transaction-scoped, so the binding cannot leak to
 * the next checkout of a pooled connection — the failure mode that makes a
 * plain SET genuinely dangerous here.
 */
export async function withUser<T>(
  userId: string,
  work: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> {
  return getKysely()
    .transaction()
    .execute(async (trx) => {
      await sql`select set_config('app.user_id', ${userId}, true)`.execute(trx);
      return work(trx);
    });
}

/** Owner-level work: seeds and cross-user jobs. Never a request path. */
export async function asSystem<T>(work: (trx: Kysely<DB>) => Promise<T>): Promise<T> {
  return getAdminKysely()
    .transaction()
    .execute(async (trx) => work(trx));
}

export async function closeConnections(): Promise<void> {
  await Promise.allSettled([g.__kyApp?.destroy(), g.__kyAdmin?.destroy()]);
  g.__kyApp = undefined;
  g.__kyAdmin = undefined;
  g.__pgApp = undefined;
  g.__pgAdmin = undefined;
}
