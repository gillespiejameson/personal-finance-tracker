import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Statement text is posted to `commitFile` as a server-action argument; the
  // default 1 MB body limit would reject files the 5 MB dropzone guard allows.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
