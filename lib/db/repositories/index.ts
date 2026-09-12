import type { Kysely } from "kysely";
import { getKysely } from "../client";
import type { DB } from "../types";
import { createGoalsRepository } from "./goals-kysely";
import { createPreferencesRepository } from "./preferences-kysely";
import { createUsersRepository } from "./users-kysely";
import type { Repositories } from "./types";

export type { Repositories } from "./types";
export type { User, UserGoal, UserPreference } from "./types";

/**
 * The single entry point for data access.
 *
 * Pass a transaction to get repositories bound to it — which is how a
 * request-scoped `withUser()` transaction keeps RLS applied across every read
 * it makes. Called with no argument it uses the app pool.
 */
export function getKyselyRepositories(db: Kysely<DB> = getKysely()): Repositories {
  return {
    users: createUsersRepository(db),
    preferences: createPreferencesRepository(db),
    goals: createGoalsRepository(db),
  };
}
