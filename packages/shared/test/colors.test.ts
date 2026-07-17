import { describe, expect, it } from "vitest";
import { assignColor, PARTICIPANT_COLORS } from "../src/domain/colors.js";

describe("assignColor", () => {
  it("hands out distinct colors until the palette is exhausted", () => {
    const taken: string[] = [];
    for (let i = 0; i < PARTICIPANT_COLORS.length; i++) {
      const color = assignColor(taken);
      expect(taken).not.toContain(color);
      taken.push(color);
    }
    expect(new Set(taken).size).toBe(PARTICIPANT_COLORS.length);
  });

  it("cycles deterministically once all colors are taken", () => {
    const taken = [...PARTICIPANT_COLORS];
    expect(assignColor(taken)).toBe(PARTICIPANT_COLORS[0]);
    expect(assignColor([...taken, "#000000"])).toBe(PARTICIPANT_COLORS[1]);
  });
});
