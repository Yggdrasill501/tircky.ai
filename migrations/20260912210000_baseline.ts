import { type Kysely, sql } from "kysely";

/** The runtime role grants are issued to. Created by db/init locally. */
const APP_ROLE = process.env.DATABASE_APP_ROLE ?? "tricky_app";

/**
 * Baseline: schema, roles' grants, and the identity tables.
 *
 * specs/identity/FEATURE_SPEC.md § Data Model and
 * specs/ARCHITECTURE.md § Data Conventions.
 *
 * Authentication is not implemented. `auth_subject` is the column a provider
 * will populate; until then a seeded row stands in and lib/session.ts resolves
 * to it. Every foreign key points at users.id — an application-generated
 * UUIDv7 — so adding a provider later is one column and one resolver rather
 * than a migration across every table.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create schema if not exists app`.execute(db);

  // An exclusion constraint mixing uuid equality with a range overlap needs
  // btree_gist; without it the goal-overlap constraint below cannot be created.
  await sql`create extension if not exists btree_gist`.execute(db);

  // --- enums ---------------------------------------------------------------
  // `source` is carried by every entry table (specs/ARCHITECTURE § Provenance).
  await sql`create type app.source as enum ('manual', 'agent', 'import', 'native_api')`.execute(db);
  await sql`create type app.mass_unit as enum ('kg', 'lb')`.execute(db);
  await sql`create type app.distance_unit as enum ('km', 'mi')`.execute(db);
  await sql`create type app.energy_unit as enum ('kcal', 'kj')`.execute(db);
  await sql`create type app.goal_kind as enum ('cut', 'bulk', 'maintain', 'recomp', 'performance')`.execute(db);

  // --- users ---------------------------------------------------------------
  await db.schema
    .withSchema("app")
    .createTable("users")
    .addColumn("id", "uuid", (c) => c.primaryKey())
    .addColumn("auth_subject", "text")
    .addColumn("email", "text", (c) => c.notNull())
    .addColumn("display_name", "varchar(120)")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("deleted_at", "timestamptz")
    .execute();

  await db.schema
    .withSchema("app")
    .createIndex("idx_users_auth_subject")
    .on("users")
    .column("auth_subject")
    .unique()
    .execute();

  await db.schema
    .withSchema("app")
    .createIndex("idx_users_email")
    .on("users")
    .column("email")
    .unique()
    .execute();

  // --- user_preferences ----------------------------------------------------
  // Units here are presentation only: changing mass_unit changes what is
  // rendered and parsed, and touches no other table (specs/identity § Flow 3).
  await db.schema
    .withSchema("app")
    .createTable("user_preferences")
    .addColumn("user_id", "uuid", (c) =>
      c.primaryKey().references("app.users.id").onDelete("cascade"),
    )
    .addColumn("timezone", "text", (c) => c.notNull().defaultTo("UTC"))
    .addColumn("mass_unit", sql`app.mass_unit`, (c) => c.notNull().defaultTo("kg"))
    .addColumn("body_mass_unit", sql`app.mass_unit`, (c) => c.notNull().defaultTo("kg"))
    .addColumn("distance_unit", sql`app.distance_unit`, (c) => c.notNull().defaultTo("km"))
    .addColumn("energy_unit", sql`app.energy_unit`, (c) => c.notNull().defaultTo("kcal"))
    .addColumn("week_starts_on", "smallint", (c) => c.notNull().defaultTo(1))
    .addColumn("locale", "text", (c) => c.notNull().defaultTo("en-GB"))
    .addColumn("agent_config", "jsonb", (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("week_starts_on_iso", sql`week_starts_on between 1 and 7`)
    .execute();

  // --- user_goals ----------------------------------------------------------
  // Goals are periodized rows, not mutable fields: a bodyweight chart is only
  // meaningful against what was being attempted at the time.
  await db.schema
    .withSchema("app")
    .createTable("user_goals")
    .addColumn("id", "uuid", (c) => c.primaryKey())
    .addColumn("user_id", "uuid", (c) =>
      c.notNull().references("app.users.id").onDelete("cascade"),
    )
    .addColumn("kind", sql`app.goal_kind`, (c) => c.notNull())
    .addColumn("effective_from", "date", (c) => c.notNull())
    .addColumn("effective_to", "date")
    .addColumn("target_body_mass_kg", sql`numeric(6,3)`)
    .addColumn("target_rate_kg_per_week", sql`numeric(4,3)`)
    .addColumn("note", "text")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("deleted_at", "timestamptz")
    .execute();

  await sql`
    create index idx_user_goals_user_effective
      on app.user_goals (user_id, effective_from desc)
  `.execute(db);

  // specs/identity Invariants 3 and 4, enforced by the database rather than by
  // the service layer — a race between two concurrent writes is exactly the
  // case a service-layer check misses.
  await sql`
    create unique index idx_user_goals_one_open
      on app.user_goals (user_id)
      where effective_to is null and deleted_at is null
  `.execute(db);

  await sql`
    alter table app.user_goals add constraint user_goals_no_overlap
      exclude using gist (
        user_id with =,
        daterange(effective_from, effective_to, '[]') with &&
      ) where (deleted_at is null)
  `.execute(db);

  // --- grants --------------------------------------------------------------
  // The app role is created by db/init (local) or by infrastructure (deployed).
  // Granting here keeps the migration the single source of truth for what the
  // runtime role may touch.
  await sql`grant usage on schema app to ${sql.raw(APP_ROLE)}`.execute(db);
  await sql`grant select, insert, update, delete on all tables in schema app to ${sql.raw(APP_ROLE)}`.execute(db);
  await sql`grant usage, select on all sequences in schema app to ${sql.raw(APP_ROLE)}`.execute(db);
  await sql`alter default privileges in schema app grant select, insert, update, delete on tables to ${sql.raw(APP_ROLE)}`.execute(db);
  await sql`alter default privileges in schema app grant usage, select on sequences to ${sql.raw(APP_ROLE)}`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.withSchema("app").dropTable("user_goals").ifExists().execute();
  await db.schema.withSchema("app").dropTable("user_preferences").ifExists().execute();
  await db.schema.withSchema("app").dropTable("users").ifExists().execute();
  await sql`drop type if exists app.goal_kind`.execute(db);
  await sql`drop type if exists app.energy_unit`.execute(db);
  await sql`drop type if exists app.distance_unit`.execute(db);
  await sql`drop type if exists app.mass_unit`.execute(db);
  await sql`drop type if exists app.source`.execute(db);
  await sql`drop schema if exists app cascade`.execute(db);
}
