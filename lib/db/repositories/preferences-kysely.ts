import type { Kysely } from "kysely";
import type { DB } from "../types";
import type { PreferencesRepository, UserPreference } from "./types";

export function createPreferencesRepository(db: Kysely<DB>): PreferencesRepository {
  return {
    async findByUserId(userId: string): Promise<UserPreference | undefined> {
      return db
        .selectFrom("userPreferences")
        .selectAll()
        .where("userId", "=", userId)
        .executeTakeFirst();
    },

    async update(
      userId: string,
      patch: Partial<UserPreference>,
    ): Promise<UserPreference | undefined> {
      // userId is the scope, never part of the patch — accepting it in the
      // payload would let a caller move a preferences row to another user.
      const { userId: _ignored, createdAt: _c, ...rest } = patch;
      if (Object.keys(rest).length === 0) return this.findByUserId(userId);

      return db
        .updateTable("userPreferences")
        .set({ ...rest, updatedAt: new Date() })
        .where("userId", "=", userId)
        .returningAll()
        .executeTakeFirst();
    },
  };
}
