import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnection } from "../lib/connection.js";

export interface CheckinPanelProps {
  icebreakerId: string | null;
  workingAgreements: string;
  isAdmin: boolean;
}

// The warm-up: an icebreaker question the room answers, the Prime Directive,
// and editable working agreements. The actual sharing happens out loud; the
// ready-check (in the phase bar) signals who has checked in.
export function CheckinPanel({
  icebreakerId,
  workingAgreements,
  isAdmin,
}: CheckinPanelProps) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const [showDirective, setShowDirective] = useState(true);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-center">
        <p className="mb-2 text-sm font-semibold tracking-wide text-accent uppercase">
          {t("checkin.icebreaker")}
        </p>
        <p
          data-testid="icebreaker-question"
          className="text-xl font-medium text-zinc-800"
        >
          {icebreakerId !== null
            ? t(`icebreaker.${icebreakerId}`)
            : t("checkin.noQuestion")}
        </p>
        {isAdmin ? (
          <button
            type="button"
            data-testid="icebreaker-shuffle"
            onClick={() => send({ type: "admin.checkin.shuffle" })}
            className="mt-4 rounded-lg border border-zinc-200 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-accent"
          >
            🔀 {t("checkin.shuffle")}
          </button>
        ) : null}
      </section>

      {showDirective ? (
        <section className="relative rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <button
            type="button"
            onClick={() => setShowDirective(false)}
            aria-label={t("note.cancel")}
            className="absolute top-2 right-3 text-sm text-amber-700/60 hover:text-amber-700"
          >
            ✕
          </button>
          <p className="mb-1 text-sm font-semibold text-amber-800">
            {t("checkin.primeDirectiveTitle")}
          </p>
          <p className="text-sm text-amber-900/90 italic">
            {t("checkin.primeDirective")}
          </p>
        </section>
      ) : null}

      <WorkingAgreements
        text={workingAgreements}
        isAdmin={isAdmin}
        onSave={(next) => send({ type: "admin.agreements.set", text: next })}
      />
    </div>
  );
}

function WorkingAgreements({
  text,
  isAdmin,
  onSave,
}: {
  text: string;
  isAdmin: boolean;
  onSave: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  // The draft is seeded from the current text each time editing opens (the
  // edit button below), so no prop→state sync effect is needed.
  const [draft, setDraft] = useState(text);
  const display = text.trim() === "" ? t("checkin.agreementsDefault") : text;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
          {t("checkin.agreements")}
        </h2>
        {isAdmin && !editing ? (
          <button
            type="button"
            data-testid="agreements-edit"
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
            className="rounded px-2 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100"
          >
            ✎ {t("checkin.edit")}
          </button>
        ) : null}
      </div>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(draft.trim());
            setEditing(false);
          }}
        >
          <textarea
            autoFocus
            value={draft}
            data-testid="agreements-input"
            onChange={(event) => setDraft(event.target.value)}
            maxLength={1000}
            rows={4}
            className="w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong"
            >
              {t("note.save")}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
            >
              {t("note.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm whitespace-pre-wrap text-zinc-700">{display}</p>
      )}
    </section>
  );
}
