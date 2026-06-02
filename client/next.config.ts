import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const STORAGE_URL = process.env.STORAGE_URL ?? "http://localhost:5000";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000", "localhost:3001", "localhost"] },
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
      {
        source: "/storage/:path*",
        destination: `${STORAGE_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
