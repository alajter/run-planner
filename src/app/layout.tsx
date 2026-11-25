import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist } from "next/font/google";
import "./globals.css";
import { Tabs } from "./tabs";

// Geist for everything, figures tabular; self-hosted by next/font at build time
const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Run Planner",
  description: "My plan, my runs, my progress.",
  appleWebApp: { capable: true, title: "Run Planner", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0b0b0c" }, { media: "(prefers-color-scheme: light)", color: "#fafaf9" }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("theme")?.value;
  return (
    <html lang="en" className={sans.variable} data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body>
        {process.env.DEMO === "1" && <p className="small muted" style={{ textAlign: "center", margin: "8px 16px 0" }}>Demo: a made-up runner, not a real person.</p>}
        {children}
        <Tabs />
      </body>
    </html>
  );
}
