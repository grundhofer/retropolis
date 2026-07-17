import { z } from "zod";

// "Who presents next" — the rotation is the product's unique feature: draw
// without replacement until everyone has presented. The server draws with a
// CSPRNG; every client replays the identical wheel animation from the
// broadcast seed, so all screens land on the same name.
export const pickerStateSchema = z.object({
  /** not yet presented (the wheel pool) */
  remaining: z.array(z.string()),
  /** finished presenting, in order */
  presented: z.array(z.string()),
  /** currently presenting */
  current: z.string().nullable(),
  /** deliberately taken off the wheel by the facilitator — reconnects and
   *  latecomer auto-adds must not undo this (defaulted for older boards) */
  excluded: z.array(z.string()).default([]),
});
export type PickerState = z.infer<typeof pickerStateSchema>;

export const EMPTY_PICKER: PickerState = {
  remaining: [],
  presented: [],
  current: null,
  excluded: [],
};

export function pickerFinished(picker: PickerState): boolean {
  return (
    picker.remaining.length === 0 &&
    picker.current === null &&
    picker.presented.length > 0
  );
}

export function pickerKnows(
  picker: PickerState,
  participantId: string,
): boolean {
  return (
    picker.current === participantId ||
    picker.remaining.includes(participantId) ||
    picker.presented.includes(participantId) ||
    picker.excluded.includes(participantId)
  );
}

export const WHEEL_SPIN_MS = 4500;
/** lead time between the server timestamp and the animation start */
export const WHEEL_START_DELAY_MS = 300;
/** how long the winner card stays up after the wheel stops */
export const WHEEL_HOLD_MS = 2600;

// The spin every client replays; also included in sync snapshots while still
// active, so a reconnect mid-spin does not kill the wheel.
export const wheelSpinSchema = z.object({
  pool: z.array(z.string()),
  winnerId: z.string(),
  seed: z.number(),
  startAt: z.number(),
  durationMs: z.number(),
});
export type WheelSpin = z.infer<typeof wheelSpinSchema>;

// Tiny deterministic PRNG — all animation randomness (turn count, in-segment
// jitter) derives from the broadcast seed, never from local Math.random().
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Final clockwise wheel rotation (degrees) that parks the winner's segment
// under the pointer at the top. Segments are laid out in pool order starting
// at the top, clockwise. Deterministic: same pool/winner/seed → same spin.
export function wheelTargetRotation(
  pool: readonly string[],
  winnerId: string,
  seed: number,
): number {
  const count = pool.length;
  const index = pool.indexOf(winnerId);
  if (count === 0 || index === -1) return 0;
  const random = mulberry32(seed);
  const fullTurns = 4 + Math.floor(random() * 3); // 4–6 turns of anticipation
  const segment = 360 / count;
  const winnerCenter = index * segment + segment / 2;
  // organic near-misses only: jitter stays well inside the segment
  const jitter = (random() - 0.5) * segment * 0.7;
  return fullTurns * 360 + (360 - winnerCenter) + jitter;
}
