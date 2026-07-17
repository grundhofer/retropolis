import { z } from "zod";

// The full session flow (product spec §3). lobby/write/present/done are the
// core loop and always enabled; the others are per-board options that arrive
// with later milestones (checkin v1.x, vote/discuss M3, close M4).
export const PHASES = [
  "lobby",
  "checkin",
  "write",
  "present",
  "vote",
  "discuss",
  "close",
  "done",
] as const;

export const phaseSchema = z.enum(PHASES);
export type Phase = z.infer<typeof phaseSchema>;

export const phasePlanSchema = z.object({
  checkin: z.boolean(),
  vote: z.boolean(),
  discuss: z.boolean(),
  close: z.boolean(),
});
export type PhasePlan = z.infer<typeof phasePlanSchema>;

// M1 boards run the bare core loop.
export const DEFAULT_PHASE_PLAN: PhasePlan = {
  checkin: false,
  vote: false,
  discuss: false,
  close: false,
};

export function enabledPhases(plan: PhasePlan): Phase[] {
  return PHASES.filter((phase) => {
    switch (phase) {
      case "checkin":
        return plan.checkin;
      case "vote":
        return plan.vote;
      case "discuss":
        return plan.discuss;
      case "close":
        return plan.close;
      default:
        return true;
    }
  });
}

export function nextPhase(current: Phase, plan: PhasePlan): Phase | null {
  const sequence = enabledPhases(plan);
  const index = sequence.indexOf(current);
  if (index === -1 || index === sequence.length - 1) return null;
  return sequence[index + 1] ?? null;
}

export function previousPhase(current: Phase, plan: PhasePlan): Phase | null {
  const sequence = enabledPhases(plan);
  const index = sequence.indexOf(current);
  if (index <= 0) return null;
  return sequence[index - 1] ?? null;
}

// Legal transitions: advance exactly one enabled step, or rewind to any
// earlier enabled phase. "done" is terminal.
export function canTransition(
  from: Phase,
  to: Phase,
  plan: PhasePlan,
): boolean {
  if (from === to || from === "done") return false;
  const sequence = enabledPhases(plan);
  const fromIndex = sequence.indexOf(from);
  const toIndex = sequence.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  if (toIndex === fromIndex + 1) return true;
  return toIndex < fromIndex;
}

// From "present" on, everyone sees everyone's notes; before that, the write
// phase privacy rule applies (own notes only).
export function phaseRevealed(phase: Phase): boolean {
  return (
    phase === "present" ||
    phase === "vote" ||
    phase === "discuss" ||
    phase === "close" ||
    phase === "done"
  );
}
