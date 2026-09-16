import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  /**
   * The origin every URL-based metadata field is resolved against, including the
   * `opengraph-image.png` Next picks up from this directory. Without it, a relative
   * metadata URL is a **build error**, not a silent fallback.
   *
   * A literal for the same reason the Sentry org and project are literals in
   * `next.config.ts`: a public hostname is not a secret, and this file should state where
   * the app lives rather than leaving that answer in a dashboard. `AUTH_URL` is not usable
   * here — it is deliberately unset in local development, so reading it would make the
   * value `undefined` on exactly the machine where the card is being worked on.
   */
  metadataBase: new URL("https://fphelp.app"),
  title: "FPheLp",
  description: "Fantasy league updates for the owner to send",
  /**
   * The link preview, for when the address is shared in a chat or linked from elsewhere.
   *
   * Wording is copied from `title`/`description` rather than reworded, so the manifest,
   * the `<meta name="description">` and the card all say one thing. The image is not
   * listed here: `opengraph-image.png` in this directory is a file convention, and Next
   * emits `og:image` with its type and dimensions automatically.
   */
  openGraph: {
    type: "website",
    siteName: "FPheLp",
    title: "FPheLp",
    description: "Fantasy league updates for the owner to send",
    url: "/",
    locale: "en_GB",
  },
  /**
   * No `twitter-image` file, deliberately. Twitter falls back to `og:image` when none is
   * given, so a second copy of the same 1200x630 PNG would be bytes in the repo to say
   * what the card already says. `summary_large_image` is what makes it render full-width
   * instead of as a thumbnail.
   */
  twitter: {
    card: "summary_large_image",
    title: "FPheLp",
    description: "Fantasy league updates for the owner to send",
  },
  // `icon.png` and `apple-icon.png` in this directory are picked up by convention.
  applicationName: "FPheLp",
  /**
   * iOS is explicitly opted OUT of standalone launch, and this used to be `capable: true`.
   *
   * `apple-mobile-web-app-capable: yes` makes iOS launch a home-screen icon as an
   * installed web app, which gets cookie storage separate from Safari's. Auth here is a
   * magic link that opens in Mail and therefore in Safari, so the session would land in
   * the browser while the installed app stayed signed out — unrecoverably, since asking
   * for a new link from inside it just opens Safari again.
   *
   * The manifest sets `display: 'standalone'` for **Android**, where an installed WebAPK
   * shares Chrome's cookies and none of the above applies. This tag is what keeps that
   * from reaching iPhones: newer iOS reads the manifest's `display`, so relying on the
   * absence of this tag is not enough — it is set to `no` deliberately, not omitted.
   *
   * **Both halves are required.** Remove this and iPhones inherit the trap; remove the
   * manifest's `standalone` and Android loses the install prompt for no reason.
   *
   * Anyone who added the icon to their home screen before this keeps the old behaviour
   * until they remove and re-add it.
   *
   * Written through `other` rather than `appleWebApp: { capable: false }` because that
   * option **omits** the tag instead of emitting `no` — verified against the rendered
   * HTML, which carried only `apple-mobile-web-app-status-bar-style`. Omission is not an
   * opt-out once the manifest asks for standalone, so the value has to be stated.
   */
  appleWebApp: false,
  other: { "apple-mobile-web-app-capable": "no" },
};

/**
 * `themeColor` follows the scheme, so the browser and iOS status bar match the page
 * instead of framing a dark app in a white bar. Values are `--background` from
 * globals.css; they have to be literals here, since this is read before any CSS is.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  // The composer's send bar sits against the bottom edge, so the page has to own the
  // area behind the home indicator rather than letting the browser letterbox it.
  viewportFit: "cover",
};

/**
 * Deliberately renders no nav.
 *
 * It used to, and the nav worked out its own links from the pathname — which put a league
 * bar on pages that had no league, including the 404 for a league that does not exist,
 * where all three links 404ed in turn. The nav now belongs to whoever can vouch for the
 * league: `src/app/l/[leagueId]/layout.tsx` for a real one, `/` for the chooser's reduced
 * bar. Anything else — `/signin`, `not-found` — correctly gets none.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
