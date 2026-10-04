/**
 * Sound engine — the pure, testable core behind every app sound.
 *
 * A sound ("spec") is either
 *   • a single tone  — { freq, dur } (legacy shape, still fully supported), or
 *   • a melody       — { notes: [{ freq, dur, gap? }, …] } played in sequence,
 *                      so events can be chimes, arpeggios and buzzes instead
 *                      of plain beeps.
 *
 * The Pitch / Length sliders in Settings keep working for melodies through a
 * "reference note" model: spec.freq / spec.dur are the FIRST note's values,
 * so the sliders start at ratio 1 / scale 1 (melody plays exactly as
 * authored) and dragging them transposes / stretches the whole melody
 * proportionally — with no drift when the slider returns to its start.
 *
 * This module is intentionally DOM-free: the Convex backend imports the
 * types + sanitizer from here, and the client's AudioContext playback lives
 * in src/hooks/use-sound.ts.
 */

export type SoundWave = "sine" | "triangle" | "square" | "sawtooth";

export type SoundNote = { freq: number; dur: number; gap?: number };

export type SoundSpec = {
  /** Base pitch — the first note's frequency (pitch slider value). */
  freq: number;
  /** Base length — the first note's duration in seconds (length slider). */
  dur: number;
  /** Volume 0–100 (%). Defaults to 18 — the original mix level. */
  vol?: number;
  /** Oscillator character; defaults to "sine". */
  wave?: SoundWave;
  /** Melody. When present it replaces the single tone. Max 24 notes. */
  notes?: SoundNote[];
};

export type SoundSettings = { enabled: boolean; sounds: Record<string, SoundSpec> };

export const SOUND_WAVES: readonly SoundWave[] = [
  "sine",
  "triangle",
  "square",
  "sawtooth",
];

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

const clampFreq = (n: number) => clamp(n, 40, 8000);
const clampDur = (n: number, max: number) => clamp(n, 0.02, max);

export const MAX_NOTES = 24;
/** Melodies never run longer than this, however the sliders are stretched. */
export const MAX_MELODY_SECONDS = 4;

/**
 * Every default sound: a memorable melody (or crisp blip) per event.
 * INVARIANT: `freq`/`dur` equal the first note's values so the sliders
 * start neutral (ratio 1 / scale 1). Tests assert this.
 */
export const DEFAULT_SOUNDS: SoundSettings = {
  enabled: true,
  sounds: {
    // Quick high blip — instant feedback, never annoying in a row.
    scan: { freq: 1175, dur: 0.05, wave: "sine" },
    // Rising two-note "ding-ding" — something new landed in the console.
    rental_request: {
      freq: 659,
      dur: 0.09,
      wave: "sine",
      notes: [
        { freq: 659, dur: 0.09 },
        { freq: 880, dur: 0.14, gap: 0.02 },
      ],
    },
    // Major arpeggio C–E–G: unmistakably "yes, approved".
    approved: {
      freq: 523,
      dur: 0.09,
      wave: "triangle",
      notes: [
        { freq: 523, dur: 0.09 },
        { freq: 659, dur: 0.09 },
        { freq: 784, dur: 0.18, gap: 0.02 },
      ],
    },
    // Descending low buzz — clearly "no", softly.
    denied: {
      freq: 220,
      dur: 0.14,
      wave: "square",
      notes: [
        { freq: 220, dur: 0.14 },
        { freq: 196, dur: 0.22, gap: 0.02 },
      ],
    },
    // Upward pair — a unit came home.
    returned: {
      freq: 587,
      dur: 0.1,
      wave: "sine",
      notes: [
        { freq: 587, dur: 0.1 },
        { freq: 880, dur: 0.16, gap: 0.02 },
      ],
    },
    // Bright two-step — a part got a destination.
    assigned: {
      freq: 784,
      dur: 0.08,
      wave: "triangle",
      notes: [
        { freq: 784, dur: 0.08 },
        { freq: 1047, dur: 0.14, gap: 0.02 },
      ],
    },
    // Gentle bell — works for any other update.
    notification: {
      freq: 880,
      dur: 0.08,
      wave: "sine",
      notes: [
        { freq: 880, dur: 0.08 },
        { freq: 1175, dur: 0.14, gap: 0.02 },
      ],
    },
  },
};

