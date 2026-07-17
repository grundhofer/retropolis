import { Hono } from "hono";
import { z } from "zod";
import {
  boardLocaleSchema,
  boardNameSchema,
  templateColumnNames,
  templateKeySchema,
} from "@retropolis/shared";
import { boardStub } from "./board-stub.js";
import { generateSecret, isSecretShaped } from "./ids.js";

export { BoardRoom } from "./board-room.js";

const createBoardRequestSchema = z.object({
  name: boardNameSchema,
  template: templateKeySchema.default("went-well"),
  locale: boardLocaleSchema.default("en"),
});

const app = new Hono<{ Bindings: Env }>();

app.post("/api/boards", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = createBoardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "INVALID_REQUEST" }, 400);
  }
  const boardId = generateSecret();
  const adminToken = generateSecret();
  // Template columns are materialized in the creator's language at creation —
  // column names are board data, editable afterwards.
  const columns = templateColumnNames(
    parsed.data.template,
    parsed.data.locale,
  ).map((name, index) => ({ id: generateSecret(), name, order: index }));
  await boardStub(c.env, boardId).initialize({
    boardId,
    name: parsed.data.name,
    adminToken,
    columns,
  });
  return c.json({ boardId, adminToken });
});

app.get("/api/boards/:id", async (c) => {
  const boardId = c.req.param("id");
  if (!isSecretShaped(boardId)) {
    return c.json({ error: "BOARD_NOT_FOUND" }, 404);
  }
  const board = await boardStub(c.env, boardId).info();
  if (board === null) {
    return c.json({ error: "BOARD_NOT_FOUND" }, 404);
  }
  return c.json({ board });
});

app.get("/api/boards/:id/ws", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "EXPECTED_WEBSOCKET" }, 426);
  }
  const boardId = c.req.param("id");
  if (!isSecretShaped(boardId)) {
    return c.json({ error: "BOARD_NOT_FOUND" }, 404);
  }
  // Forwarded to the DO, which finishes the upgrade (or 404s for boards that
  // were never created — every id resolves to a DO, existence is a meta row).
  return boardStub(c.env, boardId).fetch(c.req.raw);
});

export default app;
