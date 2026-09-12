import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Traces the exact node_modules the server needs, so the runtime image
  // carries neither the toolchain nor the source tree.
  output: "standalone",
};

export default nextConfig;
