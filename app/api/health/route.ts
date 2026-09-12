import { sql } from "kysely";
import { getKysely, poolMetrics } from "@/lib/db/client";
import { storageReady } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Readiness, not liveness. It reports whether the app can actually do its job —
 * reach Postgres and reach the bucket — so the compose healthcheck and any load
 * balancer fail it when a dependency is down, rather than routing traffic to a
 * process that is up but useless.
 */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};

  try {
    await sql`select 1`.execute(getKysely());
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }

  checks.storage = (await storageReady()) ? "ok" : "fail";

  const healthy = Object.values(checks).every((v) => v === "ok");

  return Response.json(
    { status: healthy ? "ok" : "degraded", checks, pools: poolMetrics() },
    { status: healthy ? 200 : 503 },
  );
}
