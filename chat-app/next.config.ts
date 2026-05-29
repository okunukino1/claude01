import type { NextConfig } from "next";

// ビルド時のコミットSHA。Renderは RENDER_GIT_COMMIT を自動で渡す。
const COMMIT_SHA =
  process.env.RENDER_GIT_COMMIT ||
  process.env.COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  'dev'

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "@prisma/adapter-libsql", "web-push"],
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_COMMIT: COMMIT_SHA,
  },
};

export default nextConfig;
