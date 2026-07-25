import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  generateHexId,
  phaseRevealed,
  type Column,
  type Note,
  type Participant,
  type Phase,
  type ServerEvent,
} from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";
import { GifPicker } from "./GifPicker.js";
import { NOTE_DRAG_MIME, NoteCard } from "./NoteCard.js";

export interface DecidingState {
  voteActive: boolean;
  /** your own votes (blind voting — nobody else's ever reach the client) */
  mine: Record<string, number>;
  remaining: number;
  maxPerTarget: number | null;
  /** tallies/crowns are shown from the discussion phase on */
  talliesShown: boolean;
  tallies: Record<string, number> | null;
  topTargetIds: string[];
  focusId: string | null;
}

export interface BoardColumnsProps {
  columns: Column[];
  notes: Note[];
  /** write-phase anonymized note totals per column (all authors); used to show
   *  "N cards from the team" without leaking author or text */
  columnCounts: Record<string, number>;
  roster: Participant[];
  you: Participant;
  phase: Phase;
  editing: Record<string, string>;
  isAdmin: boolean;
  presenterId: string | null;
  deciding: DecidingState;
  gifsEnabled: boolean;
}

type ColumnItem =
  | { kind: "note"; note: Note }
  | { kind: "stack"; groupId: string; notes: Note[] };

