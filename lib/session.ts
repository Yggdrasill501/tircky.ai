import { asSystem } from "./db/client";
import { getKyselyRepositories } from "./db/repositories";

/**
 * Session resolution — the single source of `user_id`.
 *
 * Authentication is not implemented. This returns the seeded development user,
 * and that is the ONLY thing that changes when a provider lands: every caller
 * already receives an opaque `userId` it did not choose, so no repository,
 * query or table is touched by adding auth.
 *
 * The invariant it holds (specs/ARCHITECTURE.md § Security Model) is already
 * true today: `userId` is never read from a request body, a query parameter,
 * or an LLM tool argument.
 *
 * It reads on the owner connection precisely because there is no session yet —
 * the app-role pool would be filtered by RLS to a user it cannot yet name.
 * That inversion disappears with the auth implementation.
 */
export const DEV_USER_EMAIL = "dev@tricky.local";

export interface Session {
  readonly userId: string;
  readonly email: string;
  readonly timezone: string;
  readonly massUnit: "kg" | "lb";
  readonly energyUnit: "kcal" | "kj";
}

export async function getSession(): Promise<Session> {
  return asSystem(async (trx) => {
    const repos = getKyselyRepositories(trx);
    const user = await repos.users.findByEmail(DEV_USER_EMAIL);
    if (!user) {
      throw new Error("No development user found. Run `pnpm db:seed`.");
    }

    const prefs = await repos.preferences.findByUserId(user.id);
    if (!prefs) {
      throw new Error(`User ${user.id} has no preferences row.`);
    }

    return {
      userId: user.id,
      email: user.email,
      timezone: prefs.timezone,
      massUnit: prefs.massUnit,
      energyUnit: prefs.energyUnit,
    };
  });
}
