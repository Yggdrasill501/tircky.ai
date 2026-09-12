import "dotenv/config";
import { execFileSync } from "node:child_process";
import { APP_SCHEMA } from "../lib/db/search-path";

/**
 * Regenerate lib/db/types.ts from the live database.
 *
 * Reads the schema as the OWNER — the app role cannot see everything it needs
 * to introspect. The generated file is committed, and CI fails if running this
 * produces a diff, which is what keeps the committed types in step with the
 * migrations.
 */
const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_ADMIN_URL is not set.");
  process.exit(1);
}

// --default-schema is the ONE schema whose prefix is stripped from the
// generated DB keys, so tables come out as `users` rather than `"app.users"`.
// That is a different thing from the runtime search path, which is why this
// takes APP_SCHEMA and not SEARCH_PATH: passing the whole path matches nothing
// and every key stays qualified.
execFileSync(
  "kysely-codegen",
  [
    "--url", url,
    "--out-file", "lib/db/types.ts",
    "--dialect", "postgres",
    "--camel-case",
    "--default-schema", APP_SCHEMA,
  ],
  { stdio: "inherit" },
);

console.log("types written to lib/db/types.ts");
