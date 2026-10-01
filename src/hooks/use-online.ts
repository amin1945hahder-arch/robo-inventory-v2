import { useEffect, useState } from "react";
import { getOnline, onConnectivityChange } from "@/lib/offline";

/**
 * Reactive online/offline status for UI (banner, icons, disabling).
 * Combines the browser's network events with the live Convex backend state
 * (both tracked centrally in src/lib/offline.ts).
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(getOnline);

  useEffect(() => {
    setOnline(getOnline());
    return onConnectivityChange(() => setOnline(getOnline()));
  }, []);

  return online;
}
