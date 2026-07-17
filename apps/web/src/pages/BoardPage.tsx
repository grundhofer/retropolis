import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { BoardInfo, ClientCommand, ServerEvent } from "@retropolis/shared";
import { AvatarRow } from "../components/AvatarRow.js";
import { BoardColumns } from "../components/BoardColumns.js";
import { LanguageToggle } from "../components/LanguageToggle.js";
import { PhaseStepper } from "../components/PhaseStepper.js";
import { ReadyBar } from "../components/ReadyBar.js";
import { Roster } from "../components/Roster.js";
import { ShareLink } from "../components/ShareLink.js";
import { TimerPanel } from "../components/TimerPanel.js";
import { fetchBoardInfo } from "../lib/api.js";
import { playTimerChime, soundEnabled } from "../lib/beep.js";
import { ConnectionProvider, type BoardConnection } from "../lib/connection.js";
import {
  ensureSessionKey,
  loadAdminToken,
  loadDisplayName,
  saveDisplayName,
  saveSessionKey,
} from "../lib/session.js";
import { BoardSocket } from "../lib/socket.js";
import { useBoardStore } from "../store/boardStore.js";

type Gate =
  | { step: "loading" }
  | { step: "missing" }
  | { step: "join"; board: BoardInfo }
  | { step: "room"; board: BoardInfo; displayName: string };

