// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { boardInfoSchema, type BoardInfo } from "@retropolis/shared";
import { z } from "zod";

const createBoardResponseSchema = z.object({
  boardId: z.string(),
  adminToken: z.string(),
});

export async function createBoard(
  name: string,
  template: string,
  locale: string,
  layout: "columns" | "canvas" = "columns",
): Promise<{ boardId: string; adminToken: string }> {
  const response = await fetch("/api/boards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, template, locale, layout }),
  });
  if (!response.ok) throw new Error(`create board failed: ${response.status}`);
  return createBoardResponseSchema.parse(await response.json());
}

// Duplicate a board's structure (columns/config/agreements) into a fresh
// board. Gated server-side on the source admin token; returns the new board's
// id + admin token. No notes/votes/participants carry over.
export async function duplicateBoard(
  sourceId: string,
  name: string,
  adminToken: string,
): Promise<{ boardId: string; adminToken: string }> {
  const response = await fetch(`/api/boards/${sourceId}/duplicate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, adminToken }),
  });
  if (!response.ok) {
    throw new Error(`duplicate board failed: ${response.status}`);
  }
  return createBoardResponseSchema.parse(await response.json());
}

export async function fetchBoardInfo(
  boardId: string,
): Promise<BoardInfo | null> {
  const response = await fetch(`/api/boards/${boardId}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`fetch board failed: ${response.status}`);
  const data = z
    .object({ board: boardInfoSchema })
    .parse(await response.json());
  return data.board;
}
