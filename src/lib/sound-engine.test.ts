import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOUNDS,
  MAX_MELODY_SECONDS,
  MAX_NOTES,
  SOUND_WAVES,
  sanitizeSounds,
  scheduleSound,
  soundDuration,
  type SoundSpec,
} from "./sound-engine";

const REQUIRED_KEYS = [
  "scan",
  "rental_request",
  "approved",
  "denied",
  "returned",
  "assigned",
  "notification",
];

describe("scheduleSound — single tone", () => {
  it("emits one event at t=0 with the requested tone", () => {
    const events = scheduleSound({ freq: 660, dur: 0.1 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ freq: 660, dur: 0.1, start: 0, wave: "sine" });
  });

  it("clamps out-of-range frequencies and durations", () => {
    const [e] = scheduleSound({ freq: 10, dur: 0 });
    expect(e.freq).toBeGreaterThanOrEqual(40);
    const [hot] = scheduleSound({ freq: 99_999, dur: 99 });
    expect(hot.freq).toBeLessThanOrEqual(8000);
    expect(hot.dur).toBeLessThanOrEqual(1.5);
  });

  it("keeps the legacy {freq, dur, vol} shape fully working", () => {
    const legacy: SoundSpec = { freq: 880, dur: 0.08, vol: 25 };
    expect(scheduleSound(legacy)).toHaveLength(1);
    expect(soundDuration(legacy)).toBeCloseTo(0.08, 5);
  });
});

describe("scheduleSound — melody", () => {
  const melody: SoundSpec = {
    freq: 523,
    dur: 0.1,
    wave: "triangle",
    notes: [
      { freq: 523, dur: 0.1 },
      { freq: 659, dur: 0.1, gap: 0.05 },
      { freq: 784, dur: 0.2 },
    ],
  };

  it("sequences notes with their gaps, all on the chosen wave", () => {
    const events = scheduleSound(melody);
    expect(events).toHaveLength(3);
    expect(events[0].start).toBe(0);
    // `gap` = silence AFTER its own note: 0.1 + default 0.03 → 0.13
    expect(events[1].start).toBeCloseTo(0.13, 5);
    // 0.13 + 0.1 + note2's 0.05 gap → third at 0.28
    expect(events[2].start).toBeCloseTo(0.28, 5);
    expect(events.map((e) => e.freq)).toEqual([523, 659, 784]);
    expect(events.every((e) => e.wave === "triangle")).toBe(true);
    expect(soundDuration(melody)).toBeCloseTo(0.48, 5);
  });

  it("pitch slider transposes the whole melody proportionally", () => {
    const up = scheduleSound({ ...melody, freq: 1046 }); // exactly 2× the ref note
    expect(up.map((e) => e.freq)).toEqual([1046, 1318, 1568]);
    // Returning the slider to the reference restores the authored melody.
    const back = scheduleSound({ ...melody, freq: 523 });
    expect(back.map((e) => e.freq)).toEqual([523, 659, 784]);
  });

  it("length slider stretches every note without changing order", () => {
    const long = scheduleSound({ ...melody, dur: 0.2 }); // 2× the ref note
    expect(long.map((e) => e.dur)).toEqual([0.2, 0.2, 0.4]);
    // gaps stretch too: 0.2 + 0.03×2 → second note at 0.26
    expect(long[1].start).toBeCloseTo(0.26, 5);
    expect(long.map((e) => e.freq)).toEqual([523, 659, 784]);
  });

  it("caps runaway melodies (note count and total length)", () => {
    const many: SoundSpec = {
      freq: 440,
      dur: 0.1,
      notes: Array.from({ length: 100 }, (_, i) => ({ freq: 440 + i, dur: 0.1 })),
    };
    expect(scheduleSound(many).length).toBeLessThanOrEqual(MAX_NOTES);

    const wide = { ...melody, dur: 500 };
    const total = soundDuration(wide);
    expect(total).toBeLessThanOrEqual(MAX_MELODY_SECONDS + 0.6);
    for (const e of scheduleSound(wide)) expect(e.dur).toBeLessThanOrEqual(0.6);
  });

  it("survives degenerate specs without throwing", () => {
    expect(() => scheduleSound({ freq: 0, dur: 0, notes: [{ freq: 0, dur: 0 }] })).not.toThrow();
    expect(scheduleSound({ freq: 440, dur: 0.1, notes: [] })).toHaveLength(1);
  });
});

