import type { Selectable } from "kysely";
import type { UserGoals, UserPreferences, Users } from "../types";

export type User = Selectable<Users>;
export type UserPreference = Selectable<UserPreferences>;
export type UserGoal = Selectable<UserGoals>;

/**
 * Repository interfaces are declared separately from their Kysely
 * implementations so a caller depends on the contract, not on the query
 * builder. The `-kysely` suffix on the implementations is what keeps that
 * boundary visible in the file tree.
 */
export interface UsersRepository {
  findById(id: string): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findByAuthSubject(subject: string): Promise<User | undefined>;
}

export interface PreferencesRepository {
  findByUserId(userId: string): Promise<UserPreference | undefined>;
  update(userId: string, patch: Partial<UserPreference>): Promise<UserPreference | undefined>;
}

export interface GoalsRepository {
  findActive(userId: string): Promise<UserGoal | undefined>;
  listForUser(userId: string): Promise<UserGoal[]>;
}

export interface Repositories {
  users: UsersRepository;
  preferences: PreferencesRepository;
  goals: GoalsRepository;
}
