import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LoadingGif } from "@/components/LoadingGif";
import { Link } from "react-router";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Route guard for modules students must not open (inventory, admin areas).
 * Backend functions enforce the same rule server-side; this only avoids
 * error-boundary flashes in the UI.
 */
export function RequireNonStudent({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-transparent">
        <LoadingGif size={56} label={null} />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <Link to={`/auth?returnTo=${encodeURIComponent(window.location.pathname)}`}>
        Sign in
      </Link>
    );
  }

  if (user?.role === "student") {
    return (
      <main className="grid-bg flex min-h-screen items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 glass-3d rounded-xl border border-border/80 bg-card/60 p-10 text-center backdrop-blur">
          <div className="flex size-12 items-center justify-center rounded-xl bg-amber-500/12 text-amber-400">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">Restricted area</h1>
          <p className="text-sm text-muted-foreground">
            Student accounts don't have access to the inventory. You can still use Chat,
            Courses and your profile.
          </p>
          <Button asChild>
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </main>
    );
  }

  return children;
}
