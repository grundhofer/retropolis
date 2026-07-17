import { describe, expect, it } from "vitest";
import {
  EMPTY_PICKER,
  mulberry32,
  pickerFinished,
  pickerKnows,
  wheelTargetRotation,
} from "../src/domain/picker.js";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBe(3);
  });

  it("stays within [0, 1)", () => {
    const random = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("wheelTargetRotation", () => {
  const pool = ["anna", "ben", "cara", "dev"];

  it("is deterministic: same inputs, same rotation on every client", () => {
    expect(wheelTargetRotation(pool, "cara", 777)).toBe(
      wheelTargetRotation(pool, "cara", 777),
    );
  });

  it("parks the winner's segment under the pointer", () => {
    for (const [winner, seed] of [
      ["anna", 1],
      ["ben", 99],
      ["cara", 12345],
      ["dev", 987654],
    ] as const) {
      const rotation = wheelTargetRotation(pool, winner, seed);
      const segment = 360 / pool.length;
      const index = pool.indexOf(winner);
      // final wheel angle mod 360; the pointer sits at 0° (top)
      const landed = ((rotation % 360) + 360) % 360;
      const pointerPosition = (360 - landed) % 360; // which wheel angle is at the pointer
      const segmentStart = index * segment;
      expect(pointerPosition).toBeGreaterThan(segmentStart);
      expect(pointerPosition).toBeLessThan(segmentStart + segment);
    }
  });

  it("spins at least four full turns for anticipation", () => {
    expect(wheelTargetRotation(pool, "anna", 5)).toBeGreaterThanOrEqual(
      4 * 360,
    );
  });

  it("degrades safely for unknown winners or empty pools", () => {
    expect(wheelTargetRotation([], "anna", 1)).toBe(0);
    expect(wheelTargetRotation(pool, "nobody", 1)).toBe(0);
  });
});

describe("picker state helpers", () => {
  it("pickerFinished only after at least one person presented", () => {
    expect(pickerFinished(EMPTY_PICKER)).toBe(false);
    expect(
      pickerFinished({
        remaining: [],
        presented: ["anna"],
        current: null,
        excluded: [],
      }),
    ).toBe(true);
    expect(
      pickerFinished({
        remaining: ["ben"],
        presented: ["anna"],
        current: null,
        excluded: [],
      }),
    ).toBe(false);
    expect(
      pickerFinished({
        remaining: [],
        presented: ["anna"],
        current: "ben",
        excluded: [],
      }),
    ).toBe(false);
  });

  it("pickerKnows covers all three buckets", () => {
    const picker = {
      remaining: ["anna"],
      presented: ["ben"],
      current: "cara",
      excluded: ["dev"],
    };
    expect(pickerKnows(picker, "anna")).toBe(true);
    expect(pickerKnows(picker, "ben")).toBe(true);
    expect(pickerKnows(picker, "cara")).toBe(true);
    expect(pickerKnows(picker, "dev")).toBe(true); // excluded is still "known"
    expect(pickerKnows(picker, "elle")).toBe(false);
  });
});
