import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { ThemeProvider } from "@/shared/theme/theme-provider";

// Self-hosted (src/app/fonts/*.woff2), not next/font/google: the build no longer
// reaches out to Google Fonts, so it is reproducible and works offline.
//
// Two faces, not four. The neon-grid design language originally set Rajdhani
// for UI text and Share Tech Mono for data, which is two display faces doing
// the work of one text face — Rajdhani is condensed and narrow at the 13px this
// app renders most of its interface at, and a condensed display face is the
// single loudest "not enterprise software" signal a UI can send. Geist is a
// neutral text face with a matching mono, and the pair carries everything.
//
// Orbitron survives for exactly one thing: the brand mark. A display face on a
// wordmark is identity; the same face on a dialog heading is costume.
const geist = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
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
      className={`${geist.variable} ${geistMono.variable} ${orbitron.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
