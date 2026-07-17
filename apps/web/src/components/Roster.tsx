import { useTranslation } from "react-i18next";
import type { Participant } from "@retropolis/shared";

export interface RosterProps {
  participants: Participant[];
  youId: string | null;
}

export function Roster({ participants, youId }: RosterProps) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("board.participants")}>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-zinc-500 uppercase">
        {t("board.participants")}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {participants.map((participant) => (
          <li
            key={participant.id}
            data-testid="roster-item"
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
              participant.online ? "" : "opacity-45"
            }`}
          >
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: participant.color }}
            />
            <span className="truncate text-zinc-800">
              {participant.name}
              {participant.id === youId ? (
                <span className="text-zinc-400"> ({t("board.you")})</span>
              ) : null}
            </span>
            {participant.role === "facilitator" ? (
              <span className="ml-auto rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent-strong">
                {t("board.facilitator")}
              </span>
            ) : null}
            {!participant.online ? (
              <span className="ml-auto text-xs text-zinc-400">
                {t("board.offline")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