describe("DEFAULT_SOUNDS", () => {
  it("ships every event with a valid, playable spec", () => {
    expect(DEFAULT_SOUNDS.enabled).toBe(true);
    for (const key of REQUIRED_KEYS) {
      const spec = DEFAULT_SOUNDS.sounds[key];
      expect(spec, key).toBeTruthy();
      expect(spec.freq).toBeGreaterThanOrEqual(40);
      expect(spec.freq).toBeLessThanOrEqual(8000);
      expect(spec.dur).toBeGreaterThan(0);
      if (spec.wave) expect(SOUND_WAVES).toContain(spec.wave);
      if (spec.notes) {
        expect(spec.notes.length).toBeGreaterThan(1); // melodies, not beeps
        expect(spec.notes.length).toBeLessThanOrEqual(MAX_NOTES);
        for (const n of spec.notes) {
          expect(n.freq).toBeGreaterThan(0);
          expect(n.dur).toBeGreaterThan(0);
        }
        // Sliders start NEUTRAL: reference = first note (ratio 1 / scale 1).
        expect(spec.freq, `${key} pitch`).toBe(spec.notes[0].freq);
        expect(spec.dur, `${key} length`).toBe(spec.notes[0].dur);
      }
    }
  });

  it("every default cue is a short, non-annoying duration", () => {
    for (const [key, spec] of Object.entries(DEFAULT_SOUNDS.sounds)) {
      const d = soundDuration(spec);
      expect(d, key).toBeGreaterThan(0);
      expect(d, key).toBeLessThanOrEqual(MAX_MELODY_SECONDS);
    }
  });

  it("denials are low-pitched, approvals rise", () => {
    expect(DEFAULT_SOUNDS.sounds.denied.freq).toBeLessThan(300);
    const approved = DEFAULT_SOUNDS.sounds.approved.notes!;
    expect(approved[approved.length - 1].freq).toBeGreaterThan(approved[0].freq);
  });
});

describe("sanitizeSounds", () => {
  it("clamps numbers, whitelists waves and caps notes", () => {
    const clean = sanitizeSounds({
      hot: { freq: 99_999, dur: 99, vol: 500, wave: "sparkle" },
      ok: {
        freq: 440,
        dur: 0.1,
        vol: 40,
        wave: "square",
        notes: [
          { freq: 10, dur: 9, gap: 99 },
          ...Array.from({ length: 100 }, (_, i) => ({ freq: 440, dur: 0.1 })),
        ],
      },
    });
    expect(clean.hot).toEqual({ freq: 8000, dur: 1.5, vol: 100 });
    expect(clean.ok.wave).toBe("square");
    expect(clean.ok.notes!.length).toBeLessThanOrEqual(MAX_NOTES);
    expect(clean.ok.notes![0].freq).toBeGreaterThanOrEqual(40);
    expect(clean.ok.notes![0].dur).toBeLessThanOrEqual(1.5);
    expect(clean.ok.notes![0].gap).toBeLessThanOrEqual(1);
  });

  it("drops empty melodies and keeps plain tones intact", () => {
    const clean = sanitizeSounds({
      blip: { freq: 880, dur: 0.08 },
      empty: { freq: 880, dur: 0.08, notes: [] },
    });
    expect(clean.blip).toEqual({ freq: 880, dur: 0.08 });
    expect(clean.empty.notes).toBeUndefined();
  });

  it("round-trips every default unchanged (already within bounds)", () => {
    expect(sanitizeSounds(DEFAULT_SOUNDS.sounds)).toEqual(DEFAULT_SOUNDS.sounds);
  });
});
