import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone/server.js so the container runs a plain node
  // process (instrumentation.ts cron lives in it).
  output: "standalone",
};

export default nextConfig;
