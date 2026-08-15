// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { boardStub } from "../src/board-stub.js";
import { createBoard } from "./helpers.js";

describe("POST /api/boards", () => {
  it("creates a board and returns capability secrets", async () => {
    const { boardId, adminToken } = await createBoard("Sprint 12");
    expect(boardId).toMatch(/^[0-9a-f]{32}$/);
    expect(adminToken).toMatch(/^[0-9a-f]{32}$/);
    expect(boardId).not.toBe(adminToken);
  });

  it("persists board meta into the DO's SQLite", async () => {
    const { boardId } = await createBoard("Retro Alpha");
    const stub = boardStub(env, boardId);
    const name = await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec("SELECT value FROM board_meta WHERE key = 'name'")
        .toArray()[0];
      return row ? String(row.value) : null;
    });
    expect(name).toBe("Retro Alpha");
  });

  it("rejects an invalid body", async () => {
    const response = await SELF.fetch("https://example.com/api/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    expect(response.status).toBe(400);
  });
});

describe("GET /api/boards/:id", () => {
  it("returns board info for an existing board", async () => {
    const { boardId } = await createBoard("Retro Beta");
    const response = await SELF.fetch(
      `https://example.com/api/boards/${boardId}`,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      board: { id: string; name: string };
    };
    expect(data.board).toMatchObject({ id: boardId, name: "Retro Beta" });
  });

  it("404s for unknown or malformed ids", async () => {
    const ghost = "0".repeat(32);
    expect(
      (await SELF.fetch(`https://example.com/api/boards/${ghost}`)).status,
    ).toBe(404);
    expect(
      (await SELF.fetch("https://example.com/api/boards/nope")).status,
    ).toBe(404);
  });
});

describe("GET /api/boards/:id/ws", () => {
  it("requires a websocket upgrade", async () => {
    const { boardId } = await createBoard();
    const response = await SELF.fetch(
      `https://example.com/api/boards/${boardId}/ws`,
    );
    expect(response.status).toBe(426);
  });

  it("404s for a board that was never created", async () => {
    const ghost = "0".repeat(32);
    const response = await SELF.fetch(
      `https://example.com/api/boards/${ghost}/ws`,
      {
        headers: { Upgrade: "websocket" },
      },
    );
    expect(response.status).toBe(404);
  });

  it("404s for a malformed board id without touching a DO", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/boards/not-a-board/ws",
      {
        headers: { Upgrade: "websocket" },
      },
    );
    expect(response.status).toBe(404);
  });
});
