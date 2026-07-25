import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  clampUnit,
  generateHexId,
  scatterPos,
  type Column,
  type Note,
  type Participant,
  type Phase,
  type ServerEvent,
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
}

interface DragState {
  noteId: string;
  pointerId: number;
  dx: number;
  dy: number;
}

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

const ZONE_H = 720; // px — a tall zone gives room to spread, so zoom/pan earn their keep
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

// Freeform board: each zone is a column; notes are placed anywhere inside their
// zone by a normalized (x,y). Dragging is smooth LOCALLY (a CSS transform) and
// commits exactly ONE note.move on pointer-up — never per-frame — so the canvas
// costs no more on the wire than a classic column drag (free-tier sacred). The
// whole board sits in a zoom/pan viewport (view state is local, no wire cost).
export function BoardCanvas({
  columns,
  notes,
  columnCounts,
  roster,
  you,
  phase,
  isAdmin,
  presenterId,
}: BoardCanvasProps) {
  const { t } = useTranslation();
  const { mutate } = useConnection();
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoneRefs = useRef<Map<string, HTMLElement>>(new Map());
  const dragOrigin = useRef({ x: 0, y: 0 });
  const panning = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    active: boolean;
  } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [composing, setComposing] = useState<{
    columnId: string;
    x: number;
    y: number;
  } | null>(null);

  function fitView() {
    const vp = viewportRef.current;
    const world = worldRef.current;
    if (!vp || !world) return;
    // measure at scale 1 (scrollWidth/Height are layout-box sizes, transform-free)
    const worldH = world.scrollHeight;
    const worldW = world.scrollWidth;
    const zoom = clampZoom(Math.min(1, (vp.clientHeight - 24) / worldH));
    setView({
      zoom,
      panX: Math.max(0, (vp.clientWidth - worldW * zoom) / 2),
      panY: 12,
    });
  }

  // Start fitted so the whole board is visible; the user zooms in to read.
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
        "[data-testid='note-card'], [data-testid='canvas-composer'], [data-canvas-control]",
      )
    ) {
      return; // a card / composer / control interaction, not a pan
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
    const pan = panning.current;
    if (!pan || event.pointerId !== pan.pointerId) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    // Only begin panning past a small threshold, so a click / double-click to
    // drop a note is never swallowed (and capture doesn't eat the dblclick).
    if (!pan.active) {
      if (Math.hypot(dx, dy) < 4) return;
      pan.active = true;
      try {
        event.currentTarget.setPointerCapture(pan.pointerId);
      } catch {
        // capture may be rejected for synthetic pointers — pan still works
      }
    }
    setView((v) => ({ ...v, panX: pan.panX + dx, panY: pan.panY + dy }));
  }
  function onViewportPointerUp(event: React.PointerEvent) {
    if (panning.current?.pointerId === event.pointerId) panning.current = null;
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
    event.stopPropagation(); // don't also start a board pan
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // synthetic pointers may reject capture; drag still works
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
      const rect = el.getBoundingClientRect(); // on-screen rect ⇒ zoom/pan-safe
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
    if (target === null) return; // dropped outside any zone → snap back
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

  // Tidy: arrange the cards you can move into a neat per-zone grid — in ONE
  // note.moveMany frame (never a loop of note.move: inbound frames bill 20:1).
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
    // A card is 11rem (176px) wide; fit as many columns as the zone's actual
    // width allows (≥192px per slot) so tidied cards never overlap.
    const CARD_SLOT = 192;
    for (const [columnId, zoneNotes] of byZone) {
      zoneNotes.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const zoneEl = zoneRefs.current.get(columnId);
      const zoneW = zoneEl
        ? zoneEl.getBoundingClientRect().width / view.zoom
        : 260;
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
          ref={worldRef}
          className="absolute top-0 left-0 grid w-full items-stretch gap-4 p-1"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {columns.map((column) => {
            const zoneNotes = notes.filter((n) => n.columnId === column.id);
            const othersCount =
              phase === "write"
                ? Math.max(0, (columnCounts[column.id] ?? 0) - zoneNotes.length)
                : 0;
            return (
              <section
                key={column.id}
                aria-label={column.name}
                className={`flex flex-col rounded-2xl border border-zinc-200 bg-white/60 ${
                  column.hidden ? "opacity-60" : ""
                }`}
                style={{ height: ZONE_H }}
              >
                <header className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
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
                    const rect = event.currentTarget.getBoundingClientRect();
                    setComposing({
                      columnId: column.id,
                      x: clampUnit((event.clientX - rect.left) / rect.width),
                      y: clampUnit((event.clientY - rect.top) / rect.height),
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
              </section>
            );
          })}
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
