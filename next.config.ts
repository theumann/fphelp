import { networkInterfaces } from "node:os";

import type { NextConfig } from "next";

/**
 * This machine's own LAN addresses, so a phone on the same wifi can load the dev server.
 *
 * Next 16 blocks cross-origin requests to dev-only assets, which includes every JS chunk
 * and the HMR socket. Reaching `next dev` by LAN IP therefore serves HTML that never
 * hydrates: the page appears, and nothing on it works. The failure names the origin in the
 * server log and nowhere in the browser, so it reads as the app being broken.
 *
 * Computed rather than hardcoded because the address is handed out by DHCP and moves — it
 * changed under this project mid-session, which silently invalidated a sign-in link that
 * had the old address baked into it. Listing only this machine's addresses also keeps the
 * dev server closed to the rest of the network, which is the point of the block: on a
 * public wifi, `192.168.*.*` would invite anyone on it to read your source maps.
 */
function lanOrigins(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  // Dev-only by construction: Next ignores this outside `next dev`.
  allowedDevOrigins: lanOrigins(),

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
