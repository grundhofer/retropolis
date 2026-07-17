import { create } from "zustand";
import {
  applyServerEvent,
  initialBoardState,
  type ClientBoardState,
  type ServerEvent,
} from "@retropolis/shared";
import type { ConnectionStatus } from "../lib/socket.js";

interface BoardStore {
  state: ClientBoardState;
  status: ConnectionStatus;
  /** serverNow - clientNow, captured when sync/timer events arrive; the timer
   *  renders off the server clock. */
  clockOffsetMs: number;
  dispatch: (event: ServerEvent) => void;
  setStatus: (status: ConnectionStatus) => void;
  setClockOffset: (offsetMs: number) => void;
  reset: () => void;
}

// Server events flow through the shared reducer — the store itself holds no
// board logic (architecture doc §3: the React app is a thin renderer).
export const useBoardStore = create<BoardStore>()((set) => ({
  state: initialBoardState,
  status: "connecting",
  clockOffsetMs: 0,
  dispatch: (event) =>
    set((store) => ({ state: applyServerEvent(store.state, event) })),
  setStatus: (status) => set({ status }),
  setClockOffset: (clockOffsetMs) => set({ clockOffsetMs }),
  reset: () =>
    set({ state: initialBoardState, status: "connecting", clockOffsetMs: 0 }),
}));
