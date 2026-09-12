import "dotenv/config";
import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { env } from "../lib/env";
import { s3Client } from "../lib/storage";

/**
 * Create the bucket if it is missing.
 *
 * This replaces a `minio/mc` sidecar: it uses the S3 client the app already
 * depends on, so it behaves identically against MinIO, S3 and R2, and there is
 * no second container image to keep pinned.
 */
async function main() {
  const Bucket = env.storage.bucket;
  try {
    await s3Client().send(new HeadBucketCommand({ Bucket }));
    console.log(`bucket "${Bucket}" already exists`);
    return;
  } catch {
    // Fall through — a 404 here is the expected first-run case.
  }

  await s3Client().send(new CreateBucketCommand({ Bucket }));
  console.log(`bucket "${Bucket}" created at ${env.storage.endpoint}`);
}

main().catch((err) => {
  console.error("storage init failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
