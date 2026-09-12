/**
 * The search path, defined once.
 *
 * Every connection sets this so queries can use unqualified table names. It is
 * consumed by BOTH the runtime pool (lib/db/client.ts) and the migration
 * runner (.config/kysely.config.ts) — if those two ever disagree, migrations
 * create tables somewhere the app cannot see them, and the failure looks like
 * a missing table rather than a configuration mismatch.
 *
 * Importing this constant in both places is what keeps them honest.
 */
export const SEARCH_PATH = "app,public";

/** Schema that owns the domain tables. */
export const APP_SCHEMA = "app";
