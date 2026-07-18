import { useTranslation } from "react-i18next";
import { useConnection } from "../lib/connection.js";
import { useBoardStore } from "../store/boardStore.js";

const SCORES = [1, 2, 3, 4, 5] as const;

// Return On Time Invested — an anonymous 1-5 closing pulse. Individual scores
// never leave the server; everyone sees the running average.
export function RotiPoll() {
  const { t } = useTranslation();
  const { send } = useConnection();
  const roti = useBoardStore((store) => store.state.roti);

  return (
    <section
      data-testid="roti-poll"
      className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5 text-center"
    >
      <p className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
        {t("roti.title")}
      </p>
      <p className="text-sm text-zinc-500">{t("roti.question")}</p>
      <div className="flex gap-2">
        {SCORES.map((score) => (
          <button
            key={score}
            type="button"
            data-testid={`roti-${score}`}
            aria-pressed={roti.yourScore === score}
            onClick={() => send({ type: "roti.set", score })}
            className={`size-10 rounded-full text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              roti.yourScore === score
                ? "bg-accent text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {score}
          </button>
        ))}
      </div>
      {roti.average !== null ? (
        <p
          data-testid="roti-result"
          className="text-sm text-zinc-500 tabular-nums"
        >
          {t("roti.result", { average: roti.average, count: roti.count })}
        </p>
      ) : roti.count > 0 ? (
        <p
          data-testid="roti-pending"
          className="text-xs text-zinc-400 tabular-nums"
        >
          {t("roti.pending", { count: roti.count })}
        </p>
      ) : (
        <p className="text-xs text-zinc-400">{t("roti.anonymous")}</p>
      )}
    </section>
  );
}
