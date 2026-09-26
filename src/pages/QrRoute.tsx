import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useConvexAuth } from "convex/react";
import { LoadingGif } from "@/components/LoadingGif";

/** Route a printed QR label (`/qr?p=<payload>`) to the right destination. */
export default function QrRoute() {
  const [params] = useSearchParams();
  const payload = params.get("p") ?? "";
  const { isAuthenticated, isLoading } = useConvexAuth();

  const resolved = useQuery(
    api.lookup.resolve,
    payload && isAuthenticated ? { payload } : "skip",
  );

  useEffect(() => {
    if (resolved && resolved.url) {
      window.location.replace(resolved.url);
    }
  }, [resolved]);

  // Signed-out: send them to auth with a return path back to this QR link.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const returnTo = `/qr?p=${encodeURIComponent(payload)}`;
      window.location.replace(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
    }
  }, [isLoading, isAuthenticated, payload]);

  if (!payload) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium">No QR payload in the link</p>
        <a href="/" className="text-sm text-muted-foreground underline">Go home</a>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <LoadingGif size={56} label={`Opening ${payload}…`} />
    </div>
  );
}
