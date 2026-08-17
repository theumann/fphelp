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
  appleWebApp: { capable: true, title: "FPheLp", statusBarStyle: "default" },
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
