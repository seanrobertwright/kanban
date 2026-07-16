import pg from "pg";
import type { PoolClient, QueryResultRow } from "pg";

// TIMESTAMPTZ arrives as a JS Date by default. Our types say `createdAt: string`,
// and a Date would serialize differently through a route handler's Response.json
// than through the RSC boundary. Parsing to ISO here keeps both paths identical.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (value) =>
  new Date(value).toISOString()
);

// DATE would otherwise arrive as a JS Date too, and for task.due_date (006) that
// is not a cosmetic difference — it is an off-by-one waiting to happen.
//
// node-postgres parses '2026-07-17' into a Date at *local* midnight. Serialize
// that through Response.json and you get the local midnight expressed in UTC:
// west of Greenwich it survives (2026-07-17T04:00:00Z), east of it the date
// moves (2026-07-16T15:00:00Z in UTC+9). So a due date entered in Tokyo would
// come back a day early — from the database's point of view, correctly. The
// value was never an instant; making it one is what introduces the bug.
//
// Returning the raw string keeps a DATE a date all the way to the client, where
// it is compared and rendered as 'YYYY-MM-DD' and never handed to a Date
// constructor. This is global rather than a to_char() in each SELECT precisely
// so it also covers the queries nobody has written yet.
//
// It assumes DateStyle is ISO, which is the Postgres default and what the
// container in docker-compose.yml runs. The TIMESTAMPTZ parser above already
// takes the same class of dependency on the server's text output.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

function createPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (expected in .env.local)");
  }
  return new pg.Pool({ connectionString, max: 10 });
}

// Cache the pool on globalThis so dev-server hot reloads reuse it instead of
// leaking a new pool (and its sockets) on every reload.
const globalForDb = globalThis as unknown as { kanbanPool?: pg.Pool };

export const pool = globalForDb.kanbanPool ?? (globalForDb.kanbanPool = createPool());

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

/**
 * Runs `fn` on a single checked-out connection wrapped in BEGIN/COMMIT.
 *
 * Multi-statement transactions must not use the pool directly: each pool.query
 * may land on a different connection, so the BEGIN and the writes would end up
 * on different sessions and the transaction would silently do nothing.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
