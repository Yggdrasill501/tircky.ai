import type { Kysely } from "kysely";
import type { DB } from "../types";
import type { User, UsersRepository } from "./types";

export function createUsersRepository(db: Kysely<DB>): UsersRepository {
  // Every read filters deleted_at (specs/ARCHITECTURE.md § Soft delete). A
  // repository is the right place for that rule — leaving it to callers means
  // it holds until the first caller forgets.
  const base = () => db.selectFrom("users").selectAll().where("deletedAt", "is", null);

  return {
    async findById(id: string): Promise<User | undefined> {
      return base().where("id", "=", id).executeTakeFirst();
    },

    async findByEmail(email: string): Promise<User | undefined> {
      return base().where("email", "=", email).executeTakeFirst();
    },

    async findByAuthSubject(subject: string): Promise<User | undefined> {
      return base().where("authSubject", "=", subject).executeTakeFirst();
    },
  };
}
