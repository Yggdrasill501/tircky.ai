import "dotenv/config";
import { Client } from "pg";

/**
 * Create the roles the migrations expect, before they run.
 *
 * POSTGRES_USER is created as a SUPERUSER by the postgres image, and
 * superusers bypass row-level security unconditionally. An application that
 * connects as it would have RLS configured and entirely inert. So the runtime
 * gets its own NOSUPERUSER NOBYPASSRLS role, and this is what creates it
 * locally. In a deployed environment the equivalent is done by whatever
 * provisions the database.
 *
 * Idempotent: safe to run on every `pnpm dev:all`.
 */
const APP_ROLE = process.env.DATABASE_APP_ROLE ?? "tricky_app";
const APP_PASSWORD = process.env.DATABASE_APP_PASSWORD ?? "tricky_app";

async function main() {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL is not set.");

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { rows } = await client.query("select 1 from pg_roles where rolname = $1", [APP_ROLE]);

    if (rows.length === 0) {
      // Role names cannot be parameterised; APP_ROLE comes from our own env,
      // not from user input, and is quoted defensively.
      await client.query(
        `create role "${APP_ROLE}" with login password '${APP_PASSWORD}' ` +
          `nosuperuser nocreatedb nocreaterole nobypassrls`,
      );
      console.log(`created role ${APP_ROLE}`);
    } else {
      console.log(`role ${APP_ROLE} already exists`);
    }

    const db = new URL(connectionString).pathname.slice(1);
    await client.query(`grant connect on database "${db}" to "${APP_ROLE}"`);
    await client.query(`grant usage on schema public to "${APP_ROLE}"`);

    // Verify the property the whole RLS design depends on.
    const check = await client.query(
      "select rolsuper, rolbypassrls from pg_roles where rolname = $1",
      [APP_ROLE],
    );
    const role = check.rows[0] as { rolsuper: boolean; rolbypassrls: boolean } | undefined;
    if (role?.rolsuper || role?.rolbypassrls) {
      throw new Error(
        `${APP_ROLE} can bypass RLS (rolsuper=${role.rolsuper}, rolbypassrls=${role.rolbypassrls}). ` +
          `Row-level security would be inert for the application.`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("ensure-local-roles failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
