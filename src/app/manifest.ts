import type { MetadataRoute } from 'next'

/**
 * Web app manifest, so the owner can keep the app one tap away on a phone or desktop.
 *
 * **`display: 'standalone'` here is for Android only, and iOS is opted out separately.**
 *
 * The two platforms behave differently in the one way that matters to magic-link auth:
 *
 * - **Android** installs a WebAPK that **shares Chrome's cookie jar**. The session created
 *   by tapping a link in Gmail is the same session the installed app sees, so standalone
 *   is free — a clean icon with no browser badge, a real "Install app" prompt, and its own
 *   entry in the app switcher.
 * - **iOS** gives an installed web app **its own cookie storage, separate from Safari's**.
 *   The owner taps the link in Mail, it opens in Safari, the session lands there, and the
 *   installed app stays signed out with no way out from inside — asking for a fresh link
 *   just opens Safari again. A chrome-less app permanently showing a sign-in screen.
 *
 * So iOS is told not to do this, via `apple-mobile-web-app-capable: no` in `layout.tsx`,
 * which is the documented opt-out and takes precedence over this `display` value. iOS then
 * keeps opening the home-screen icon in Safari, where the session already is. **Both
 * halves are required** — dropping either one re-creates the trap on iPhones.
 *
 * Revisit if auth stops depending on a link opened in an external browser, or if iOS ever
 * shares storage between Safari and installed web apps.
 *
 * The icons are the same files Next already serves by convention from `src/app/` —
 * referenced by their served paths, not re-exported, so `npm run build:logo` remains the
 * single source for every icon in the project.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FPheLp',
    short_name: 'FPheLp',
    description: 'Fantasy league updates for the owner to send',
    start_url: '/',
    display: 'standalone',
    /**
     * Matches `--background` in globals.css, and the light-scheme `themeColor` in
     * layout.tsx. A manifest cannot express a scheme-dependent colour the way the
     * `<meta>` tags can, so this is the light value: it is only read while the app
     * launches, and a light flash is less jarring than a dark one on a light phone.
     */
    background_color: '#fbfbfc',
    theme_color: '#fbfbfc',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
