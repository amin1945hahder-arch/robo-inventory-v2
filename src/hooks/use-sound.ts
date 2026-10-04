import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { scheduleSound, soundDuration, type SoundSpec } from "@/lib/sound-engine";

/**
 * Notification sounds — the app plays a short Web-Audio cue per process
 * (scan, request, approval, denial, return, assignment, incoming update).
 * Sounds are PER USER: every member configures their own tones or melodies
 * (or mutes entirely) from Settings → My sounds; nobody else is affected.
 *
 * The TIMELINE comes from lib/sound-engine.scheduleSound (pure + tested);
 * this module only owns the AudioContext side (create, unlock, schedule).
 */

export type SoundKey =
  | "scan"
  | "rental_request"
  | "approved"
  | "denied"
  | "returned"
  | "assigned"
  | "notification";

/**
 * Schedule one sound on an AudioContext: every note gets its own oscillator
 * with a fast-attack / smooth-decay envelope, sequenced on the timeline the
 * engine built (melody transposed/stretched by the pitch + length sliders).
 */
export function playSoundOn(ctx: AudioContext, spec: SoundSpec): void {
  const peak = Math.min(1, Math.max(0, (spec.vol ?? 18) / 100));
  if (peak <= 0) return;
  const events = scheduleSound(spec);
  if (events.length === 0) return;
  if (ctx.state === "suspended") void ctx.resume();
  const t0 = ctx.currentTime;
  for (const e of events) {
    const start = t0 + e.start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = e.wave;
    osc.frequency.setValueAtTime(e.freq, start);
    // Fast attack, smooth decay — no clicks between melody notes.
    const attack = Math.min(0.012, e.dur / 4);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + e.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + e.dur + 0.02);
  }
}

/** One-shot preview (Settings): fresh context, closed after the cue ends. */
export function previewSound(spec: SoundSpec): void {
  try {
    const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    playSoundOn(ctx, spec);
    const ms = (soundDuration(spec) + 0.5) * 1000;
    setTimeout(() => void ctx.close().catch(() => undefined), ms);
  } catch {
    // audio not available (autoplay policy before first interaction) — ignore
  }
}

export function useSound() {
  const cfg = useQuery(api.settings.getMySounds, {});
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
        playSoundOn(ctxRef.current, spec);
      } catch {
        // audio not available (autoplay policy before first interaction) — ignore
      }
    },
    [cfg],
  );

  return play;
}
