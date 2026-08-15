// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SELF } from "cloudflare:test";
import { expect } from "vitest";
import { parseServerEvent, type ServerEvent } from "@retropolis/shared";

export async function createBoard(
  name = "Sprint 12",
  options: {
    template?: string;
    locale?: string;
    checkin?: boolean;
    layout?: "columns" | "canvas";
  } = {},
): Promise<{
  boardId: string;
  adminToken: string;
}> {
  const response = await SELF.fetch("https://example.com/api/boards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, ...options }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { boardId: string; adminToken: string };
}

export interface TestSocket {
  ws: WebSocket;
  events: ServerEvent[];
  /** Waits until an event matching the predicate has arrived (including past events). */
  waitFor(predicate: (event: ServerEvent) => boolean): Promise<ServerEvent>;
  send(command: unknown): void;
}

export async function connect(boardId: string): Promise<TestSocket> {
  const response = await SELF.fetch(
    `https://example.com/api/boards/${boardId}/ws`,
    {
      headers: { Upgrade: "websocket" },
    },
  );
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  if (!ws) throw new Error("no websocket on 101 response");
  ws.accept();

  const events: ServerEvent[] = [];
  const waiters: Array<() => void> = [];
  ws.addEventListener("message", (event) => {
    const parsed = parseServerEvent(event.data);
    if (parsed) {
      events.push(parsed);
      for (const wake of waiters.splice(0)) wake();
    }
  });

  return {
    ws,
    events,
    async waitFor(predicate) {
      const deadline = Date.now() + 2000;
      for (;;) {
        const match = events.find(predicate);
        if (match) return match;
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for event; saw: ${JSON.stringify(events)}`,
          );
        }
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 50);
        });
      }
    },
    send(command) {
      ws.send(JSON.stringify(command));
    },
  };
}
