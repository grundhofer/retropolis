import { Hono } from "hono";
import { z } from "zod";
import {
  boardLocaleSchema,
  boardNameSchema,
  EXPORT_FORMATS,
  exportContentType,
  renderExport,
  templateColumnNames,
  templateKeySchema,
  type ExportFormat,
} from "@retropolis/shared";
import { boardStub } from "./board-stub.js";
import { searchGifs } from "./gifs.js";
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

// Export a board. Anyone with the (capability) board id may export; author
// names are excluded by default — pass ?authors=true to include them.
app.get("/api/boards/:id/export", async (c) => {
  const boardId = c.req.param("id");
  if (!isSecretShaped(boardId)) {
    return c.json({ error: "BOARD_NOT_FOUND" }, 404);
  }
  const format = (c.req.query("format") ?? "md") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) {
    return c.json({ error: "INVALID_FORMAT" }, 400);
  }
  const includeAuthors = c.req.query("authors") === "true";
  const data = await boardStub(c.env, boardId).exportBoard(includeAuthors);
  if (data === null) {
    return c.json({ error: "BOARD_NOT_FOUND" }, 404);
  }
  const safeName =
    data.boardName.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") ||
    "retro";
  return new Response(renderExport(format, data), {
    headers: {
      "content-type": exportContentType(format),
      "content-disposition": `attachment; filename="${safeName}.${format}"`,
    },
  });
});

// GIF search proxy — keeps the KLIPY key server-side and hides employee IPs /
// search terms from the provider. Degrades to empty when no key is configured.
app.get("/api/gifs/search", async (c) => {
  const query = c.req.query("q") ?? "";
  const locale = c.req.query("locale") ?? "en";
  const result = await searchGifs(c.env, query.slice(0, 100), locale);
  return c.json(result, 200, {
    // brief edge cache for repeated popular queries
    "cache-control": "public, max-age=300",
  });
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
