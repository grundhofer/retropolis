import { describe, expect, it } from "vitest";
import { planJoin } from "../src/domain/join.js";
import type { Participant } from "../src/protocol.js";

const existing: Participant = {
  id: "p1",
  name: "Old Name",
  color: "#1971C2",
  role: "member",
  online: false,
};

describe("planJoin", () => {
  it("creates a new member with a free color", () => {
    const plan = planJoin({
      requestedName: "Anna",
      isAdmin: false,
      existing: null,
      takenColors: ["#E8590C"],
      newId: "p9",
    });
    expect(plan.isNew).toBe(true);
    expect(plan.participant).toMatchObject({
      id: "p9",
      name: "Anna",
      role: "member",
      online: true,
    });
    expect(plan.participant.color).not.toBe("#E8590C");
  });

  it("grants the facilitator role when the admin token matched", () => {
    const plan = planJoin({
      requestedName: "Anna",
      isAdmin: true,
      existing: null,
      takenColors: [],
      newId: "p9",
    });
    expect(plan.participant.role).toBe("facilitator");
  });

  it("reclaims identity on rejoin: same id and color, new name, back online", () => {
    const plan = planJoin({
      requestedName: "New Name",
      isAdmin: false,
      existing,
      takenColors: [existing.color],
      newId: "unused",
    });
    expect(plan.isNew).toBe(false);
    expect(plan.participant).toEqual({
      ...existing,
      name: "New Name",
      online: true,
    });
  });

  it("only ever upgrades the role, never demotes", () => {
    const facilitator: Participant = { ...existing, role: "facilitator" };
    const withoutToken = planJoin({
      requestedName: "Anna",
      isAdmin: false,
      existing: facilitator,
      takenColors: [],
      newId: "unused",
    });
    expect(withoutToken.participant.role).toBe("facilitator");

    const upgraded = planJoin({
      requestedName: "Anna",
      isAdmin: true,
      existing,
      takenColors: [],
      newId: "unused",
    });
    expect(upgraded.participant.role).toBe("facilitator");
  });
});
