import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Gallery images are up to 5 MB; the default Server Action body limit is 1 MB.
    // 6 MB leaves room for multipart overhead. The upload action still enforces 5 MB itself.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
