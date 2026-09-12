import type { NextConfig } from "next";

/**
 * `output: "standalone"` traces the minimal node_modules for the Docker image
 * (see Dockerfile, runtime stage). It is meaningless on Vercel, which builds
 * its own serverless output — and asking that builder for a standalone server
 * it is going to discard is at best wasted work and at worst a build failure.
 *
 * So it is set only when NOT building on Vercel.
 */
const isVercel = Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isVercel ? {} : { output: "standalone" as const }),
};

export default nextConfig;
