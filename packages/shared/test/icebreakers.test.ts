// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { ICEBREAKER_IDS, pickIcebreaker } from "../src/domain/icebreakers.js";

describe("pickIcebreaker", () => {
  it("returns a member of the bank for any index", () => {
    for (const index of [0, 1, 7, 23, 100, 999]) {
      expect(ICEBREAKER_IDS).toContain(pickIcebreaker(index));
    }
  });

  it("never repeats the avoided question", () => {
    for (const avoid of ICEBREAKER_IDS) {
      for (let i = 0; i < ICEBREAKER_IDS.length + 3; i++) {
        expect(pickIcebreaker(i, avoid)).not.toBe(avoid);
      }
    }
  });

  it("is deterministic for a given index", () => {
    expect(pickIcebreaker(5)).toBe(pickIcebreaker(5));
  });
});
