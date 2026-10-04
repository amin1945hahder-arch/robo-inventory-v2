import React from "react";
import { Link } from "react-router";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Page-level guard: a crash in one route renders a recoverable panel with
 * the error message instead of a dead app.
 *
 * This boundary wraps <Routes> in src/main.tsx, so it also replaces the
 * sidebar when a page throws — which used to strand the user on a dead panel
 * whose only escape was a full browser reload. The panel therefore always
 * offers an in-app way out: "Try again" (remount this subtree) and a link to
 * a known-good route, so recovering never needs the browser refresh button.
 */
export class PageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(err: Error) {
    console.error("[PageErrorBoundary]", err);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto my-10 flex max-w-lg flex-col items-center gap-3 glass-3d rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-10 text-center">
          <AlertTriangle className="size-6 text-destructive" />
          <p className="text-sm font-semibold">This page hit an error</p>
          <p className="break-words text-xs text-muted-foreground">{this.state.error.message}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
              <RotateCcw className="size-3.5" />
              Try again
            </Button>
            {/* Recover without touching the browser: a client-side route change
                remounts the boundary (it is keyed by pathname) with fresh
                state, so the app comes back on its own. */}
            <Button size="sm" asChild>
              <Link to="/dashboard">
                <Home className="size-3.5" />
                Back to the app
              </Link>
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}