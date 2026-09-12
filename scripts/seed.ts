import "dotenv/config";
import { uuidv7 } from "uuidv7";
import { asSystem, closeConnections } from "../lib/db/client";

/**
 * Seed the development user.
 *
 * Auth is not implemented, so this row is what lib/session.ts resolves to.
 * Guarded on an existing row so `pnpm dev:all` can run repeatedly without
 * duplicating anything; `--force` replaces it.
 *
 * Runs on the owner connection: RLS is FORCEd and a seed has no session.
 */
const EMAIL = "dev@tricky.local";
const force = process.argv.includes("--force");

async function main() {
  await asSystem(async (trx) => {
    const existing = await trx
      .selectFrom("users")
      .select("id")
      .where("email", "=", EMAIL)
      .executeTakeFirst();

    if (existing && !force) {
      console.log(`dev user already seeded (${existing.id}) — pass --force to replace`);
      return;
    }

    if (existing) {
      await trx.deleteFrom("users").where("email", "=", EMAIL).execute();
      console.log("removed existing dev user");
    }

    const userId = uuidv7();

    await trx
      .insertInto("users")
      .values({ id: userId, email: EMAIL, displayName: "Dev" })
      .execute();

    await trx
      .insertInto("userPreferences")
      .values({
        userId,
        timezone: "Europe/Prague",
        massUnit: "kg",
        bodyMassUnit: "kg",
        distanceUnit: "km",
        energyUnit: "kcal",
        weekStartsOn: 1,
        locale: "en-GB",
      })
      .execute();

    await trx
      .insertInto("userGoals")
      .values({
        id: uuidv7(),
        userId,
        kind: "cut",
        effectiveFrom: new Date().toISOString().slice(0, 10),
        targetBodyMassKg: "78.000",
        targetRateKgPerWeek: "-0.400",
        note: "Seeded default.",
      })
      .execute();

    console.log(`seeded dev user ${userId} (${EMAIL})`);
  });

  await closeConnections();
}

main().catch(async (err) => {
  console.error("seed failed:", err instanceof Error ? err.message : err);
  await closeConnections().catch(() => {});
  process.exit(1);
});
