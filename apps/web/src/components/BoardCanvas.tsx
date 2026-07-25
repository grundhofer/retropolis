import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  clampUnit,
  generateHexId,
  scatterPos,
  type Column,
  type Note,
  type Participant,
  type Phase,
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

// Freeform board: each zone is a column; notes are placed anywhere inside their
// zone by a normalized (x,y). Dragging is smooth LOCALLY (a CSS transform) and
// commits exactly ONE note.move on pointer-up — never per-frame — so the canvas
// costs no more on the wire than a classic column drag (free-tier sacred).
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
  // Zone note-layers, for hit-testing a drop and mapping it to a fraction.
  const zoneRefs = useRef<Map<string, HTMLElement>>(new Map());
  const dragOrigin = useRef({ x: 0, y: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [composing, setComposing] = useState<{
    columnId: string;
    x: number;
    y: number;
  } | null>(null);

  function positionOf(note: Note): { x: number; y: number } {
    if (note.x !== null && note.y !== null) return { x: note.x, y: note.y };
    return scatterPos(note.id); // deterministic seed for unplaced cards
  }

  // Before the reveal you move only your own cards; from present on everyone
  // curates the shared board.
  function canMove(note: Note): boolean {
    return (
      phase === "present" || (phase === "write" && note.authorId === you.id)
    );
  }

  function beginDrag(event: React.PointerEvent, note: Note) {
    if (!canMove(note)) return;
    // Never hijack a click on an edit/delete/reaction control inside the card.
    if ((event.target as HTMLElement).closest("button, textarea, input, a")) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // some browsers reject capture for non-primary/synthetic pointers — the
      // drag still works via the document-level move/up on the same element
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
      const rect = el.getBoundingClientRect();
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
      return; // no real change
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
          // Same-zone repositions keep the stack; a cross-zone move splits it.
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

  return (
    <div
      className="grid items-stretch gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}
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
            className={`flex min-h-[60vh] flex-col rounded-2xl border border-zinc-200 bg-white/50 ${
              column.hidden ? "opacity-60" : ""
            }`}
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
                  return; // double-click landed on a card, not empty space
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
                        ? `translate(calc(-50% + ${drag.dx}px), calc(-50% + ${drag.dy}px))`
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

              {zoneNotes.length === 0 && composing?.columnId !== column.id ? (
                <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-zinc-300">
                  {t("canvas.hint")}
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
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
