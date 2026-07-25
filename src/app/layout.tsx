import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { ThemeProvider } from "@/shared/theme/theme-provider";

// Self-hosted (src/app/fonts/*.woff2), not next/font/google: the build no longer
// reaches out to Google Fonts, so it is reproducible and works offline.
// The neon-grid design language (docs/Kanban tool design synthesis) uses three
// faces: Rajdhani for UI text, Share Tech Mono for data/labels, Orbitron for
// brand headings. Rajdhani has no variable release, so its four weights are
// separate static files.
const rajdhani = localFont({
  src: [
    { path: "./fonts/Rajdhani-400.woff2", weight: "400" },
    { path: "./fonts/Rajdhani-500.woff2", weight: "500" },
    { path: "./fonts/Rajdhani-600.woff2", weight: "600" },
    { path: "./fonts/Rajdhani-700.woff2", weight: "700" },
  ],
  variable: "--font-rajdhani",
  display: "swap",
});

const shareTechMono = localFont({
  src: "./fonts/ShareTechMono-400.woff2",
  variable: "--font-share-tech-mono",
  weight: "400",
  display: "swap",
});

const orbitron = localFont({
  src: "./fonts/Orbitron-Variable.woff2",
  variable: "--font-orbitron",
  weight: "400 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kanban Board",
  description: "A drag-and-drop kanban todo app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${rajdhani.variable} ${shareTechMono.variable} ${orbitron.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
