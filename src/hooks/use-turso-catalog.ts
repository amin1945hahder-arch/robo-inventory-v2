import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Turso-backed catalog reads.
 *
 * Same polling model as `useTursoQuery` (Turso is not hosted by Convex, so
 * there is nothing to subscribe to), but typed for the catalog rows so pages
 * keep the shape they had.
 */

/**
 * Row types come from Convex's OWN data model on purpose.
 *
 * Turso stores the same documents, and `_id` in SQLite IS the Convex document
 * id. Reusing `Doc<"closets">` / `Doc<"groups">` means a page that mixes a
 * migrated read with a not-yet-migrated Convex mutation (which still demands
 * `Id<"closets">`) keeps typechecking, so tables can move one at a time.
 */
import type { Doc } from "@/convex/_generated/dataModel";

export type TursoCloset = Doc<"closets">;
export type TursoGroup = Doc<"groups">;

const POLL_MS = 15_000;

/**
 * One polling reader, shared by the catalog hooks.
 *
 * The request is kept in a ref so an inline options object (e.g. `{ search }`
 * written in JSX) cannot restart the poll on every render.
 */
function usePollingAction<T>(
  run: ReturnType<typeof useAction>,
  buildArgs: () => Record<string, unknown>,
): { data: T | undefined; error: string | null; isLoading: boolean; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const argsRef = useRef(buildArgs);
  argsRef.current = buildArgs;

  const refresh = useCallback(async () => {
    try {
      setData((await run(argsRef.current())) as T);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [run]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { data, error, isLoading, refresh };
}

export function useTursoClosets() {
  const run = useAction(api.tursoCatalog.listClosets);
  return usePollingAction<TursoCloset[]>(run, () => ({}));
}

export function useTursoGroups(
  args: { closetId?: string; categoryId?: string; search?: string } = {},
) {
  const run = useAction(api.tursoCatalog.listGroups);
  return usePollingAction<TursoGroup[]>(run, () => ({
    closetId: args.closetId,
    categoryId: args.categoryId,
    search: args.search,
  }));
}