import { describe, expect, it, vi } from "vitest";
import {
  createStaleWatcher,
  isDynamicImportFailure,
  moduleFingerprint,
} from "./dev-reload";

/** Deterministic poll driver: run `check()` N times by hand, no timers. */
function harness(initial: string | null) {
  let text = initial;
  let clock = 0;
  const reload = vi.fn();
  const watcher = createStaleWatcher({
    load: async () => text,
    reload,
    now: () => clock,
    intervalMs: 1000,
    settleMs: 1000,
  });
  return {
    watcher,
    reload,
    advance: (ms: number) => {
      clock += ms;
    },
    set: (next: string | null) => {
      text = next;
    },
  };
}

describe("isDynamicImportFailure", () => {
  it("recognises the browser's lazy-chunk failure wording", () => {
    expect(
      isDynamicImportFailure(
        "Failed to fetch dynamically imported module: https://x/src/pages/Foo.tsx",
      ),
    ).toBe(true);
    expect(isDynamicImportFailure("Importing a module script failed.")).toBe(true);
  });

  it("ignores ordinary page errors", () => {
    expect(isDynamicImportFailure("Cannot read properties of null")).toBe(false);
    expect(isDynamicImportFailure("")).toBe(false);
  });
});

describe("moduleFingerprint", () => {
  it("changes with the content and not with its identity", () => {
    expect(moduleFingerprint("a")).toBe(moduleFingerprint("a"));
    expect(moduleFingerprint("a")).not.toBe(moduleFingerprint("b"));
  });
});

describe("stale-bundle watcher", () => {
  it("takes the first poll as the baseline and never reloads for it", async () => {
    const h = harness("original");
    expect(await h.watcher.check()).toBe("baseline");
    expect(h.reload).not.toHaveBeenCalled();

    h.advance(5000);
    expect(await h.watcher.check()).toBe("unchanged");
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("reloads once the entry module changes", async () => {
    const h = harness("original");
    await h.watcher.check();

    h.set("edited by me");
    h.advance(2000);
    expect(await h.watcher.check()).toBe("unchanged"); // change noticed, settling
    h.advance(2000);
    expect(await h.watcher.check()).toBe("reloading");
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.watcher.reloaded()).toBe(true);
  });

  it("reloads at most once, even if polled again", async () => {
    const h = harness("original");
    await h.watcher.check();
    h.set("edited");
    h.advance(2000);
    await h.watcher.check();
    h.advance(2000);
    await h.watcher.check();
    expect(h.reload).toHaveBeenCalledTimes(1);

    h.advance(5000);
    expect(await h.watcher.check()).toBe("skipped");
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload while an edit is still settling", async () => {
    const h = harness("original");
    await h.watcher.check();

    // File written in two bursts 500ms apart: never stable, so never reloads.
    h.set("half-written");
    h.advance(500);
    await h.watcher.check();
    h.set("fully-written");
    h.advance(500);
    await h.watcher.check();
    expect(h.reload).not.toHaveBeenCalled();

    h.advance(2000);
    await h.watcher.check();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the module cannot be read", async () => {
    const h = harness(null);
    expect(await h.watcher.check()).toBe("skipped");
    expect(h.reload).not.toHaveBeenCalled();

    // A reachable server again: still only a baseline, no reload.
    h.set("original");
    expect(await h.watcher.check()).toBe("baseline");
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("never reloads because the poll itself threw", async () => {
    const reload = vi.fn();
    const watcher = createStaleWatcher({
      load: async () => {
        throw new Error("network down");
      },
      reload,
    });
    expect(await watcher.check()).toBe("skipped");
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps polling on its own schedule and stops on demand", async () => {
    const timers: (() => void)[] = [];
    const reload = vi.fn();
    const watcher = createStaleWatcher({
      load: async () => "same",
      reload,
      schedule: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      cancel: () => {},
      intervalMs: 1000,
    });
    // The next poll is queued from a promise callback, so let microtasks run.
    const flush = () => new Promise((r) => setTimeout(r, 0));

    watcher.start();
    await flush();
    expect(timers).toHaveLength(1);
    timers.pop()!();
    await flush();
    expect(timers).toHaveLength(1);

    watcher.stop();
    // After stop(), firing the queued poll must NOT queue another one.
    timers.pop()!();
    await flush();
    expect(timers).toHaveLength(0);
    expect(reload).not.toHaveBeenCalled();
  });
});