import "dotenv/config";
import { formatError } from "../lib/errors";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

/**
 * One command to get a working local environment, in dependency order.
 *
 * The ordering is the point: roles must exist before migrations run (the
 * baseline grants to the app role), and migrations before the seed. Doing any
 * of it out of order fails in a way that reads as a permissions bug.
 */
const step = (name: string) => console.log(`\n→ ${name}`);

function run(cmd: string, args: string[]) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

async function waitForPostgres(timeoutMs = 60_000) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL is not set.");

  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (err) {
      lastError = formatError(err);
      await client.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Postgres did not become ready in ${timeoutMs / 1000}s: ${lastError}`);
}

async function waitForStorage(timeoutMs = 60_000) {
  const endpoint = process.env.STORAGE_ENDPOINT ?? "http://localhost:9000";
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      // MinIO's unauthenticated liveness probe. Cheaper and more reliable than
      // shelling out to `mc`, which needs an alias configured first.
      const res = await fetch(`${endpoint}/minio/health/live`);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = formatError(err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Storage did not become ready in ${timeoutMs / 1000}s: ${lastError}`);
}

async function main() {
  step("starting containers");
  run("docker", ["compose", "up", "-d"]);

  step("waiting for Postgres");
  await waitForPostgres();
  console.log("  ready");

  step("waiting for object storage");
  await waitForStorage();
  console.log("  ready");

  step("ensuring local roles");
  run("pnpm", ["db:roles"]);

  step("running migrations");
  run("pnpm", ["db:migrate:latest"]);

  step("initialising object storage");
  run("pnpm", ["storage:init"]);

  step("seeding");
  run("pnpm", ["db:seed"]);

  console.log("\nready. `pnpm dev` to start the app.");
}

main().catch((err) => {
  console.error("\ndev:all failed:", formatError(err));
  process.exit(1);
});
