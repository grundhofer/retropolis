import { describe, expect, it } from "vitest";
import {
  canTransition,
  DEFAULT_PHASE_PLAN,
  enabledPhases,
  nextPhase,
  phaseRevealed,
  previousPhase,
  type PhasePlan,
} from "../src/domain/phases.js";

const FULL_PLAN: PhasePlan = {
  checkin: true,
  vote: true,
  discuss: true,
  close: true,
};

describe("enabledPhases", () => {
  it("core loop only for the default plan", () => {
    expect(enabledPhases(DEFAULT_PHASE_PLAN)).toEqual([
      "lobby",
      "write",
      "present",
      "done",
    ]);
  });

  it("full plan includes every phase in order", () => {
    expect(enabledPhases(FULL_PLAN)).toEqual([
      "lobby",
      "checkin",
      "write",
      "present",
      "vote",
      "discuss",
      "close",
      "done",
    ]);
  });
});

describe("nextPhase / previousPhase", () => {
  it("walks the enabled sequence, skipping disabled phases", () => {
    expect(nextPhase("lobby", DEFAULT_PHASE_PLAN)).toBe("write");
    expect(nextPhase("write", DEFAULT_PHASE_PLAN)).toBe("present");
    expect(nextPhase("present", DEFAULT_PHASE_PLAN)).toBe("done");
    expect(nextPhase("done", DEFAULT_PHASE_PLAN)).toBeNull();
    expect(previousPhase("present", DEFAULT_PHASE_PLAN)).toBe("write");
    expect(previousPhase("lobby", DEFAULT_PHASE_PLAN)).toBeNull();
  });

  it("respects the full plan", () => {
    expect(nextPhase("lobby", FULL_PLAN)).toBe("checkin");
    expect(nextPhase("present", FULL_PLAN)).toBe("vote");
  });
});

describe("canTransition", () => {
  it("allows exactly one step forward", () => {
    expect(canTransition("lobby", "write", DEFAULT_PHASE_PLAN)).toBe(true);
    expect(canTransition("write", "present", DEFAULT_PHASE_PLAN)).toBe(true);
    expect(canTransition("lobby", "present", DEFAULT_PHASE_PLAN)).toBe(false); // no skipping
  });

  it("allows rewinding to any earlier enabled phase", () => {
    expect(canTransition("present", "write", DEFAULT_PHASE_PLAN)).toBe(true);
    expect(canTransition("present", "lobby", DEFAULT_PHASE_PLAN)).toBe(true);
  });

  it("done is terminal and self-transitions are illegal", () => {
    expect(canTransition("done", "present", DEFAULT_PHASE_PLAN)).toBe(false);
    expect(canTransition("write", "write", DEFAULT_PHASE_PLAN)).toBe(false);
  });

  it("disabled phases are unreachable", () => {
    expect(canTransition("present", "vote", DEFAULT_PHASE_PLAN)).toBe(false);
    expect(canTransition("present", "vote", FULL_PLAN)).toBe(true);
  });
});

describe("phaseRevealed", () => {
  it("hidden through write, revealed from present on", () => {
    expect(phaseRevealed("lobby")).toBe(false);
    expect(phaseRevealed("checkin")).toBe(false);
    expect(phaseRevealed("write")).toBe(false);
    expect(phaseRevealed("present")).toBe(true);
    expect(phaseRevealed("vote")).toBe(true);
    expect(phaseRevealed("done")).toBe(true);
  });
});
