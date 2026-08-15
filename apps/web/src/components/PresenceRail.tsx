// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  pickerFinished,
  WHEEL_HOLD_MS,
  type Participant,
  type Phase,
  type PickerState,
} from "@retropolis/shared";
import { burstConfetti } from "../lib/confetti.js";
import { useConnection } from "../lib/connection.js";
import { useNow } from "../lib/useNow.js";
import { useBoardStore } from "../store/boardStore.js";

export interface PresenceRailProps {
  phase: Phase;
  roster: Participant[];
  readyIds: string[];
  picker: PickerState | null;
  you: Participant;
  isAdmin: boolean;
}

// The rail wears three hats depending on the phase, but always as ONE list:
//  - "ready"    (write/vote): each row carries a done glyph; your own toggle
//                sits in a separate bottom bay so it can't read as a label.
//  - "present"  the rotation board + facilitator cockpit + presenter self-advance.
//  - "presence" (discuss): just who is here.
type RailMode = "ready" | "present" | "presence";

function modeForPhase(phase: Phase): RailMode {
  if (phase === "present") return "present";
  if (phase === "write" || phase === "vote") return "ready";
  return "presence";
}

// Flightdeck: one docked right-side rail that is a live crew board for everyone
// and, in the presenting phase, the facilitator's cockpit for driving the round.
export function PresenceRail({
  phase,
  roster,
  readyIds,
  picker,
  you,
  isAdmin,
}: PresenceRailProps) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const mode = modeForPhase(phase);

  // Same in-flight guard as the old picker panel: no spinning (or hand-picking)
  // while the wheel is still animating.
  const lastSpin = useBoardStore((store) => store.state.lastSpin);
  const clockOffsetMs = useBoardStore((store) => store.clockOffsetMs);
  const now = useNow();
  const spinning =
    lastSpin !== null &&
    now <
      lastSpin.startAt - clockOffsetMs + lastSpin.durationMs + WHEEL_HOLD_MS;

  const onlineCount = roster.filter((p) => p.online).length;
  const youReady = readyIds.includes(you.id);
  const finished = picker !== null && pickerFinished(picker);

  const celebrated = useRef(false);
  useEffect(() => {
    if (mode === "present" && finished && !celebrated.current) {
      celebrated.current = true;
      void burstConfetti();
    }
    if (!finished) celebrated.current = false;
  }, [finished, mode]);

  // Spin control label — spin, then next … until the pool empties.
  const spinLabel =
    picker === null
      ? null
      : picker.remaining.length > 0
        ? picker.current !== null || picker.presented.length > 0
          ? t("picker.next")
          : t("picker.spin")
        : picker.current !== null
          ? t("picker.finishRound")
          : null;

  const youArePresenting = mode === "present" && picker?.current === you.id;

  return (
    <aside
      aria-label={t("board.participants")}
      className="w-full self-start rounded-2xl border border-zinc-200 bg-white shadow-sm lg:sticky lg:top-4 lg:w-72 lg:shrink-0"
    >
      <div className="flex items-baseline justify-between px-3 py-2.5">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
          {t("board.participants")}
        </h2>
        <span
          className="text-xs text-zinc-400 tabular-nums"
          {...(mode === "ready" ? { "data-testid": "ready-count" } : {})}
        >
          {mode === "ready"
            ? t("ready.count", { ready: readyIds.length, total: onlineCount })
            : t("rail.online", { count: onlineCount })}
        </span>
      </div>

      {mode === "present" && isAdmin && !finished && spinLabel !== null ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-3 py-2">
          <button
            type="button"
            data-testid="spin-button"
            disabled={spinning}
            onClick={() => send({ type: "admin.picker.spin" })}
            className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          >
            🎡 {spinLabel}
          </button>
          {picker?.current != null ? (
            <button
              type="button"
              onClick={() => send({ type: "admin.picker.skip" })}
              className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t("picker.skip")}
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === "present" && finished ? (
        <div className="border-t border-zinc-100 px-3 py-2.5">
          <span
            data-testid="picker-finished"
            className="text-sm font-medium text-accent-strong"
          >
            {t("picker.everyone")}
          </span>
        </div>
      ) : null}

      <ul className="flex flex-col gap-0.5 px-1.5 py-1.5" aria-live="polite">
        {roster.map((p) => (
          <PresenceRow
            key={p.id}
            participant={p}
            youId={you.id}
            mode={mode}
            ready={readyIds.includes(p.id)}
            picker={picker}
            isAdmin={isAdmin}
            spinning={spinning}
          />
        ))}
      </ul>

      {mode === "ready" ? (
        <div className="border-t border-zinc-100 px-3 pt-2.5 pb-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-400">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: you.color }}
            />
            {you.name} {t("roster.you")}
          </p>
          <button
            type="button"
            data-testid="ready-toggle"
            aria-pressed={youReady}
            onClick={() => send({ type: "ready.set", ready: !youReady })}
            className={`w-full rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              youReady
                ? "bg-accent/10 text-accent-strong"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {youReady ? `✓ ${t("ready.done")}` : t("ready.imDone")}
          </button>
        </div>
      ) : null}

      {youArePresenting ? (
        <div className="border-t border-zinc-100 px-3 pt-2.5 pb-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-accent-strong">
            🎤 {t("rail.youPresenting")}
          </p>
          <button
            type="button"
            data-testid="present-done"
            onClick={() => send({ type: "picker.done" })}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("rail.donePresenting")} ›
          </button>
        </div>
      ) : mode === "present" && !isAdmin && !finished ? (
        <div className="border-t border-zinc-100 px-3 py-2.5">
          <p className="text-xs text-zinc-400">{t("rail.waiting")}</p>
        </div>
      ) : null}
    </aside>
  );
}

type RotationStatus =
  "current" | "presented" | "remaining" | "excluded" | "other";

function rotationStatus(
  picker: PickerState | null,
  id: string,
): RotationStatus {
  if (picker === null) return "other";
  if (picker.current === id) return "current";
  if (picker.presented.includes(id)) return "presented";
  if (picker.remaining.includes(id)) return "remaining";
  if (picker.excluded.includes(id)) return "excluded";
  return "other";
}

function PresenceRow({
  participant,
  youId,
  mode,
  ready,
  picker,
  isAdmin,
  spinning,
}: {
  participant: Participant;
  youId: string;
  mode: RailMode;
  ready: boolean;
  picker: PickerState | null;
  isAdmin: boolean;
  spinning: boolean;
}) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const isYou = participant.id === youId;
  const status =
    mode === "present" ? rotationStatus(picker, participant.id) : "other";
  const isCurrent = status === "current";
  const dimmed = !participant.online || status === "excluded";

  return (
    <li
      data-testid={isCurrent ? "presenter-banner" : "rail-row"}
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
        dimmed ? "opacity-45" : ""
      } ${isCurrent ? "bg-accent/10" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`size-3 shrink-0 rounded-full ${
          participant.role === "facilitator"
            ? "ring-2 ring-accent/40 ring-offset-1"
            : ""
        }`}
        style={{ backgroundColor: participant.color }}
      />
      <span
        className={`truncate ${
          status === "presented"
            ? "text-zinc-400 line-through"
            : "text-zinc-700"
        }`}
      >
        {participant.name}
        {isYou ? (
          <span className="text-zinc-400"> {t("roster.you")}</span>
        ) : null}
      </span>

      {mode === "ready" ? (
        <span className="ml-auto">
          {ready ? (
            <span className="text-sm text-accent-strong">✓</span>
          ) : (
            <span
              aria-hidden="true"
              className="block size-3.5 rounded-full border border-zinc-300"
            />
          )}
        </span>
      ) : null}

      {mode === "present" ? (
        <span className="ml-auto flex items-center gap-1">
          {status === "current" ? (
            <span className="flex items-center gap-1 text-xs font-medium text-accent-strong">
              🎤 {t("picker.current")}
            </span>
          ) : status === "presented" ? (
            <span className="text-xs text-zinc-300">✓</span>
          ) : isAdmin && status === "remaining" ? (
            <>
              <button
                type="button"
                data-testid={`pick-${participant.name}`}
                disabled={spinning}
                aria-label={t("picker.pickAria", { name: participant.name })}
                onClick={() =>
                  send({
                    type: "admin.picker.pick",
                    participantId: participant.id,
                  })
                }
                className="rounded-md px-1.5 py-0.5 text-xs font-medium text-accent-strong hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
              >
                {t("picker.pick")} ›
              </button>
              <button
                type="button"
                aria-label={t("picker.exclude", { name: participant.name })}
                onClick={() =>
                  send({
                    type: "admin.picker.exclude",
                    participantId: participant.id,
                  })
                }
                className="rounded px-1 text-xs text-zinc-300 hover:text-zinc-500 focus-visible:outline-2 focus-visible:outline-accent"
              >
                ✕
              </button>
            </>
          ) : isAdmin && status === "excluded" ? (
            <button
              type="button"
              onClick={() =>
                send({
                  type: "admin.picker.include",
                  participantId: participant.id,
                })
              }
              className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-600 focus-visible:outline-2 focus-visible:outline-accent"
            >
              + {t("picker.pick")}
            </button>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}
