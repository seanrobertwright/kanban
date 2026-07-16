// Provisions an agent identity and prints its bearer token ONCE.
//
// An agent is a workspace-scoped principal (009, PRD §8): it gets a row here, a
// role, and a token the MCP server presents as `x-agent-key`. Only the token's
// sha256 is stored, so this is the one moment the raw token exists — copy it now,
// it cannot be recovered.
//
// Plain .mjs to match migrate.mjs: bare node, --env-file loads .env.local, no
// TypeScript runner.
//
//   node --env-file=.env.local scripts/create-agent.mjs \
//     --workspace <slug|id> --name "Triage Bot" [--role member] [--image <url>]

import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const ROLES = new Set(["owner", "admin", "member", "viewer"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Bad argument near "${key}". Expected --flag value pairs.`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (expected in .env.local)");
  }

  const { workspace, name, role = "member", image } = parseArgs(
    process.argv.slice(2)
  );
  if (!workspace) throw new Error("--workspace <slug|id> is required");
  if (!name) throw new Error('--name "Agent Name" is required');
  if (!ROLES.has(role)) {
    throw new Error(`--role must be one of: ${[...ROLES].join(", ")}`);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    // Accept a slug or a raw id, so the operator can use whichever they have —
    // the slug is what they see in the URL, the id is what other scripts print.
    const { rows: wsRows } = await client.query(
      `SELECT id, name FROM workspace WHERE slug = $1 OR id = $1`,
      [workspace]
    );
    if (wsRows.length === 0) {
      throw new Error(`No workspace matches "${workspace}" (by slug or id).`);
    }
    const ws = wsRows[0];

    const id = randomUUID();
    // "kbn_" so the token is recognizable in a config file and greppable in logs
    // if one ever leaks. 32 bytes = 256 bits of entropy, which is why the store
    // can be a plain sha256 with no KDF (see agent-auth.ts).
    const token = `kbn_${randomBytes(32).toString("hex")}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");

    await client.query(
      `INSERT INTO agent (id, workspace_id, name, image, role, kind, token_hash)
       VALUES ($1, $2, $3, $4, $5, 'external', $6)`,
      [id, ws.id, name, image ?? null, role, tokenHash]
    );

    console.log(`\nCreated agent "${name}" (${role}) in workspace "${ws.name}".`);
    console.log(`  agent id: ${id}`);
    console.log(`\n  KANBAN_AGENT_KEY=${token}\n`);
    console.log("This token is shown once. Store it now — it cannot be recovered.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
