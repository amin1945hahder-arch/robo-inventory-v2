"use node";

import { createClient } from "@libsql/client/http";

/**
 * The one place that knows how to reach Turso.
 *
 * IMPORTANT ARCHITECTURAL CONSTRAINT — this file must stay `"use node"`:
 * Convex `query` and `mutation` functions run in a V8 isolate with NO outbound
 * network access, so they cannot talk to Turso at all. Only `action` and
 * `httpAction` run in the node runtime and can. That is why moving the data
 * store to Turso means the read path has to go through node functions, and
 * why the client data layer will need to change (Convex's reactive `useQuery`
 * cannot subscribe to a database it does not host).
 *
 * Config (Keys tab):
 *   TURSO_DATABASE_URL  — libsql://<db>-<org>.turso.io
 *   TURSO_AUTH_TOKEN    — a token with write access
 */

export function tursoConfig() {
  const url = (process.env.TURSO_DATABASE_URL ?? "").trim();
  const authToken = (process.env.TURSO_AUTH_TOKEN ?? "").trim();
  if (!url) return { ok: false as const, problem: "TURSO_DATABASE_URL is not set" };
  if (!authToken) return { ok: false as const, problem: "TURSO_AUTH_TOKEN is not set" };
  if (!/^(libsql|https|wss):\/\//.test(url)) {
    return { ok: false as const, problem: "TURSO_DATABASE_URL is not a libsql/https URL" };
  }
  return { ok: true as const, url, authToken };
}

/** The SQL surface the data layer and the migration share. */
export type TursoSql = {
  execute(sql: string, args?: unknown[]): Promise<{ rows: unknown[] }>;
  executeBatch(statements: { sql: string; args: unknown[] }[]): Promise<void>;
};

let cached: { url: string; sql: TursoSql } | null = null;

/**
 * A Turso-backed executor, or a human-readable problem instead of throwing so
 * the UI can say which key is missing.
 */
export function tursoSql(): { sql: TursoSql | null; problem: string | null } {
  const cfg = tursoConfig();
  if (!cfg.ok) return { sql: null, problem: cfg.problem };

  // Reuse one client: it pools connections, and a migration issues thousands
  // of statements.
  if (!cached || cached.url !== cfg.url) {
    const db = createClient({
      url: cfg.url.replace(/^libsql:\/\//, "https://"),
      authToken: cfg.authToken,
    });
    cached = {
      url: cfg.url,
      sql: {
        async execute(sql: string, args: unknown[] = []) {
          const res = await db.execute({ sql, args: args as never });
          return { rows: res.rows as unknown[] };
        },
        // One HTTP round trip per N rows instead of per row.
        async executeBatch(statements) {
          if (statements.length === 0) return;
          await db.batch(
            statements.map((s) => ({ sql: s.sql, args: s.args as never })),
            "write",
          );
        },
      },
    };
  }
  return { sql: cached.sql, problem: null };
}