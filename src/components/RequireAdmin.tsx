import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LoadingGif } from "@/components/LoadingGif";
import { Link } from "react-router";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

/** Protect admin-only routes in the UI. Backend functions still enforce the
 *  role server-side — this only avoids error-boundary flashes for members. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-transparent">
        <LoadingGif size={56} label={null} />
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Link to={`/auth?returnTo=${encodeURIComponent(window.location.pathname)}`}>Sign in</Link>;
  }

  if (user?.role !== "admin") {
    return (
      <main className="grid-bg flex min-h-screen items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border/80 bg-card/60 p-10 text-center backdrop-blur">
          <div className="flex size-12 items-center justify-center rounded-xl bg-rose-500/12 text-rose-400">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">Admins only</h1>
          <p className="text-sm text-muted-foreground">
            This area is for the lab admin. Ask Dr. Essa to promote you if you should have access.
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