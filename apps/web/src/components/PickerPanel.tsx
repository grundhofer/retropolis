import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  pickerFinished,
  pickerKnows,
  WHEEL_HOLD_MS,
  type Participant,
  type PickerState,
} from "@retropolis/shared";
import { burstConfetti } from "../lib/confetti.js";
import { useConnection } from "../lib/connection.js";
import { useNow } from "../lib/useNow.js";
import { useBoardStore } from "../store/boardStore.js";

export interface PickerPanelProps {
  picker: PickerState | null;
  roster: Participant[];
  isAdmin: boolean;
}

// The rotation: spin → present → spin … until the pool is empty. Presented
// people are visibly checked off; the history doubles as meeting progress.
export function PickerPanel({ picker, roster, isAdmin }: PickerPanelProps) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const lastSpin = useBoardStore((store) => store.state.lastSpin);
  const clockOffsetMs = useBoardStore((store) => store.clockOffsetMs);
  const now = useNow();
  // belt-and-braces with the server's in-flight guard: no spinning while the
  // wheel (or the winner card) is still up
  const spinning =
    lastSpin !== null &&
    now <
      lastSpin.startAt - clockOffsetMs + lastSpin.durationMs + WHEEL_HOLD_MS;

  const finished = picker !== null && pickerFinished(picker);
  const celebrated = useRef(false);
  useEffect(() => {
    if (finished && !celebrated.current) {
      celebrated.current = true;
      void burstConfetti();
    }
    if (!finished) celebrated.current = false;
  }, [finished]);

  if (picker === null) return null;
  const byId = new Map(roster.map((p) => [p.id, p]));
  const current =
    picker.current === null ? undefined : byId.get(picker.current);
  const excluded = picker.excluded
    .map((id) => byId.get(id))
    .filter((p): p is Participant => p !== undefined);
  const notInRotation = roster.filter(
    (p) => p.online && !pickerKnows(picker, p.id),
  );

  const spinLabel =
    picker.remaining.length > 0
      ? picker.current !== null || picker.presented.length > 0
        ? t("picker.next")
        : t("picker.spin")
      : picker.current !== null
        ? t("picker.finishRound")
        : null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span aria-live="polite">
        {finished ? (
          <span
            data-testid="picker-finished"
            className="text-sm font-medium text-accent-strong"
          >
            {t("picker.everyone")}
          </span>
        ) : current ? (
          <span
            data-testid="presenter-banner"
            className="flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-sm font-medium text-accent-strong"
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: current.color }}
            />
            🎤 {t("picker.presenting", { name: current.name })}
            {isAdmin ? (
              <button
                type="button"
                onClick={() => send({ type: "admin.picker.skip" })}
                className="ml-1 rounded px-1 text-xs text-accent-strong/70 underline-offset-2 hover:underline"
              >
                {t("picker.skip")}
              </button>
            ) : null}
          </span>
        ) : null}
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        {picker.presented.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <span
              key={id}
              className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-400 line-through"
            >
              ✓ {p.name}
            </span>
          );
        })}
        {picker.remaining.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <span
              key={id}
              className={`flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 ${
                p.online ? "" : "opacity-40"
              }`}
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              {p.name}
              {isAdmin ? (
                <button
                  type="button"
                  aria-label={t("picker.exclude", { name: p.name })}
                  onClick={() =>
                    send({ type: "admin.picker.exclude", participantId: id })
                  }
                  className="text-zinc-300 hover:text-zinc-500"
                >
                  ×
                </button>
              ) : null}
            </span>
          );
        })}
        {isAdmin
          ? [...excluded, ...notInRotation].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  send({ type: "admin.picker.include", participantId: p.id })
                }
                className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-600"
              >
                + {p.name}
              </button>
            ))
          : null}
      </div>

      {isAdmin && spinLabel !== null ? (
        <button
          type="button"
          data-testid="spin-button"
          disabled={spinning}
          onClick={() => send({ type: "admin.picker.spin" })}
          className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
        >
          🎡 {spinLabel}
        </button>
      ) : null}
    </div>
  );
}