/** Loose input shape (e.g. the Convex validator's `wave?: string`). */
export type SoundSpecInput = {
  freq: number;
  dur: number;
  vol?: number;
  wave?: string;
  notes?: Array<{ freq: number; dur: number; gap?: number }>;
};

/** One scheduled tone inside a sound's timeline. */
export type NoteEvent = {
  freq: number;
  dur: number;
  /** Seconds from the sound's start. */
  start: number;
  wave: SoundWave;
};

function isWave(w: unknown): w is SoundWave {
  return typeof w === "string" && (SOUND_WAVES as readonly string[]).includes(w);
}

/**
 * Build the timeline for one sound:
 *  - single tone → one event at t=0;
 *  - melody → each note transposed by `spec.freq / notes[0].freq` (pitch
 *    slider) and stretched by `spec.dur / notes[0].dur` (length slider),
 *    sequenced with each note's gap, capped at MAX_NOTES / MAX_MELODY_SECONDS.
 * Pure — the AudioContext playback (client-only) consumes the result.
 */
export function scheduleSound(spec: SoundSpec): NoteEvent[] {
  const wave = isWave(spec.wave) ? spec.wave : "sine";
  const notes = Array.isArray(spec.notes) ? spec.notes.slice(0, MAX_NOTES) : [];

  if (notes.length === 0) {
    return [{ freq: clampFreq(spec.freq), dur: clampDur(spec.dur, 1.5), start: 0, wave }];
  }

  const ref = notes[0];
  const ratio = ref.freq > 0 && spec.freq > 0 ? spec.freq / ref.freq : 1;
  const scale = ref.dur > 0 && spec.dur > 0 ? spec.dur / ref.dur : 1;

  const events: NoteEvent[] = [];
  let t = 0;
  for (const n of notes) {
    const dur = clampDur(n.dur * scale, 0.6);
    const gap = clamp((n.gap ?? 0.03) * scale, 0, 1);
    if (t >= MAX_MELODY_SECONDS) break;
    events.push({ freq: clampFreq(n.freq * ratio), dur, start: t, wave });
    t += dur + gap;
  }
  return events;
}

/** Total length of a sound in seconds (first event start → last end). */
export function soundDuration(spec: SoundSpec): number {
  const events = scheduleSound(spec);
  if (events.length === 0) return 0;
  const last = events[events.length - 1];
  return last.start + last.dur;
}

/**
 * Clamp + whitelist everything a member may save (Convex validator shape).
 * Invalid waves drop to the default; notes are capped; numbers are bounded
 * so a hand-edited row can never schedule runaway audio.
 */
export function sanitizeSounds(
  sounds: Record<string, SoundSpecInput>,
): Record<string, SoundSpec> {
  const out: Record<string, SoundSpec> = {};
  for (const [key, s] of Object.entries(sounds)) {
    if (!s || typeof s !== "object") continue;
    const clean: SoundSpec = {
      freq: clampFreq(s.freq),
      dur: clampDur(s.dur, 1.5),
    };
    if (typeof s.vol === "number") clean.vol = clamp(s.vol, 0, 100);
    if (isWave(s.wave)) clean.wave = s.wave;
    if (Array.isArray(s.notes) && s.notes.length > 0) {
      clean.notes = s.notes.slice(0, MAX_NOTES).map((n) => {
        const note: SoundNote = { freq: clampFreq(n.freq), dur: clampDur(n.dur, 1.5) };
        if (typeof n.gap === "number") note.gap = clamp(n.gap, 0, 1);
        return note;
      });
    }
    out[key] = clean;
  }
  return out;
}
