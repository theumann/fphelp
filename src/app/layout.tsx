import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { auth } from "@/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FPheLp",
  description: "Fantasy league updates for the owner to send",
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read here rather than in Nav, which is a client component for `usePathname`.
  const session = await auth();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Nav who={session?.user?.email} />
        {children}
      </body>
    </html>
  );
}
