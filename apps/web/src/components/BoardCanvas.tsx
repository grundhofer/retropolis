// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  clampUnit,
  clampZoneRect,
  defaultZoneRect,
  generateHexId,
  scatterPos,
  type Column,
  type Note,
  type Participant,
  type Phase,
  type ServerEvent,
  type ZoneRect,
} from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";
import { NoteCard } from "./NoteCard.js";

export interface BoardCanvasProps {
  columns: Column[];
  notes: Note[];
  columnCounts: Record<string, number>;
  roster: Participant[];
  you: Participant;
  phase: Phase;
  editing: Record<string, string>;
  isAdmin: boolean;
  presenterId: string | null;
  gifsEnabled: boolean;
  /** other participants' live cursors (normalized world position) — only ever
   *  populated while cursorsEnabled */
  cursors: Record<string, { x: number; y: number }>;
  cursorsEnabled: boolean;
}

interface DragState {
  noteId: string;
  pointerId: number;
  dx: number;
  dy: number;
}

interface ZoneDrag {
  columnId: string;
  mode: "move" | "resize";
  pointerId: number;
  orig: ZoneRect;
  startX: number;
  startY: number;
  rect: ZoneRect;
}

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

// A fixed logical world the zones live on; the viewport zooms/pans over it.
const WORLD_W = 1600;
const WORLD_H = 1000;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

