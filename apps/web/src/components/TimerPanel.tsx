import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Timer } from "@retropolis/shared";
import { setSoundEnabled, soundEnabled } from "../lib/beep.js";
import { useConnection } from "../lib/connection.js";
import { useNow } from "../lib/useNow.js";
import { useBoardStore } from "../store/boardStore.js";

// Read once at module load — only this component toggles it afterwards.
const initialSound = soundEnabled();

export function TimerPanel({
  timer,
  isAdmin,
}: {
  timer: Timer;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const clockOffsetMs = useBoardStore((store) => store.clockOffsetMs);
  const now = useNow();
  const [sound, setSound] = useState(initialSound);

  const running = timer.endsAt !== null;
  const paused = timer.pausedRemainingMs !== null;

  const remainingMs = running
    ? Math.max(0, (timer.endsAt ?? 0) - (now + clockOffsetMs))
    : (timer.pausedRemainingMs ?? 0);

  const idle = !running && !paused;
  const nearEnd = running && remainingMs < 60_000;

  return (
    <div className="flex items-center gap-2">
      {!idle ? (
        <span
          data-testid="timer-display"
          role="timer"
          className={`font-mono text-lg tabular-nums ${
            nearEnd ? "font-semibold text-red-700" : "text-zinc-700"
          } ${paused ? "opacity-50" : ""}`}
        >
          {formatMs(remainingMs)}
          {paused ? (
            <span className="ml-1 text-xs">{t("timer.paused")}</span>
          ) : null}
        </span>
      ) : null}

      {isAdmin ? (
        <div className="flex items-center gap-1">
          {idle ? (
            <>
              {[5, 10, 15].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() =>
                    send({
                      type: "admin.timer.start",
                      durationSec: minutes * 60,
                    })
                  }
                  className="rounded-lg border border-zinc-200 px-2 py-0.5 text-sm text-zinc-600 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {minutes}m
                </button>
              ))}
            </>
          ) : (
            <>
              {running ? (
                <AdminButton
                  onClick={() => send({ type: "admin.timer.pause" })}
                >
                  {t("timer.pause")}
                </AdminButton>
              ) : (
                <AdminButton
                  onClick={() => send({ type: "admin.timer.resume" })}
                >
                  {t("timer.resume")}
                </AdminButton>
              )}
              <AdminButton
                onClick={() => send({ type: "admin.timer.extend", addSec: 60 })}
              >
                +1m
              </AdminButton>
              <AdminButton onClick={() => send({ type: "admin.timer.stop" })}>
                {t("timer.stop")}
              </AdminButton>
            </>
          )}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setSoundEnabled(!sound);
          setSound(!sound);
        }}
        aria-pressed={sound}
        aria-label={t("timer.sound")}
        className="rounded px-1 text-sm text-zinc-400 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {sound ? "🔔" : "🔕"}
      </button>
    </div>
  );
}

function AdminButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-zinc-200 px-2 py-0.5 text-sm text-zinc-600 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}

function formatMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
