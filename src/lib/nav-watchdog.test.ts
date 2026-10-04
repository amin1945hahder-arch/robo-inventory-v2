// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MAX_STALL_REMOUNTS,
  evaluate,
  fingerprintFromText,
  initialState,
  onNavigate,
} from "./nav-watchdog";

/** Arm the watchdog as if we navigated from "/a" to "/b". */
function armed(settled = "page-a") {
  return onNavigate(onNavigate(initialState(), "/a", settled), "/b", "page-b");
}

describe("fingerprintFromText", () => {
  it("ignores whitespace-only differences", () => {
    expect(fingerprintFromText("Inventory\n  Parts")).toBe(
      fingerprintFromText("Inventory Parts"),
    );
  });

  it("distinguishes different pages", () => {
    expect(fingerprintFromText("Inventory page")).not.toBe(
      fingerprintFromText("Closets page"),
    );
  });

  it("treats empty content as one stable value", () => {
    expect(fingerprintFromText("")).toBe("empty");
    expect(fingerprintFromText(null)).toBe("empty");
    expect(fingerprintFromText(undefined)).toBe("empty");
  });

  it("is sensitive to content beyond the sampled head", () => {
    const base = "x".repeat(500);
    expect(fingerprintFromText(base)).not.toBe(fingerprintFromText(`${base}y`));
  });
});

describe("onNavigate", () => {
  it("captures a baseline on the first render and stays disarmed", () => {
    const s = onNavigate(initialState(), "/a", "print-a");
    expect(s).toEqual({ path: "/a", settled: "print-a", stalls: 0, ready: true, armed: false });
  });

  it("arms on a path change but keeps the previous baseline", () => {
    // The new screen must be compared against the screen it replaced.
    const s = armed();
    expect(s.armed).toBe(true);
    expect(s.settled).toBe("page-a");
    expect(s.stalls).toBe(0);
  });

  it("changes nothing when the same path re-renders", () => {
    // The effect re-runs after a remount; resetting here would reset the
    // ladder and loop forever on a genuinely stuck page.
    const stuck = { path: "/b", settled: "x", stalls: 2, ready: true, armed: true };
    expect(onNavigate(stuck, "/b", "whatever")).toBe(stuck);
  });
});

describe("evaluate", () => {
  it("never fires on the first load (nothing to verify)", () => {
    const mounted = onNavigate(initialState(), "/a", "page-a");
    // Same screen at settle time — perfectly normal, must not be a stall.
    expect(evaluate(mounted, "page-a")).toEqual({ action: "wait", state: mounted });
  });

  it("does not fire when the navigation rendered the new page", () => {
    const { action, state } = evaluate(armed(), "page-b");
    expect(action).toBe("wait");
    expect(state.settled).toBe("page-b");
    expect(state.armed).toBe(false);
  });

  it("escalates to remount when the screen never changed", () => {
    const { action, state } = evaluate(armed(), "page-a");
    expect(action).toBe("remount");
    expect(state.stalls).toBe(1);
  });

  it("remounts up to the limit, then reloads", () => {
    let state = armed();
    const actions: string[] = [];
    for (let i = 0; i < MAX_STALL_REMOUNTS + 1; i++) {
      const result = evaluate(state, "page-a");
      actions.push(result.action);
      state = result.state;
    }
    expect(actions.slice(0, MAX_STALL_REMOUNTS)).toEqual(
      Array(MAX_STALL_REMOUNTS).fill("remount"),
    );
    expect(actions[MAX_STALL_REMOUNTS]).toBe("reload");
  });

  it("disarms after recovery so a healthy page is never escalated again", () => {
    const recovered = evaluate(armed(), "page-b").state;
    expect(evaluate(recovered, "page-b").action).toBe("wait");
  });
});