export function BoardColumns(props: BoardColumnsProps) {
  const { columns, notes, phase, isAdmin, deciding } = props;
  const { t } = useTranslation();
  const { mutate } = useConnection();

  function castVote(targetId: string, delta: 1 | -1) {
    const current = deciding.mine[targetId] ?? 0;
    const next = current + delta;
    if (next < 0) return;
    const yourVotes = { ...deciding.mine };
    if (next === 0) delete yourVotes[targetId];
    else yourVotes[targetId] = next;
    mutate(
      { type: "vote.cast", opId: generateHexId(), targetId, delta },
      { type: "vote.progress", yourVotes },
    );
  }
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");

  // Curation callbacks live here — building optimistic echoes needs the full
  // note list, which the cards themselves don't have.
  function groupNotes(sourceNoteId: string, target: Note) {
    const source = notes.find((n) => n.id === sourceNoteId);
    if (!source || source.id === target.id) return;
    const groupId = target.groupId ?? target.id; // deterministic, matches the server
    if (source.groupId === groupId) return;
    const events: ServerEvent[] = [];
    if (target.groupId === null) {
      events.push({
        type: "note.updated",
        seq: 0,
        note: { ...target, groupId },
      });
    }
    events.push({
      type: "note.updated",
      seq: 0,
      note: { ...source, groupId, columnId: target.columnId },
    });
    mutate(
      {
        type: "note.group",
        opId: generateHexId(),
        noteId: source.id,
        targetNoteId: target.id,
      },
      events,
    );
  }

  function ungroupNote(note: Note) {
    mutate(
      { type: "note.ungroup", opId: generateHexId(), noteId: note.id },
      { type: "note.updated", seq: 0, note: { ...note, groupId: null } },
    );
  }

  function moveNote(sourceNoteId: string, columnId: string) {
    const source = notes.find((n) => n.id === sourceNoteId);
    if (!source) return;
    if (source.columnId === columnId && source.groupId === null) return;
    mutate(
      { type: "note.move", opId: generateHexId(), noteId: source.id, columnId },
      {
        type: "note.updated",
        seq: 0,
        note: { ...source, columnId, groupId: null },
      },
    );
  }

  function addColumn(event: React.FormEvent) {
    event.preventDefault();
    const name = newColumnName.trim();
    if (name === "") return;
    const columnId = generateHexId();
    const order = (columns[columns.length - 1]?.order ?? -1) + 1;
    mutate(
      { type: "admin.column.create", opId: generateHexId(), columnId, name },
      {
        type: "column.created",
        seq: 0,
        column: { id: columnId, name, order, hidden: false, rect: null },
      },
    );
    setNewColumnName("");
    setAddingColumn(false);
  }

  // Reorganizing is frozen once voting starts (stacks are votables).
  const allowColumnDrop = phase === "write" || phase === "present";

  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-4">
      {columns.map((column) => (
        <BoardColumn
          key={column.id}
          column={column}
          {...props}
          onDropNote={groupNotes}
          onUngroup={ungroupNote}
          onMoveToColumn={allowColumnDrop ? moveNote : null}
          onVote={castVote}
        />
      ))}
      {isAdmin ? (
        <div className="w-64 shrink-0">
          {addingColumn ? (
            <form onSubmit={addColumn} className="flex flex-col gap-2">
              <input
                autoFocus
                value={newColumnName}
                onChange={(event) => setNewColumnName(event.target.value)}
                maxLength={60}
                placeholder={t("column.namePlaceholder")}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong"
                >
                  {t("column.add")}
                </button>
                <button
                  type="button"
                  onClick={() => setAddingColumn(false)}
                  className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
                >
                  {t("note.cancel")}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingColumn(true)}
              className="w-full rounded-xl border-2 border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-300 hover:text-zinc-500 focus-visible:outline-2 focus-visible:outline-accent"
            >
              + {t("column.addColumn")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BoardColumn({
  column,
  notes,
  columnCounts,
  roster,
  you,
  phase,
  editing,
  isAdmin,
  presenterId,
  deciding,
  gifsEnabled,
  onDropNote,
  onUngroup,
  onMoveToColumn,
  onVote,
}: BoardColumnsProps & {
  column: Column;
  onDropNote: (sourceNoteId: string, target: Note) => void;
  onUngroup: (note: Note) => void;
  onMoveToColumn: ((sourceNoteId: string, columnId: string) => void) | null;
  onVote: (targetId: string, delta: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const { mutate } = useConnection();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(column.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Presenting isolation: while someone holds the mic, EVERY screen (incl. the
  // facilitator's, who may be sharing it) shows only that person's cards, so
  // the room's attention is on the speaker. Between presenters (nobody current)
  // the full board is back for grouping/overview.
  const isolating = phase === "present" && presenterId !== null;

  // order is per-author (pre-reveal privacy: a global counter would leak the
  // hidden note count), so ties across authors are broken by id for stability.
  const columnNotes = notes
    .filter(
      (note) =>
        note.columnId === column.id &&
        (!isolating || note.authorId === presenterId),
    )
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  // Write-phase "cards exist" signal: how many of the column's cards belong to
  // OTHER people. Before the reveal the client only holds its own notes, so
  // (server total − my own) is exactly everyone else's — no author, no text.
  const othersCardCount =
    phase === "write"
      ? Math.max(0, (columnCounts[column.id] ?? 0) - columnNotes.length)
      : 0;

  // Stacks: notes sharing a groupId render together, at the position of the
  // stack's first note.
  // Stacks only render in revealed phases: after a rewind your own grouped
  // notes would otherwise show as unbreakable ×1 stacks (partners hidden).
  const stacksVisible = phaseRevealed(phase);
  const items: ColumnItem[] = [];
  const seenGroups = new Set<string>();
  for (const note of columnNotes) {
    if (note.groupId === null || !stacksVisible) {
      items.push({ kind: "note", note });
    } else if (!seenGroups.has(note.groupId)) {
      seenGroups.add(note.groupId);
      items.push({
        kind: "stack",
        groupId: note.groupId,
        notes: columnNotes.filter((n) => n.groupId === note.groupId),
      });
    }
  }

  // Ghost cards: colleagues writing in this column right now — activity
  // without content (write phase only; from present on the notes are visible).
  const ghosts =
    phase === "write"
      ? Object.entries(editing)
          .filter(
            ([participantId, columnId]) =>
              columnId === column.id && participantId !== you.id,
          )
          .map(([participantId]) => roster.find((p) => p.id === participantId))
          .filter((p): p is Participant => p !== undefined)
      : [];

  function submitRename(event: React.FormEvent) {
    event.preventDefault();
    const name = renameValue.trim();
    if (name === "" || name === column.name) {
      setRenaming(false);
      return;
    }
    mutate(
      {
        type: "admin.column.rename",
        opId: generateHexId(),
        columnId: column.id,
        name,
      },
      { type: "column.renamed", seq: 0, column: { ...column, name } },
    );
    setRenaming(false);
  }

  function deleteColumn() {
    mutate(
      {
        type: "admin.column.delete",
        opId: generateHexId(),
        columnId: column.id,
      },
      { type: "column.deleted", seq: 0, columnId: column.id },
    );
  }

  function toggleHidden() {
    const hidden = !column.hidden;
    mutate(
      {
        type: "admin.column.setHidden",
        opId: generateHexId(),
        columnId: column.id,
        hidden,
      },
      { type: "column.updated", seq: 0, column: { ...column, hidden } },
    );
  }

  const cardProps = {
    roster,
    you,
    phase,
    isAdmin,
    presenterId,
    onDropNote,
    onUngroup,
  };

  return (
    <section
      className={`w-72 shrink-0 ${column.hidden ? "opacity-60" : ""}`}
      aria-label={column.name}
      onDragOver={(event) => {
        if (
          onMoveToColumn !== null &&
          event.dataTransfer.types.includes(NOTE_DRAG_MIME)
        ) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (onMoveToColumn === null) return;
        const sourceId = event.dataTransfer.getData(NOTE_DRAG_MIME);
        if (sourceId === "") return;
        event.preventDefault();
        onMoveToColumn(sourceId, column.id);
      }}
    >
      <header className="mb-2 flex items-center gap-1.5">
        {renaming ? (
          <form onSubmit={submitRename} className="flex-1">
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={submitRename}
              maxLength={60}
              className="w-full rounded border border-zinc-300 px-2 py-0.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent"
            />
          </form>
        ) : (
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
              {columnNotes.length}
            </span>
          </h2>
        )}
        {isAdmin && !renaming ? (
          <>
            <button
              type="button"
              data-testid="column-hide-toggle"
              aria-label={column.hidden ? t("column.reveal") : t("column.hide")}
              aria-pressed={column.hidden}
              onClick={toggleHidden}
              className="rounded px-1 text-sm text-zinc-400 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
            >
              {column.hidden ? "🙈" : "👁"}
            </button>
            <button
              type="button"
              aria-label={t("column.rename")}
              onClick={() => {
                setRenameValue(column.name);
                setRenaming(true);
              }}
              className="rounded px-1 text-sm text-zinc-400 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
            >
              ✎
            </button>
            {confirmingDelete ? (
              <button
                type="button"
                onClick={deleteColumn}
                onBlur={() => setConfirmingDelete(false)}
                className="rounded bg-red-700 px-2 py-0.5 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-red-700"
              >
                {t("column.reallyDelete")}
              </button>
            ) : (
              <button
                type="button"
                aria-label={t("column.delete")}
                onClick={() => setConfirmingDelete(true)}
                className="rounded px-1 text-sm text-zinc-400 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
              >
                🗑
              </button>
            )}
          </>
        ) : null}
      </header>

      <div className="flex flex-col gap-2">
        {items.map((item, index) => {
          const targetId = item.kind === "note" ? item.note.id : item.groupId;
          return (
            <TargetFrame
              key={targetId}
              targetId={targetId}
              deciding={deciding}
              onVote={onVote}
            >
              {item.kind === "note" ? (
                <NoteCard note={item.note} revealIndex={index} {...cardProps} />
              ) : (
                <div
                  data-testid="note-stack"
                  className="flex flex-col gap-1.5 rounded-2xl border border-accent/30 bg-accent/5 p-1.5"
                >
                  <span className="px-1.5 text-xs font-semibold text-accent-strong tabular-nums">
                    ×{item.notes.length}
                  </span>
                  {item.notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      revealIndex={index}
                      {...cardProps}
                    />
                  ))}
                </div>
              )}
            </TargetFrame>
          );
        })}
        {isolating && items.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-zinc-300">—</p>
        ) : null}
        {ghosts.map((ghost) => (
          <div
            key={ghost.id}
            data-testid="ghost-card"
            className="rounded-xl border border-dashed border-zinc-200 bg-white/60 p-3"
          >
            <div className="flex items-center gap-2">
              <span
                className="size-2.5 animate-pulse rounded-full"
                style={{ backgroundColor: ghost.color }}
              />
              <span className="text-xs text-zinc-400">
                {t("note.ghostWriting", { name: ghost.name })}
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              <div className="h-2 w-4/5 animate-pulse rounded bg-zinc-100" />
              <div className="h-2 w-3/5 animate-pulse rounded bg-zinc-100" />
            </div>
          </div>
        ))}
        {othersCardCount > 0 ? (
          <div
            data-testid="team-cards"
            className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-3 py-2"
          >
            <div className="space-y-1.5">
              <div className="h-2 w-4/5 rounded bg-zinc-200/70" />
              <div className="h-2 w-3/5 rounded bg-zinc-200/70" />
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              {t("rail.teamCards", { count: othersCardCount })}
            </p>
          </div>
        ) : null}
        {phaseAllowsComposer(phase) && !isolating ? (
          <NoteComposer
            columnId={column.id}
            you={you}
            notes={columnNotes}
            gifsEnabled={gifsEnabled}
          />
        ) : null}
      </div>
    </section>
  );
}

// Chrome around each votable (ungrouped note or stack): the blind vote
// control during voting, crown/tally/focus once discussion opened.
function TargetFrame({
  targetId,
  deciding,
  onVote,
  children,
}: {
  targetId: string;
  deciding: DecidingState;
  onVote: (targetId: string, delta: 1 | -1) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const rank = deciding.topTargetIds.indexOf(targetId);
  const focused = deciding.focusId === targetId;
  const dim = deciding.focusId !== null && !focused;
  const myCount = deciding.mine[targetId] ?? 0;
  const tally = deciding.talliesShown
    ? deciding.tallies?.[targetId]
    : undefined;
  const plusDisabled =
    deciding.remaining <= 0 ||
    (deciding.maxPerTarget !== null && myCount >= deciding.maxPerTarget);

  return (
    <div
      data-testid="vote-target"
      className={`rounded-2xl transition-opacity ${
        focused ? "ring-2 ring-accent ring-offset-2" : ""
      } ${dim ? "opacity-40" : ""}`}
    >
      {deciding.talliesShown && (rank >= 0 || tally !== undefined) ? (
        <div className="mb-1 flex items-center gap-1.5 px-1">
          {rank >= 0 ? (
            <span
              data-testid="crown"
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
            >
              👑 {rank + 1}
            </span>
          ) : null}
          {tally !== undefined ? (
            <span
              data-testid="tally"
              className="text-xs text-zinc-500 tabular-nums"
            >
              {tally} ●
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
      {deciding.voteActive ? (
        <div
          data-testid="vote-control"
          className="mt-1 flex items-center justify-end gap-1.5"
        >
          <button
            type="button"
            data-testid="vote-minus"
            aria-label={t("vote.minus")}
            disabled={myCount === 0}
            onClick={() => onVote(targetId, -1)}
            className="size-6 rounded-full border border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-30"
          >
            −
          </button>
          <span
            data-testid="vote-count"
            className={`min-w-5 text-center text-sm font-semibold tabular-nums ${
              myCount > 0 ? "text-accent-strong" : "text-zinc-300"
            }`}
          >
            {myCount}
          </span>
          <button
            type="button"
            data-testid="vote-plus"
            aria-label={t("vote.plus")}
            disabled={plusDisabled}
            onClick={() => onVote(targetId, 1)}
            className="size-6 rounded-full bg-accent text-sm text-white hover:bg-accent-strong disabled:opacity-30"
          >
            +
          </button>
        </div>
      ) : null}
    </div>
  );
}

function phaseAllowsComposer(phase: Phase): boolean {
  return phase === "write" || phase === "present";
}

function NoteComposer({
  columnId,
  you,
  notes,
  gifsEnabled,
}: {
  columnId: string;
  you: Participant;
  notes: Note[];
  gifsEnabled: boolean;
}) {
  const { t } = useTranslation();
  const { send, mutate } = useConnection();
  const [text, setText] = useState("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  // The GIF popover is portaled to <body> with fixed coordinates so it escapes
  // the columns' horizontal-scroll container (which clips absolute children and
  // made the picker overflow onto neighbouring columns). Anchored above the
  // button, clamped to the viewport.
  const [gifAnchor, setGifAnchor] = useState<{
    left: number;
    bottom: number;
  } | null>(null);

  function toggleGif() {
    if (gifOpen) {
      setGifOpen(false);
      return;
    }
    const rect = gifButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 288; // GifPicker is w-72
      setGifAnchor({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - rect.top + 6,
      });
    }
    setGifOpen(true);
  }

  function submit() {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const noteId = generateHexId();
    // Matches the server's per-author ordering rule.
    const own = notes.filter((note) => note.authorId === you.id);
    const order = Math.max(0, ...own.map((note) => note.order)) + 1;
    mutate(
      {
        type: "note.create",
        opId: generateHexId(),
        noteId,
        columnId,
        text: trimmed,
        gifUrl,
      },
      {
        type: "note.created",
        seq: 0,
        note: {
          id: noteId,
          columnId,
          authorId: you.id,
          text: trimmed,
          gifUrl,
          order,
          x: null,
          y: null,
          groupId: null,
          reactions: {},
        },
      },
    );
    setText("");
    setGifUrl(null);
    setGifOpen(false);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        value={text}
        data-testid={`composer-${columnId}`}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => send({ type: "presence.editing", columnId })}
        onBlur={() => send({ type: "presence.editing", columnId: null })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        maxLength={500}
        rows={2}
        placeholder={t("note.placeholder")}
        className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-zinc-300 focus-visible:outline-2 focus-visible:outline-accent"
      />
      {gifUrl !== null ? (
        <div className="relative mt-1 w-fit">
          <img src={gifUrl} alt="" className="max-h-24 rounded-lg" />
          <button
            type="button"
            onClick={() => setGifUrl(null)}
            aria-label={t("gif.remove")}
            className="absolute -top-1.5 -right-1.5 rounded-full bg-zinc-800 px-1.5 text-xs text-white"
          >
            ✕
          </button>
        </div>
      ) : null}
      <div className="mt-1 flex items-center gap-2">
        {text.trim() !== "" ? (
          <button
            type="submit"
            className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("note.add")}
          </button>
        ) : null}
        {gifsEnabled && gifUrl === null ? (
          <>
            <button
              ref={gifButtonRef}
              type="button"
              data-testid={`composer-gif-${columnId}`}
              onClick={toggleGif}
              className="rounded-lg border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50"
            >
              🎞 {t("gif.add")}
            </button>
            {gifOpen && gifAnchor
              ? createPortal(
                  <div className="fixed inset-0 z-50">
                    <button
                      type="button"
                      aria-label={t("note.cancel")}
                      tabIndex={-1}
                      onClick={() => setGifOpen(false)}
                      className="absolute inset-0 cursor-default"
                    />
                    <div
                      className="absolute"
                      style={{
                        left: gifAnchor.left,
                        bottom: gifAnchor.bottom,
                      }}
                    >
                      <GifPicker
                        onPick={(url) => {
                          setGifUrl(url);
                          setGifOpen(false);
                        }}
                        onClose={() => setGifOpen(false)}
                      />
                    </div>
                  </div>,
                  document.body,
                )
              : null}
          </>
        ) : null}
      </div>
    </form>
  );
}
