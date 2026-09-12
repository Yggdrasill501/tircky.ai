import { type Kysely, sql } from "kysely";

/**
 * Row-level security. specs/ARCHITECTURE.md § Security Model, Invariant 3.
 *
 * FORCE is the part that matters. Plain ENABLE does not apply to the table
 * OWNER, and migrations run as the owner — so without FORCE every policy here
 * would be inert against the owner while looking correct.
 *
 * The other half is in lib/db/client.ts: the runtime pool connects as a
 * non-superuser, because superusers bypass RLS whatever the table says.
 *
 * This is defence in depth, not the primary control — the repository layer
 * scopes its own queries. RLS is what makes a missed WHERE clause return
 * nothing instead of another user's rows.
 */
const TABLES = [
  { name: "users", column: "id" },
  { name: "user_preferences", column: "user_id" },
  { name: "user_goals", column: "user_id" },
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  // The current session user, or NULL when unset. `missing_ok = true` keeps
  // this from raising on a connection that never went through withUser().
  await sql`
    create or replace function app.current_user_id() returns uuid
      language sql stable
      as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$
  `.execute(db);

  await sql`grant execute on function app.current_user_id() to public`.execute(db);

  for (const { name, column } of TABLES) {
    const table = sql.raw(`app.${name}`);
    const col = sql.raw(column);
    await sql`alter table ${table} enable row level security`.execute(db);
    await sql`alter table ${table} force row level security`.execute(db);
    await sql`
      create policy ${sql.raw(`${name}_self`)} on ${table}
        using (${col} = app.current_user_id())
        with check (${col} = app.current_user_id())
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const { name } of TABLES) {
    const table = sql.raw(`app.${name}`);
    await sql`drop policy if exists ${sql.raw(`${name}_self`)} on ${table}`.execute(db);
    await sql`alter table ${table} no force row level security`.execute(db);
    await sql`alter table ${table} disable row level security`.execute(db);
  }
  await sql`drop function if exists app.current_user_id()`.execute(db);
}
