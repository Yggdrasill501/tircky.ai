import "dotenv/config";
import { formatError } from "../lib/errors";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import { asSystem, closeConnections, withUser } from "../lib/db/client";
import { getKyselyRepositories } from "../lib/db/repositories";

/**
 * The Phase 0 exit criterion (specs/ROADMAP.md): prove that user A's session
 * cannot read user B's rows, and that every user-owned table actually has a
 * policy.
 *
 * The coverage check is the one that earns its keep over time — it fails
 * automatically on any future migration that adds a user_id column and forgets
 * the policy, which is exactly the mistake nobody catches by reading a diff.
 */
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const a = uuidv7();
  const b = uuidv7();

  await asSystem(async (trx) => {
    for (const id of [a, b]) {
      await trx.insertInto("users").values({ id, email: `rls-${id}@test.local` }).execute();
      await trx.insertInto("userPreferences").values({ userId: id, timezone: "UTC" }).execute();
    }
  });

  try {
    // --- cross-user reads, through the repository layer -------------------
    const seesSelf = await withUser(a, (trx) => getKyselyRepositories(trx).users.findById(a));
    check("user A reads their own row", seesSelf?.id === a);

    const seesB = await withUser(a, (trx) => getKyselyRepositories(trx).users.findById(b));
    check("user A cannot read user B", seesB === undefined, seesB ? "row returned" : "");

    const all = await withUser(a, (trx) =>
      trx.selectFrom("users").select("id").execute(),
    );
    check("an unscoped SELECT returns only A", all.length === 1, `${all.length} row(s)`);

    const bPrefs = await withUser(a, (trx) =>
      getKyselyRepositories(trx).preferences.findByUserId(b),
    );
    check("user A cannot read B's preferences", bPrefs === undefined);

    // --- cross-user writes ------------------------------------------------
    const updated = await withUser(a, (trx) =>
      trx
        .updateTable("users")
        .set({ displayName: "hijacked" })
        .where("id", "=", b)
        .returning("id")
        .execute(),
    );
    check("user A cannot update user B", updated.length === 0, `${updated.length} row(s) updated`);

    // --- policy coverage --------------------------------------------------
    const uncovered = await asSystem(async (trx) => {
      const res = await sql<{ table: string }>`
        select c.relname as table
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app'
          and c.relkind = 'r'
          and exists (
            select 1 from information_schema.columns col
            where col.table_schema = 'app'
              and col.table_name = c.relname
              and (col.column_name = 'user_id' or (c.relname = 'users' and col.column_name = 'id'))
          )
          and not (c.relrowsecurity and c.relforcerowsecurity)
      `.execute(trx);
      return res.rows;
    });
    const names = uncovered.map((r) => r.table);
    check(
      "every user-owned table has FORCEd RLS",
      names.length === 0,
      names.length ? `missing: ${names.join(", ")}` : "",
    );

    // --- the property the whole design rests on ---------------------------
    const appRole = await withUser(a, async (trx) => {
      const res = await sql<{ rolsuper: boolean; rolbypassrls: boolean; me: string }>`
        select current_user as me, rolsuper, rolbypassrls
        from pg_roles where rolname = current_user
      `.execute(trx);
      return res.rows[0];
    });
    check(
      "the app connects as a non-superuser that cannot bypass RLS",
      appRole != null && !appRole.rolsuper && !appRole.rolbypassrls,
      appRole ? `connected as ${appRole.me}` : "could not determine role",
    );
  } finally {
    await asSystem(async (trx) => {
      await trx.deleteFrom("users").where("id", "in", [a, b]).execute();
    });
    await closeConnections();
  }

  console.log(failures === 0 ? "\nRLS: all checks passed" : `\nRLS: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("rls test error:", formatError(err));
  await closeConnections().catch(() => {});
  process.exit(1);
});
