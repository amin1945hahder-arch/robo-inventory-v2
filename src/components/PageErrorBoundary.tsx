import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Page-level guard: a crash in one route renders a recoverable panel with
 *  the error message instead of a dead app. "Try again" remounts the subtree. */
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
        <div className="mx-auto my-10 flex max-w-lg flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-10 text-center">
          <AlertTriangle className="size-6 text-destructive" />
          <p className="text-sm font-semibold">This page hit an error</p>
          <p className="break-words text-xs text-muted-foreground">{this.state.error.message}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload app
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
