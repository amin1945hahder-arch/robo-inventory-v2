import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Notification sounds — the app plays a short Web-Audio beep per process
 * (scan, request, approval, denial, return, assignment, incoming update).
 * Tones are admin-configurable in Settings; everyone can mute.
 */

export type SoundKey =
  | "scan"
  | "rental_request"
  | "approved"
  | "denied"
  | "returned"
  | "assigned"
  | "notification";

export function useSound() {
  const cfg = useQuery(api.settings.getSounds, {});
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => undefined);
    };
  }, []);

  const play = useCallback(
    (key: SoundKey) => {
      if (cfg === undefined) return; // settings not loaded yet
      if (!cfg.enabled) return;
      const spec = cfg.sounds[key] ?? { freq: 660, dur: 0.1 };
      try {
        const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
        const Ctor = window.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) return;
        ctxRef.current = ctxRef.current ?? new Ctor();
        const ctx: AudioContext = ctxRef.current;
        if (ctx.state === "suspended") void ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = spec.freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + spec.dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + spec.dur + 0.02);
      } catch {
        // audio not available (autoplay policy before first interaction) — ignore
      }
    },
    [cfg],
  );

  return play;
}
