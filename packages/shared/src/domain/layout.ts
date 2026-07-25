import { z } from "zod";
import type { Phase } from "./phases.js";

// A board renders EITHER as classic columns (each a vertical list) or as a
// freeform canvas where notes are placed into labelled zones. A "zone" is just
// a column — so voting, grouping, export and the write-phase privacy filter all
// keep working unchanged; canvas only adds a per-note position.
export const layoutModes = ["columns", "canvas"] as const;
export const layoutModeSchema = z.enum(layoutModes);
export type LayoutMode = z.infer<typeof layoutModeSchema>;

// Canvas positions are normalized fractions INSIDE the note's own zone box, so
// they survive responsive re-tiling and the columns↔canvas toggle (columnId
// stays authoritative). Clamp before sending so a valid drop is never rejected.
export function clampUnit(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

// Which surface the main board area renders. The raw canvas is confined to the
// write phase and the between-presenters overview; everything that must be
// read / highlighted / voted / discussed routes to a structured surface, which
// is what keeps every later-phase feature working and stays readable.
export type BoardSurface = "columns" | "canvas" | "focus";

export function boardSurface(
  layout: LayoutMode,
  phase: Phase,
  hasPresenter: boolean,
): BoardSurface {
  if (layout === "columns") return "columns";
  switch (phase) {
    case "write":
      return "canvas";
    case "present":
      // Someone on stage → the focused reader; nobody yet → calm canvas overview.
      return hasPresenter ? "focus" : "canvas";
    default:
      // vote / discuss (and any structured phase) read specific cards → columns.
      return "columns";
  }
}

// Deterministic pseudo-random position for a note that has no stored position
// yet (e.g. a column board flipped to canvas). Same id → same spot, in-bounds,
// stable across reloads — no data write, no wire traffic.
function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function scatterPos(noteId: string): { x: number; y: number } {
  const hash = hashString(noteId);
  const margin = 0.12;
  const span = 1 - 2 * margin;
  return {
    x: margin + ((hash & 0xffff) / 0xffff) * span,
    y: margin + (((hash >>> 16) & 0xffff) / 0xffff) * span,
  };
}
