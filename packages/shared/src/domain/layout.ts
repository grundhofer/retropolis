// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";
import type { Phase } from "./phases.js";

// A board renders EITHER as classic columns (each a vertical list) or as a
// freeform canvas where notes are placed into labelled zones. A "zone" is just
// a column — so voting, grouping, export and the write-phase privacy filter all
// keep working unchanged; canvas only adds a per-note position.
// Master gate for live cursors. FALSE = the feature is fully built but cannot
// be activated at all: the client never sends/renders cursors, the settings
// toggle is hidden, and the server refuses to enable them. Flip to true (one
// line) to make cursors reachable again — only when the Cloudflare free-tier
// cost is acceptable (a paid plan or bounded usage), since cursor streams bill
// inbound frames 20:1.
export const CURSORS_ACTIVATABLE = false;

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

// A zone (column) can be freely placed/sized on the canvas. Its rectangle is
// normalized [0,1] fractions of a fixed logical world; null = "auto", laid out
// in a row by defaultZoneRect. columnId stays authoritative — rect is only how
// the zone is drawn on a canvas board (ignored in column mode).
export const zoneRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.05).max(1),
  h: z.number().min(0.05).max(1),
});
export type ZoneRect = z.infer<typeof zoneRectSchema>;

// Default placement for a zone with no stored rect: an even row across the
// world, so a board that never customized still reads like tidy columns.
export function defaultZoneRect(index: number, count: number): ZoneRect {
  const n = Math.max(1, count);
  const gap = 0.015;
  const w = (1 - gap * (n + 1)) / n;
  return { x: gap + index * (w + gap), y: 0.02, w, h: 0.96 };
}

export function clampZoneRect(rect: ZoneRect): ZoneRect {
  const w = Math.min(1, Math.max(0.05, rect.w));
  const h = Math.min(1, Math.max(0.05, rect.h));
  return {
    w,
    h,
    x: Math.min(1, Math.max(0, rect.x)),
    y: Math.min(1, Math.max(0, rect.y)),
  };
}
