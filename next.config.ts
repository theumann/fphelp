import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  /**
   * Build output location, overridable for the end-to-end suite.
   *
   * Playwright builds and serves the app itself. Writing that into `.next` would stamp
   * on the dev server a developer almost certainly has running in the same directory —
   * Next allows only one dev server per directory, and they share this folder. A separate
   * `.next-e2e` lets the suite run without anyone having to stop working first.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
