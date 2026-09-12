import type { Kysely } from "kysely";
import type { DB } from "../types";
import type { GoalsRepository, UserGoal } from "./types";

export function createGoalsRepository(db: Kysely<DB>): GoalsRepository {
  return {
    /** The goal in force: the one open-ended row (specs/identity Invariant 3). */
    async findActive(userId: string): Promise<UserGoal | undefined> {
      return db
        .selectFrom("userGoals")
        .selectAll()
        .where("userId", "=", userId)
        .where("deletedAt", "is", null)
        .where("effectiveTo", "is", null)
        .executeTakeFirst();
    },

    async listForUser(userId: string): Promise<UserGoal[]> {
      return db
        .selectFrom("userGoals")
        .selectAll()
        .where("userId", "=", userId)
        .where("deletedAt", "is", null)
        .orderBy("effectiveFrom", "desc")
        .execute();
    },
  };
}
