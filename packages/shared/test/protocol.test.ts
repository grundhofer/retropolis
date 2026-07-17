import { describe, expect, it } from "vitest";
import { parseClientCommand, parseServerEvent } from "../src/protocol.js";

describe("parseClientCommand", () => {
  it("parses a valid join and trims the name", () => {
    const cmd = parseClientCommand(
      JSON.stringify({ type: "join", name: "  Anna  " }),
    );
    expect(cmd).toEqual({ type: "join", name: "Anna" });
  });

  it("keeps optional capability fields", () => {
    const sessionKey = "ab".repeat(16);
    const cmd = parseClientCommand(
      JSON.stringify({
        type: "join",
        name: "Ben",
        sessionKey,
        adminToken: "at",
      }),
    );
    expect(cmd).toMatchObject({ sessionKey, adminToken: "at" });
  });

  it.each([
    ["not json", "{nope"],
    ["unknown type", JSON.stringify({ type: "hack" })],
    ["empty name", JSON.stringify({ type: "join", name: "   " })],
    ["overlong name", JSON.stringify({ type: "join", name: "x".repeat(41) })],
    // a weak session key would be an impersonation handle — shape is enforced
    [
      "malformed session key",
      JSON.stringify({ type: "join", name: "Ben", sessionKey: "weak" }),
    ],
    ["non-string frame", 42],
  ])("rejects %s", (_label, raw) => {
    expect(parseClientCommand(raw)).toBeNull();
  });
});

describe("parseClientCommand — M1 commands", () => {
  const opId = "12".repeat(16);
  const noteId = "34".repeat(16);
  const columnId = "56".repeat(16);

  it("parses note.create and trims text", () => {
    const cmd = parseClientCommand(
      JSON.stringify({
        type: "note.create",
        opId,
        noteId,
        columnId,
        text: "  a point  ",
      }),
    );
    expect(cmd).toMatchObject({ type: "note.create", text: "a point" });
  });

  it.each([
    [
      "empty note text",
      { type: "note.create", opId, noteId, columnId, text: "  " },
    ],
    [
      "overlong note text",
      { type: "note.create", opId, noteId, columnId, text: "x".repeat(501) },
    ],
    [
      "malformed note id",
      { type: "note.create", opId, noteId: "nope", columnId, text: "hi" },
    ],
    [
      "unknown reaction emoji",
      { type: "note.react", opId, noteId, emoji: "🦄", on: true },
    ],
    ["invalid phase", { type: "admin.phase.set", phase: "party" }],
    ["timer too long", { type: "admin.timer.start", durationSec: 999999 }],
    ["timer not integer", { type: "admin.timer.start", durationSec: 12.5 }],
  ])("rejects %s", (_label, cmd) => {
    expect(parseClientCommand(JSON.stringify(cmd))).toBeNull();
  });

  it("accepts a known reaction and ready toggle", () => {
    expect(
      parseClientCommand(
        JSON.stringify({
          type: "note.react",
          opId,
          noteId,
          emoji: "🎉",
          on: true,
        }),
      ),
    ).not.toBeNull();
    expect(
      parseClientCommand(JSON.stringify({ type: "ready.set", ready: true })),
    ).not.toBeNull();
  });
});

describe("parseServerEvent", () => {
  it("parses a sync event", () => {
    const event = parseServerEvent(
      JSON.stringify({
        type: "sync",
        seq: 3,
        serverNow: 1000,
        board: { id: "b1", name: "Sprint 12", createdAt: 1 },
        config: {
          anonymous: false,
          phasePlan: {
            checkin: false,
            vote: false,
            discuss: false,
            close: false,
          },
        },
        phase: "write",
        timer: { endsAt: null, pausedRemainingMs: null },
        you: {
          id: "p1",
          name: "Anna",
          color: "#E8590C",
          role: "facilitator",
          online: true,
          sessionKey: "sk",
        },
        roster: [],
        readyIds: [],
        columns: [],
        notes: [],
      }),
    );
    expect(event?.type).toBe("sync");
  });

  it("rejects events with a bad shape", () => {
    expect(
      parseServerEvent(JSON.stringify({ type: "sync", seq: "x" })),
    ).toBeNull();
  });
});
