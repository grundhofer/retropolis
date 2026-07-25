import { useTranslation } from "react-i18next";
import type { Column, Note, Participant, Phase } from "@retropolis/shared";
import { NoteCard } from "./NoteCard.js";

export interface PresenterFocusProps {
  notes: Note[];
  columns: Column[];
  roster: Participant[];
  you: Participant;
  phase: Phase;
  isAdmin: boolean;
  presenter: Participant;
}

// The readable "reader" for the presenting round on a canvas board: instead of
// hunting a sprawling canvas, everyone sees ONLY the current presenter's cards,
// grouped by zone, in one calm centered column. Read-only (reactions kept).
export function PresenterFocus({
  notes,
  columns,
  roster,
  you,
  phase,
  isAdmin,
  presenter,
}: PresenterFocusProps) {
  const { t } = useTranslation();
  const theirs = notes.filter((note) => note.authorId === presenter.id);
  const zones = columns
    .map((column) => ({
      column,
      cards: theirs
        .filter((note) => note.columnId === column.id)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    }))
    .filter((zone) => zone.cards.length > 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="size-3 rounded-full"
          style={{ backgroundColor: presenter.color }}
        />
        <h2 className="text-lg font-semibold text-zinc-800">
          🎤 {t("present.focus.heading", { name: presenter.name })}
        </h2>
        <span className="ml-auto text-sm text-zinc-400 tabular-nums">
          {t("present.focus.count", { count: theirs.length })}
        </span>
      </header>

      {zones.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-200 py-12 text-center text-sm text-zinc-300">
          {t("present.focus.empty")}
        </p>
      ) : (
        zones.map((zone) => (
          <section key={zone.column.id} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              {zone.column.name}
            </h3>
            {zone.cards.map((note, index) => (
              <NoteCard
                key={note.id}
                note={note}
                revealIndex={index}
                roster={roster}
                you={you}
                phase={phase}
                isAdmin={isAdmin}
                presenterId={null}
                interactive={false}
                onDropNote={() => {}}
                onUngroup={() => {}}
              />
            ))}
          </section>
        ))
      )}
    </div>
  );
}
