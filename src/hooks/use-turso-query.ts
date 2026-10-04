import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Read from Turso.
 *
 * This is the client half of "Turso is the database". Convex's `useQuery`
 * subscribes to Convex's own reactive query system — it cannot follow a
 * database Convex does not host, so a Turso-backed read has to be an action
 * plus a poll. `useAction` + this hook keeps the same call-site shape
 * (`const rows = useTursoQuery("groups", { limit: 50 })`) so pages migrate
 * one at a time instead of all at once.
 *
 * Defaults are deliberately conservative: a 15s poll keeps the console
 * feeling live without hammering the database, and a refetch on window focus
 * means a member who switches back to the preview sees current data at once.
 */

export type TursoFilter = Record<string, string | number | boolean>;

export type TursoQueryOptions = {
  filter?: TursoFilter;
  orderBy?: string;
  limit?: number;
  /** Poll interval in ms. 0 disables polling (for data that never changes). */
  pollMs?: number;
  /** Skip the request entirely (e.g. not signed in yet). */
  enabled?: boolean;
};

const DEFAULT_POLL_MS = 15_000;

export function useTursoQuery<T = Record<string, unknown>>(
  table: string,
  options: TursoQueryOptions = {},
): {
  data: T[] | undefined;
  error: string | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
} {
  const run = useAction(api.tursoRepo.query);
  const [data, setData] = useState<T[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const enabled = options.enabled !== false;

  // Keep the latest request options without making them part of the effect
  // identity — otherwise an inline `filter` object would restart the poll on
  // every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const refresh = useCallback(async () => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    try {
      const rows = await run({
        table,
        filter: optionsRef.current.filter,
        orderBy: optionsRef.current.orderBy,
        limit: optionsRef.current.limit,
      });
      setData(rows as T[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [run, table, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refetch when the member comes back to the tab. Independent of polling:
  // even a query that never polls should catch up on focus.
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, enabled]);

  useEffect(() => {
    if (!enabled || pollMs <= 0) return;
    const id = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(id);
  }, [refresh, pollMs, enabled]);

  return { data, error, isLoading, refresh };
}