/**
 * Environment access, resolved lazily.
 *
 * Deliberately NOT validated at import time. A module that throws on import is
 * hostile to anything that merely loads it — `next build` collects page data by
 * importing every route, so an import-time throw turns a missing variable into
 * a failed build inside a container that was never going to connect to
 * anything. Resolving on first property access keeps the error where it is
 * useful (the first real call) and keeps the build honest.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get adminDatabaseUrl() {
    return process.env.DATABASE_ADMIN_URL ?? required("DATABASE_URL");
  },
  storage: {
    get endpoint() {
      return optional("STORAGE_ENDPOINT", "http://localhost:9000");
    },
    get region() {
      return optional("STORAGE_REGION", "us-east-1");
    },
    get bucket() {
      return optional("STORAGE_BUCKET", "tricky");
    },
    get accessKey() {
      return required("STORAGE_ACCESS_KEY");
    },
    get secretKey() {
      return required("STORAGE_SECRET_KEY");
    },
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
} as const;

/** Storage prefixes, per specs/ARCHITECTURE.md § Storage layout. */
export const prefix = {
  imports: (userId: string, batchId: string) => `imports/${userId}/${batchId}/`,
  artifacts: (userId: string, jobId: string) => `artifacts/${userId}/${jobId}/`,
  captures: (userId: string, captureId: string) => `captures/${userId}/${captureId}/`,
  skills: (owner: string, skillId: string) => `skills/${owner}/${skillId}/`,
} as const;