export function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const [gate, setGate] = useState<Gate>({ step: "loading" });

  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;
    void fetchBoardInfo(boardId).then(
      (board) => {
        if (cancelled) return;
        setGate(board === null ? { step: "missing" } : { step: "join", board });
      },
      () => {
        if (!cancelled) setGate({ step: "missing" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  if (!boardId) return <NotFound />;
  switch (gate.step) {
    case "loading":
      return null;
    case "missing":
      return <NotFound />;
    case "join":
      return (
        <JoinGate
          board={gate.board}
          onJoin={(displayName) =>
            setGate({ step: "room", board: gate.board, displayName })
          }
        />
      );
    case "room":
      return (
        <Room
          boardId={boardId}
          board={gate.board}
          displayName={gate.displayName}
        />
      );
  }
}

function JoinGate({
  board,
  onJoin,
}: {
  board: BoardInfo;
  onJoin: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => loadDisplayName() ?? "");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    saveDisplayName(trimmed);
    onJoin(trimmed);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="font-semibold text-zinc-800">{t("app.name")}</span>
        <LanguageToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-4">
          <h1 className="text-2xl font-semibold text-zinc-900">
            {t("join.title", { board: board.name })}
          </h1>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">
              {t("join.yourName")}
            </span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
          <button
            type="submit"
            disabled={name.trim() === ""}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          >
            {t("join.submit")}
          </button>
        </form>
      </main>
    </div>
  );
}

function Room({
  boardId,
  board,
  displayName,
}: {
  boardId: string;
  board: BoardInfo;
  displayName: string;
}) {
  const { t } = useTranslation();
  const state = useBoardStore((store) => store.state);
  const status = useBoardStore((store) => store.status);
  const socketRef = useRef<BoardSocket | null>(null);

  // Stable connection facade over whichever socket is currently alive. User
  // interactions can only happen after the effect below has run, so the ref
  // is always populated by then.
  const connection = useMemo<BoardConnection>(
    () => ({
      send: (command: ClientCommand) => socketRef.current?.send(command),
      mutate: (command, optimistic) => {
        useBoardStore.getState().dispatch(optimistic);
        socketRef.current?.send(command);
      },
    }),
    [],
  );

  useEffect(() => {
    const { dispatch, setStatus, setClockOffset } = useBoardStore.getState();
    const socket = new BoardSocket({
      boardId,
      join: () => ({
        type: "join",
        name: displayName,
        sessionKey: ensureSessionKey(boardId),
        adminToken: loadAdminToken(boardId) ?? undefined,
      }),
      onEvent: (event: ServerEvent) => {
        if (event.type === "sync") {
          saveSessionKey(boardId, event.you.sessionKey);
          setClockOffset(event.serverNow - Date.now());
        }
        if (event.type === "timer.changed") {
          setClockOffset(event.serverNow - Date.now());
        }
        if (event.type === "timer.ended" && soundEnabled()) {
          playTimerChime();
        }
        if (
          event.type === "reject" ||
          (event.type === "error" && event.code === "NOT_JOINED")
        ) {
          // An optimistic prediction was wrong (race, permission, phase) or a
          // command raced the join — the snapshot is tiny, so the recovery is
          // a full resync.
          socket.send({ type: "resync" });
        }
        dispatch(event);
      },
      onStatus: setStatus,
    });
    socketRef.current = socket;

    return () => {
      socket.close();
      socketRef.current = null;
      useBoardStore.getState().reset();
    };
  }, [boardId, displayName]);

  const you = state.you;
  const isAdmin = you?.role === "facilitator";
  const phasePlan = state.config?.phasePlan;
  const inLobby = state.phase === "lobby";

  const onlineCount = useMemo(
    () => state.roster.filter((p) => p.online).length,
    [state.roster],
  );

  if (you === null || phasePlan === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-50 text-zinc-400">
        {t("status.connecting")}
      </div>
    );
  }

  return (
    <ConnectionProvider value={connection}>
      <div className="flex min-h-dvh flex-col bg-zinc-50">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-200 bg-white px-6 py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="font-semibold text-zinc-800">{t("app.name")}</span>
            <h1 className="truncate text-zinc-600">
              {state.board?.name ?? board.name}
            </h1>
          </div>
          <div className="mx-auto">
            <PhaseStepper
              phase={state.phase}
              phasePlan={phasePlan}
              isAdmin={isAdmin}
            />
          </div>
          <div className="flex items-center gap-3">
            <AvatarRow participants={state.roster} />
            <LanguageToggle />
          </div>
        </header>

        {status !== "online" ? (
          <div
            role="status"
            className="bg-amber-100 px-6 py-2 text-sm text-amber-900"
          >
            {status === "connecting"
              ? t("status.connecting")
              : t("status.offline")}
          </div>
        ) : null}

        {!inLobby && state.phase !== "done" ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-100 bg-white/60 px-6 py-2">
            <TimerPanel timer={state.timer} isAdmin={isAdmin} />
            <ReadyBar
              readyIds={state.readyIds}
              roster={state.roster}
              youId={you.id}
            />
          </div>
        ) : null}

        <main className="flex-1 px-6 py-6">
          {inLobby ? (
            <div className="mx-auto flex max-w-2xl flex-col gap-8">
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <p className="mb-4 text-sm text-zinc-500">
                  {t("lobby.hint", { count: onlineCount })}
                </p>
                <ShareLink boardId={boardId} />
              </div>
              <Roster participants={state.roster} youId={you.id} />
            </div>
          ) : state.phase === "done" ? (
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
              <h2 className="text-2xl font-semibold text-zinc-900">
                {t("done.title")}
              </h2>
              <p className="text-zinc-500">{t("done.body")}</p>
            </div>
          ) : (
            <BoardColumns
              columns={state.columns}
              notes={state.notes}
              roster={state.roster}
              you={you}
              phase={state.phase}
              editing={state.editing}
              isAdmin={isAdmin}
            />
          )}
        </main>
      </div>
    </ConnectionProvider>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-zinc-50 px-6">
      <h1 className="text-2xl font-semibold text-zinc-900">
        {t("notFound.title")}
      </h1>
      <p className="text-zinc-500">{t("notFound.body")}</p>
      <Link
        to="/"
        className="text-accent underline underline-offset-4 hover:text-accent-strong"
      >
        {t("notFound.home")}
      </Link>
    </div>
  );
}
