import "dotenv/config";
import { resolve } from "node:path";
import { defineConfig } from "kysely-ctl";
import { Pool } from "pg";
import { SEARCH_PATH } from "../lib/db/search-path";

/**
 * Migrations run as the OWNER role, not the app role: the app role is a
 * non-superuser with no DDL rights so that row-level security applies to it
 * (superusers bypass RLS unconditionally, FORCE or not).
 */
const connectionString = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  dialect: "pg",
  dialectConfig: {
    pool: new Pool({
      connectionString,
      max: 1,
      options: `-c search_path=${SEARCH_PATH}`,
    }),
  },
  migrations: {
    // Absolute. kysely-ctl resolves a relative migrationFolder against the
    // CONFIG FILE's directory, not the working directory — a bare "migrations"
    // silently points at .config/migrations and reports "no migrations found".
    migrationFolder: resolve(process.cwd(), "migrations"),
  },
});
