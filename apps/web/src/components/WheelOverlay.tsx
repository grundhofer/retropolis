// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SLOT_REELS,
  slotReel,
  wheelTargetRotation,
  type Participant,
  type WheelSpin,
} from "@retropolis/shared";
import { burstConfetti } from "../lib/confetti.js";
import { useNow } from "../lib/useNow.js";
import { useBoardStore } from "../store/boardStore.js";

const HOLD_AFTER_LANDING_MS = 2600;

// Every client renders the SAME spin from the broadcast seed and lands on the
// same name. Reduced-motion (and late joiners) skip straight to the result.
export function WheelOverlay() {
  const spin = useBoardStore((store) => store.state.lastSpin);
  const roster = useBoardStore((store) => store.state.roster);
  const clockOffsetMs = useBoardStore((store) => store.clockOffsetMs);
  const now = useNow();

  if (spin === null) return null;
  const localEnd = spin.startAt - clockOffsetMs + spin.durationMs;
  if (now > localEnd + HOLD_AFTER_LANDING_MS) return null;

  return (
    <SpinScene
      key={spin.startAt}
      spin={spin}
      roster={roster}
      clockOffsetMs={clockOffsetMs}
    />
  );
}

function SpinScene({
  spin,
  roster,
  clockOffsetMs,
}: {
  spin: WheelSpin;
  roster: Participant[];
  clockOffsetMs: number;
}) {
  const { t } = useTranslation();
  const now = useNow();
  // Freeze the skin for this spin's lifetime: SpinScene is keyed by
  // spin.startAt, so it captures the style at mount and a mid-spin picker-style
  // change can't remount (and restart) the animation on every client.
  const [pickerStyle] = useState(
    () => useBoardStore.getState().state.config?.pickerStyle ?? "wheel",
  );
  const reducedMotion =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  const localEnd = spin.startAt - clockOffsetMs + spin.durationMs;
  const landed = reducedMotion || now >= localEnd;
  const winner = roster.find((p) => p.id === spin.winnerId);

  const celebrated = useRef(false);
  useEffect(() => {
    if (landed && !celebrated.current) {
      celebrated.current = true;
      void burstConfetti();
    }
  }, [landed]);

  return (
    <div
      data-testid="wheel-overlay"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-zinc-900/70 backdrop-blur-sm"
    >
      {!reducedMotion ? (
        pickerStyle === "slots" ? (
          <SlotMachine
            spin={spin}
            roster={roster}
            clockOffsetMs={clockOffsetMs}
          />
        ) : (
          <Wheel spin={spin} roster={roster} clockOffsetMs={clockOffsetMs} />
        )
      ) : null}
      <div aria-live="polite" className="min-h-16 text-center">
        {landed && winner ? (
          <div
            data-testid="wheel-winner"
            className="reveal-in rounded-2xl bg-white px-8 py-4 text-2xl font-semibold text-zinc-900 shadow-xl"
          >
            <span
              aria-hidden="true"
              className="mr-3 inline-block size-4 rounded-full"
              style={{ backgroundColor: winner.color }}
            />
            {t("picker.winner", { name: winner.name })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Wheel({
  spin,
  roster,
  clockOffsetMs,
}: {
  spin: WheelSpin;
  roster: Participant[];
  clockOffsetMs: number;
}) {
  const [rotation, setRotation] = useState(0);
  const target = wheelTargetRotation(spin.pool, spin.winnerId, spin.seed);

  useEffect(() => {
    const delay = Math.max(0, spin.startAt - clockOffsetMs - Date.now());
    // double rAF: the browser must paint rotation 0 before the transition runs
    let raf = 0;
    const timeout = setTimeout(() => {
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => setRotation(target));
      });
    }, delay);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(raf);
    };
  }, [spin.startAt, clockOffsetMs, target]);

  const count = spin.pool.length;
  const segment = 360 / count;

  return (
    <svg
      viewBox="-120 -120 240 240"
      className="size-72 drop-shadow-2xl"
      aria-hidden="true"
    >
      <g
        style={{
          transform: `rotate(${rotation}deg)`,
          transition:
            rotation !== 0
              ? `transform ${spin.durationMs}ms cubic-bezier(0.12, 0.85, 0.16, 1)`
              : undefined,
        }}
      >
        <circle r="110" fill="#ffffff" />
        {spin.pool.map((participantId, index) => {
          const participant = roster.find((p) => p.id === participantId);
          const color = participant?.color ?? "#9AA1AD";
          const name = participant?.name ?? "?";
          const midAngle = index * segment + segment / 2 - 90;
          return (
            <g key={participantId}>
              {count === 1 ? (
                <circle r="110" fill={color} />
              ) : (
                <path
                  d={segmentPath(index, count, 110)}
                  fill={color}
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              )}
              <text
                x={Math.cos((midAngle * Math.PI) / 180) * 68}
                y={Math.sin((midAngle * Math.PI) / 180) * 68}
                transform={`rotate(${midAngle + 90} ${Math.cos((midAngle * Math.PI) / 180) * 68} ${Math.sin((midAngle * Math.PI) / 180) * 68})`}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#ffffff"
                fontSize="13"
                fontWeight="600"
              >
                {name.length > 10 ? `${name.slice(0, 9)}…` : name}
              </text>
            </g>
          );
        })}
        <circle r="14" fill="#ffffff" />
      </g>
      {/* pointer at the top */}
      <path d="M -12 -122 L 12 -122 L 0 -96 Z" fill="#20242C" />
    </svg>
  );
}

const SLOT_CELL_PX = 72;
// Reels stop left→right; the last reel lands exactly at durationMs so the
// winner card (SpinScene's `landed`) appears as the final reel settles.
const SLOT_REEL_STAGGER_MS = 450;

// The slot-machine skin: SLOT_REELS vertical reels of participant avatars that
// all land on the winner (jackpot). Every reel's strip + stop is derived from
// the broadcast seed (slotReel), so all clients — and a mid-spin reconnect —
// show the identical result. Purely visual; the winner is the server's draw.
function SlotMachine({
  spin,
  roster,
  clockOffsetMs,
}: {
  spin: WheelSpin;
  roster: Participant[];
  clockOffsetMs: number;
}) {
  return (
    <div
      data-testid="slot-machine"
      aria-hidden="true"
      className="flex gap-3 rounded-3xl bg-white p-5 shadow-2xl"
    >
      {Array.from({ length: SLOT_REELS }, (_, reelIndex) => (
        <Reel
          key={reelIndex}
          spin={spin}
          roster={roster}
          clockOffsetMs={clockOffsetMs}
          reelIndex={reelIndex}
        />
      ))}
    </div>
  );
}

function Reel({
  spin,
  roster,
  clockOffsetMs,
  reelIndex,
}: {
  spin: WheelSpin;
  roster: Participant[];
  clockOffsetMs: number;
  reelIndex: number;
}) {
  const { strip, stopIndex } = useMemo(
    () => slotReel(spin.pool, spin.winnerId, spin.seed, reelIndex),
    [spin.pool, spin.winnerId, spin.seed, reelIndex],
  );
  const [offset, setOffset] = useState(0);
  // Park stopIndex in the middle row of the 3-cell window.
  const finalOffset = -(stopIndex - 1) * SLOT_CELL_PX;
  const durationMs =
    spin.durationMs - (SLOT_REELS - 1 - reelIndex) * SLOT_REEL_STAGGER_MS;

  useEffect(() => {
    const delay = Math.max(0, spin.startAt - clockOffsetMs - Date.now());
    // double rAF: the browser must paint offset 0 before the transition runs
    let raf = 0;
    const timeout = setTimeout(() => {
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => setOffset(finalOffset));
      });
    }, delay);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(raf);
    };
  }, [spin.startAt, clockOffsetMs, finalOffset]);

  return (
    <div
      className="relative w-16 overflow-hidden rounded-xl bg-zinc-100"
      style={{ height: SLOT_CELL_PX * 3 }}
    >
      <div
        style={{
          transform: `translateY(${offset}px)`,
          transition:
            offset !== 0
              ? `transform ${durationMs}ms cubic-bezier(0.12, 0.85, 0.16, 1)`
              : undefined,
        }}
      >
        {strip.map((participantId, index) => {
          const participant = roster.find((p) => p.id === participantId);
          const color = participant?.color ?? "#9AA1AD";
          const name = participant?.name ?? "?";
          return (
            <div
              key={index}
              className="flex items-center justify-center"
              style={{ height: SLOT_CELL_PX }}
            >
              <span
                className="flex size-12 items-center justify-center rounded-full text-lg font-semibold text-white"
                style={{ backgroundColor: color }}
              >
                {name.slice(0, 1).toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>
      {/* center window highlight */}
      <div
        className="pointer-events-none absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-lg ring-2 ring-accent/70"
        style={{ height: SLOT_CELL_PX }}
      />
    </div>
  );
}

function segmentPath(index: number, count: number, radius: number): string {
  const start = ((index * 360) / count - 90) * (Math.PI / 180);
  const end = (((index + 1) * 360) / count - 90) * (Math.PI / 180);
  const largeArc = 360 / count > 180 ? 1 : 0;
  const x0 = radius * Math.cos(start);
  const y0 = radius * Math.sin(start);
  const x1 = radius * Math.cos(end);
  const y1 = radius * Math.sin(end);
  return `M 0 0 L ${x0} ${y0} A ${radius} ${radius} 0 ${largeArc} 1 ${x1} ${y1} Z`;
}
