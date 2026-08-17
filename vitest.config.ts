import { defineConfig } from 'vitest/config'

/**
 * Vitest owns `src/**`, Playwright owns `e2e/**`.
 *
 * Without this the two collide: Vitest's default glob picks up `e2e/*.spec.ts`, and
 * Playwright's `test()` refuses to run under another runner — so `npm test` fails on a
 * suite it was never meant to execute. The boundary is stated here rather than left to
 * whichever default happens to win.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**', '.next-e2e/**'],
  },
})
