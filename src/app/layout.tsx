import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { ThemeProvider } from "@/shared/theme/theme-provider";

// Self-hosted (src/app/fonts/*.woff2), not next/font/google: the build no longer
// reaches out to Google Fonts, so it is reproducible and works offline. Single
// variable files cover the whole 100–900 weight range.
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
