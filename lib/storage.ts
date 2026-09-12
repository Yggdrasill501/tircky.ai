import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { env } from "./env";

/**
 * S3-compatible object storage. MinIO locally, S3 or R2 in production — the
 * same client and the same code path, which is the whole reason MinIO is in
 * the compose stack rather than a local directory.
 *
 * `forcePathStyle` is required for MinIO: virtual-host addressing needs
 * wildcard DNS that a container on a compose network does not have.
 */
let _s3: S3Client | undefined;

export function s3Client(): S3Client {
  _s3 ??= new S3Client({
    endpoint: env.storage.endpoint,
    region: env.storage.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.storage.accessKey,
      secretAccessKey: env.storage.secretKey,
    },
  });
  return _s3;
}

const bucket = () => env.storage.bucket;

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string | Readable,
  contentType?: string,
): Promise<void> {
  await s3Client().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObjectStream(key: string): Promise<Readable> {
  const res = await s3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!res.Body) throw new Error(`Object not found: ${key}`);
  return res.Body as Readable;
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/**
 * A short-lived URL for the browser. Artifacts and capture images are never
 * inlined into a response and the bucket is never public — see
 * specs/analysis-sandbox § Artifact allowlist.
 */
export async function signedUrl(key: string, ttlSeconds = 900): Promise<string> {
  return getSignedUrl(s3Client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: ttlSeconds,
  });
}

export async function storageReady(): Promise<boolean> {
  try {
    await s3Client().send(new HeadBucketCommand({ Bucket: bucket() }));
    return true;
  } catch {
    return false;
  }
}