// Freeform board: each zone is a column, freely placed/sized on a fixed world;
// notes are placed anywhere inside their zone by a normalized (x,y). Dragging a
// card commits exactly ONE note.move on pointer-up — never per-frame — so the
// canvas costs no more on the wire than a classic column drag (free-tier
// sacred). Moving/sizing a zone likewise commits one admin.column.setRect.
export function BoardCanvas({
  columns,
  notes,
  columnCounts,
  roster,
  you,
  phase,
  isAdmin,
  presenterId,
  cursors,
  cursorsEnabled,
}: BoardCanvasProps) {
  const { t } = useTranslation();
  const { mutate, send } = useConnection();
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastCursorAt = useRef(0);
  const zoneRefs = useRef<Map<string, HTMLElement>>(new Map());
  const dragOrigin = useRef({ x: 0, y: 0 });
  const zoneDragRef = useRef<ZoneDrag | null>(null);
  const panning = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    active: boolean;
  } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [zoneDrag, setZoneDrag] = useState<ZoneDrag | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [composing, setComposing] = useState<{
    columnId: string;
    x: number;
    y: number;
  } | null>(null);

  const ordered = [...columns].sort((a, b) => a.order - b.order);
  function rectOf(column: Column): ZoneRect {
    if (zoneDrag?.columnId === column.id) return zoneDrag.rect;
    if (column.rect) return column.rect;
    return defaultZoneRect(
      ordered.findIndex((c) => c.id === column.id),
      ordered.length,
    );
  }

  function fitView() {
    const vp = viewportRef.current;
    if (!vp) return;
    const zoom = clampZoom(
      Math.min(
        (vp.clientWidth - 24) / WORLD_W,
        (vp.clientHeight - 24) / WORLD_H,
      ),
    );
    setView({
      zoom,
      panX: (vp.clientWidth - WORLD_W * zoom) / 2,
      panY: (vp.clientHeight - WORLD_H * zoom) / 2,
    });
  }

  const didFit = useRef(false);
  useLayoutEffect(() => {
    if (didFit.current) return;
    didFit.current = true;
    fitView();
  }, []);

  // Non-passive wheel: ctrl/⌘ + wheel zooms around the cursor, plain wheel pans.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = vp.getBoundingClientRect();
      setView((v) => {
        if (event.ctrlKey || event.metaKey) {
          const cx = event.clientX - rect.left;
          const cy = event.clientY - rect.top;
          const zoom = clampZoom(v.zoom * Math.exp(-event.deltaY * 0.002));
          const wx = (cx - v.panX) / v.zoom;
          const wy = (cy - v.panY) / v.zoom;
          return { zoom, panX: cx - wx * zoom, panY: cy - wy * zoom };
        }
        return {
          ...v,
          panX: v.panX - event.deltaX,
          panY: v.panY - event.deltaY,
        };
      });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  function zoomBy(factor: number) {
    const vp = viewportRef.current;
    if (!vp) return;
    setView((v) => {
      const cx = vp.clientWidth / 2;
      const cy = vp.clientHeight / 2;
      const zoom = clampZoom(v.zoom * factor);
      const wx = (cx - v.panX) / v.zoom;
      const wy = (cy - v.panY) / v.zoom;
      return { zoom, panX: cx - wx * zoom, panY: cy - wy * zoom };
    });
  }

  // --- panning the board (drag on empty background) ---
  function onViewportPointerDown(event: React.PointerEvent) {
    if (
      (event.target as HTMLElement).closest(
        "[data-testid='note-card'], [data-testid='canvas-composer'], [data-canvas-control], [data-zone-handle]",
      )
    ) {
      return;
    }
    panning.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: view.panX,
      panY: view.panY,
      active: false,
    };
  }
  function onViewportPointerMove(event: React.PointerEvent) {
    // Broadcast our cursor (throttled ~5Hz) while cursors are enabled — the
    // ONLY continuous stream on the board, and it runs only when opted in.
    if (cursorsEnabled && event.timeStamp - lastCursorAt.current > 200) {
      const vp = viewportRef.current;
      if (vp) {
        const rect = vp.getBoundingClientRect();
        lastCursorAt.current = event.timeStamp;
        send({
          type: "presence.cursor",
          x: clampUnit(
            (event.clientX - rect.left - view.panX) / (view.zoom * WORLD_W),
          ),
          y: clampUnit(
            (event.clientY - rect.top - view.panY) / (view.zoom * WORLD_H),
          ),
        });
      }
    }
    // A zone move/resize in flight takes priority over panning.
    const zd = zoneDragRef.current;
    if (zd && event.pointerId === zd.pointerId) {
      const dxFrac = (event.clientX - zd.startX) / (WORLD_W * view.zoom);
      const dyFrac = (event.clientY - zd.startY) / (WORLD_H * view.zoom);
      const rect =
        zd.mode === "move"
          ? { ...zd.orig, x: zd.orig.x + dxFrac, y: zd.orig.y + dyFrac }
          : { ...zd.orig, w: zd.orig.w + dxFrac, h: zd.orig.h + dyFrac };
      const clamped = clampZoneRect(rect);
      zoneDragRef.current = { ...zd, rect: clamped };
      setZoneDrag(zoneDragRef.current);
      return;
    }
    const pan = panning.current;
    if (!pan || event.pointerId !== pan.pointerId) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (!pan.active) {
      if (Math.hypot(dx, dy) < 4) return;
      pan.active = true;
      try {
        event.currentTarget.setPointerCapture(pan.pointerId);
      } catch {
        // synthetic pointers may reject capture — pan still works
      }
    }
    setView((v) => ({ ...v, panX: pan.panX + dx, panY: pan.panY + dy }));
  }
  function onViewportPointerUp(event: React.PointerEvent) {
    const zd = zoneDragRef.current;
    if (zd && event.pointerId === zd.pointerId) {
      zoneDragRef.current = null;
      setZoneDrag(null);
      const column = columns.find((c) => c.id === zd.columnId);
      const original = column?.rect ?? null;
      // Only commit a real change.
      if (
        original === null ||
        original.x !== zd.rect.x ||
        original.y !== zd.rect.y ||
        original.w !== zd.rect.w ||
        original.h !== zd.rect.h
      ) {
        mutate(
          {
            type: "admin.column.setRect",
            opId: generateHexId(),
            columnId: zd.columnId,
            rect: zd.rect,
          },
          column
            ? {
                type: "column.updated",
                seq: 0,
                column: { ...column, rect: zd.rect },
              }
            : [],
        );
      }
      return;
    }
    if (panning.current?.pointerId === event.pointerId) panning.current = null;
  }

  function beginZoneDrag(
    event: React.PointerEvent,
    column: Column,
    mode: "move" | "resize",
  ) {
    if (!isAdmin) return;
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // synthetic pointers may reject capture
    }
    const start: ZoneDrag = {
      columnId: column.id,
      mode,
      pointerId: event.pointerId,
      orig: rectOf(column),
      startX: event.clientX,
      startY: event.clientY,
      rect: rectOf(column),
    };
    zoneDragRef.current = start;
    setZoneDrag(start);
  }

  // --- dragging a card (commit-on-drop; free-tier sacred) ---
  function positionOf(note: Note): { x: number; y: number } {
    if (note.x !== null && note.y !== null) return { x: note.x, y: note.y };
    return scatterPos(note.id);
  }
  function canMove(note: Note): boolean {
    return (
      phase === "present" || (phase === "write" && note.authorId === you.id)
    );
  }
  function beginDrag(event: React.PointerEvent, note: Note) {
    if (!canMove(note)) return;
    if ((event.target as HTMLElement).closest("button, textarea, input, a")) {
      return;
    }
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // synthetic pointers may reject capture — drag still works
    }
    dragOrigin.current = { x: event.clientX, y: event.clientY };
    setDrag({ noteId: note.id, pointerId: event.pointerId, dx: 0, dy: 0 });
  }
  function moveDrag(event: React.PointerEvent) {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    setDrag({
      ...drag,
      dx: event.clientX - dragOrigin.current.x,
      dy: event.clientY - dragOrigin.current.y,
    });
  }
  function endDrag(event: React.PointerEvent, note: Note) {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    setDrag(null);
    const { clientX, clientY } = event;
    let target: { columnId: string; x: number; y: number } | null = null;
    for (const [columnId, el] of zoneRefs.current) {
      const rect = el.getBoundingClientRect(); // on-screen ⇒ zoom/pan-safe
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        target = {
          columnId,
          x: clampUnit((clientX - rect.left) / rect.width),
          y: clampUnit((clientY - rect.top) / rect.height),
        };
        break;
      }
    }
    if (target === null) return;
    if (
      target.columnId === note.columnId &&
      note.x === target.x &&
      note.y === target.y
    ) {
      return;
    }
    const sameZone = target.columnId === note.columnId;
    mutate(
      {
        type: "note.move",
        opId: generateHexId(),
        noteId: note.id,
        columnId: target.columnId,
        x: target.x,
        y: target.y,
      },
      {
        type: "note.updated",
        seq: 0,
        note: {
          ...note,
          columnId: target.columnId,
          x: target.x,
          y: target.y,
          groupId: sameZone ? note.groupId : null,
        },
      },
    );
  }

  function createNote(columnId: string, x: number, y: number, text: string) {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const noteId = generateHexId();
    const own = notes.filter(
      (n) => n.columnId === columnId && n.authorId === you.id,
    );
    const order = Math.max(0, ...own.map((n) => n.order)) + 1;
    mutate(
      {
        type: "note.create",
        opId: generateHexId(),
        noteId,
        columnId,
        text: trimmed,
        gifUrl: null,
        x,
        y,
      },
      {
        type: "note.created",
        seq: 0,
        note: {
          id: noteId,
          columnId,
          authorId: you.id,
          text: trimmed,
          gifUrl: null,
          order,
          x,
          y,
          groupId: null,
          reactions: {},
        },
      },
    );
  }

  // Tidy: arrange the movable cards into a per-zone grid — ONE note.moveMany
  // frame (never a loop of note.move: inbound frames bill 20:1).
  function tidy() {
    const byZone = new Map<string, Note[]>();
    for (const note of notes) {
      if (!canMove(note)) continue;
      const list = byZone.get(note.columnId);
      if (list) list.push(note);
      else byZone.set(note.columnId, [note]);
    }
    const moves: Array<{
      noteId: string;
      columnId: string;
      x: number;
      y: number;
    }> = [];
    const echoes: ServerEvent[] = [];
    const CARD_SLOT = 192;
    for (const [columnId, zoneNotes] of byZone) {
      zoneNotes.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const zoneEl = zoneRefs.current.get(columnId);
      const zoneW = zoneEl
        ? zoneEl.getBoundingClientRect().width / view.zoom
        : 320;
      const cols = Math.max(
        1,
        Math.min(zoneNotes.length, Math.floor(zoneW / CARD_SLOT)),
      );
      const rows = Math.ceil(zoneNotes.length / cols);
      zoneNotes.forEach((note, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = (col + 0.5) / cols;
        const y = 0.06 + ((row + 0.5) / rows) * 0.88;
        moves.push({ noteId: note.id, columnId, x, y });
        echoes.push({ type: "note.updated", seq: 0, note: { ...note, x, y } });
      });
    }
    if (moves.length === 0) return;
    mutate({ type: "note.moveMany", opId: generateHexId(), moves }, echoes);
  }

  const canTidy = phase === "write" || isAdmin;

  return (
    <div className="relative">
      <div
        data-canvas-control
        className="absolute top-2 right-2 z-40 flex items-center gap-1.5"
      >
        {canTidy ? (
          <button
            type="button"
            data-testid="canvas-tidy"
            onClick={tidy}
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 shadow-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-accent"
          >
            🧹 {t("canvas.tidy")}
          </button>
        ) : null}
        <div className="flex items-center rounded-lg border border-zinc-200 bg-white text-zinc-600 shadow-sm">
          <button
            type="button"
            aria-label={t("canvas.zoomOut")}
            onClick={() => zoomBy(0.8)}
            className="px-2 py-1 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-accent"
          >
            −
          </button>
          <button
            type="button"
            aria-label={t("canvas.fit")}
            onClick={fitView}
            className="min-w-11 border-x border-zinc-200 px-1 py-1 text-center text-xs tabular-nums hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label={t("canvas.zoomIn")}
            onClick={() => zoomBy(1.25)}
            className="px-2 py-1 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-accent"
          >
            +
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        data-testid="canvas-viewport"
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        className="relative h-[72vh] overflow-hidden rounded-2xl border border-zinc-100 bg-zinc-100/40"
        style={{ touchAction: "none" }}
      >
        <div
          className="absolute top-0 left-0"
          style={{
            width: WORLD_W,
            height: WORLD_H,
            transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {ordered.map((column) => {
            const rect = rectOf(column);
            const zoneNotes = notes.filter((n) => n.columnId === column.id);
            const othersCount =
              phase === "write"
                ? Math.max(0, (columnCounts[column.id] ?? 0) - zoneNotes.length)
                : 0;
            return (
              <section
                key={column.id}
                aria-label={column.name}
                className={`absolute flex flex-col rounded-2xl border border-zinc-200 bg-white/60 ${
                  column.hidden ? "opacity-60" : ""
                } ${zoneDrag?.columnId === column.id ? "ring-2 ring-accent/40" : ""}`}
                style={{
                  left: rect.x * WORLD_W,
                  top: rect.y * WORLD_H,
                  width: rect.w * WORLD_W,
                  height: rect.h * WORLD_H,
                }}
              >
                <header
                  data-zone-handle={isAdmin ? "" : undefined}
                  onPointerDown={
                    isAdmin
                      ? (event) => beginZoneDrag(event, column, "move")
                      : undefined
                  }
                  className={`flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 ${
                    isAdmin ? "cursor-move" : ""
                  }`}
                >
                  <h2 className="flex-1 truncate text-sm font-semibold tracking-wide text-zinc-600 uppercase">
                    {column.name}
                    {column.hidden ? (
                      <span
                        data-testid="column-hidden-badge"
                        className="ml-1.5 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 lowercase"
                      >
                        {t("column.hidden")}
                      </span>
                    ) : null}
                    <span className="ml-1.5 font-normal text-zinc-400 tabular-nums">
                      {zoneNotes.length}
                    </span>
                  </h2>
                  {othersCount > 0 ? (
                    <span
                      data-testid="team-cards"
                      className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-400"
                    >
                      {t("rail.teamCards", { count: othersCount })}
                    </span>
                  ) : null}
                </header>

                <div
                  data-testid={`zone-${column.id}`}
                  ref={(el) => {
                    if (el) zoneRefs.current.set(column.id, el);
                    else zoneRefs.current.delete(column.id);
                  }}
                  onDoubleClick={(event) => {
                    if (
                      (event.target as HTMLElement).closest(
                        "[data-testid='note-card']",
                      )
                    ) {
                      return;
                    }
                    const box = event.currentTarget.getBoundingClientRect();
                    setComposing({
                      columnId: column.id,
                      x: clampUnit((event.clientX - box.left) / box.width),
                      y: clampUnit((event.clientY - box.top) / box.height),
                    });
                  }}
                  className="relative flex-1 overflow-hidden rounded-b-2xl"
                >
                  {zoneNotes.map((note, index) => {
                    const pos = positionOf(note);
                    const dragging = drag?.noteId === note.id;
                    return (
                      <div
                        key={note.id}
                        onPointerDown={(event) => beginDrag(event, note)}
                        onPointerMove={moveDrag}
                        onPointerUp={(event) => endDrag(event, note)}
                        style={{
                          position: "absolute",
                          left: `${pos.x * 100}%`,
                          top: `${pos.y * 100}%`,
                          width: "11rem",
                          transform: dragging
                            ? `translate(calc(-50% + ${drag.dx / view.zoom}px), calc(-50% + ${drag.dy / view.zoom}px))`
                            : "translate(-50%, -50%)",
                          zIndex: dragging ? 30 : 1,
                          cursor: canMove(note) ? "grab" : "default",
                          touchAction: "none",
                        }}
                      >
                        <NoteCard
                          note={note}
                          revealIndex={index}
                          roster={roster}
                          you={you}
                          phase={phase}
                          isAdmin={isAdmin}
                          presenterId={presenterId}
                          draggable={false}
                          onDropNote={() => {}}
                          onUngroup={(n) =>
                            mutate(
                              {
                                type: "note.ungroup",
                                opId: generateHexId(),
                                noteId: n.id,
                              },
                              {
                                type: "note.updated",
                                seq: 0,
                                note: { ...n, groupId: null },
                              },
                            )
                          }
                        />
                      </div>
                    );
                  })}

                  {composing?.columnId === column.id ? (
                    <CanvasComposer
                      x={composing.x}
                      y={composing.y}
                      onCommit={(text) => {
                        createNote(column.id, composing.x, composing.y, text);
                        setComposing(null);
                      }}
                      onCancel={() => setComposing(null)}
                    />
                  ) : null}

                  {zoneNotes.length === 0 &&
                  composing?.columnId !== column.id ? (
                    <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-zinc-300">
                      {t("canvas.hint")}
                    </p>
                  ) : null}
                </div>

                {isAdmin ? (
                  <button
                    type="button"
                    data-zone-handle=""
                    aria-label={t("canvas.resize")}
                    onPointerDown={(event) =>
                      beginZoneDrag(event, column, "resize")
                    }
                    className="absolute right-0 bottom-0 size-5 cursor-nwse-resize rounded-br-2xl text-zinc-300 hover:text-zinc-500"
                    style={{ touchAction: "none" }}
                  >
                    ⤡
                  </button>
                ) : null}
              </section>
            );
          })}

          {cursorsEnabled
            ? roster.map((p) => {
                if (p.id === you.id) return null;
                const c = cursors[p.id];
                if (!c) return null;
                return (
                  <div
                    key={p.id}
                    data-testid="live-cursor"
                    className="pointer-events-none absolute z-40"
                    style={{
                      left: c.x * WORLD_W,
                      top: c.y * WORLD_H,
                      // counter the world scale so cursors stay a readable size
                      transform: `scale(${1 / view.zoom})`,
                      transformOrigin: "0 0",
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      className="drop-shadow"
                    >
                      <path
                        d="M1 1 L1 13 L4.5 9.5 L7 15 L9 14 L6.5 8.5 L11.5 8.5 Z"
                        fill={p.color}
                        stroke="white"
                        strokeWidth="1"
                      />
                    </svg>
                    <span
                      className="-mt-1 ml-3 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.name}
                    </span>
                  </div>
                );
              })
            : null}
        </div>
      </div>
    </div>
  );
}

function CanvasComposer({
  x,
  y,
  onCommit,
  onCancel,
}: {
  x: number;
  y: number;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  return (
    <textarea
      autoFocus
      value={text}
      data-testid="canvas-composer"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => (text.trim() === "" ? onCancel() : onCommit(text))}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onCommit(text);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      rows={2}
      maxLength={500}
      placeholder={t("note.placeholder")}
      style={{
        position: "absolute",
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: "11rem",
        transform: "translate(-50%, -50%)",
        zIndex: 40,
      }}
      className="resize-none rounded-xl border border-accent bg-white px-3 py-2 text-sm shadow-md focus-visible:outline-2 focus-visible:outline-accent"
    />
  );
}
