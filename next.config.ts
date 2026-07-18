import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// There is a stray package-lock.json in C:\Users\seanr, and Turbopack's root
// inference picks the outermost lockfile it finds — so it treated the whole home
// directory as the project root. Pin it.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Emit .next/standalone: a minimal server.js + only the node_modules the
  // routes actually trace. Lets the prod image ship without a full install.
  output: "standalone",
  turbopack: { root: projectRoot },
  // Same stray ~/package-lock.json trap as turbopack.root: output-file tracing
  // would otherwise walk up to the home dir and drag half of it into the
  // standalone bundle. Pin the trace root to this project.
  outputFileTracingRoot: projectRoot,
  // pg resolves its driver through a dynamic require (and an optional pg-native
  // binding) that the bundler cannot trace. Keep it external.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
