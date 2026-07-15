import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// There is a stray package-lock.json in C:\Users\seanr, and Turbopack's root
// inference picks the outermost lockfile it finds — so it treated the whole home
// directory as the project root. Pin it.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root: projectRoot },
  // pg resolves its driver through a dynamic require (and an optional pg-native
  // binding) that the bundler cannot trace. Keep it external.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
