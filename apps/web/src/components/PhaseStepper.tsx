import { useTranslation } from "react-i18next";
import {
  enabledPhases,
  nextPhase,
  previousPhase,
  type Phase,
  type PhasePlan,
} from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";

export interface PhaseStepperProps {
  phase: Phase;
  phasePlan: PhasePlan;
  isAdmin: boolean;
}

// The always-visible answer to "where are we in the retro?" — plus the one
// big button the facilitator drives the session with (product spec §12).
export function PhaseStepper({ phase, phasePlan, isAdmin }: PhaseStepperProps) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const sequence = enabledPhases(phasePlan);
  const next = nextPhase(phase, phasePlan);
  const previous = previousPhase(phase, phasePlan);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ol className="flex items-center gap-1" aria-label={t("phase.stepper")}>
        {sequence.map((step, index) => (
          <li key={step} className="flex items-center gap-1">
            {index > 0 ? <span className="text-zinc-300">·</span> : null}
            <span
              aria-current={step === phase ? "step" : undefined}
              className={
                step === phase
                  ? "rounded-full bg-accent px-2.5 py-0.5 text-sm font-medium text-white"
                  : "px-1 text-sm text-zinc-400"
              }
            >
              {t(`phase.${step}`)}
            </span>
          </li>
        ))}
      </ol>
      {isAdmin ? (
        <div className="flex items-center gap-1.5">
          {previous !== null ? (
            <button
              type="button"
              data-testid="phase-back"
              onClick={() => send({ type: "admin.phase.set", phase: previous })}
              className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
            >
              ← {t(`phase.${previous}`)}
            </button>
          ) : null}
          {next !== null ? (
            <button
              type="button"
              data-testid="phase-next"
              onClick={() => send({ type: "admin.phase.set", phase: next })}
              className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {phase === "lobby"
                ? t("phase.startRetro")
                : `${t("phase.next")}: ${t(`phase.${next}`)}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
