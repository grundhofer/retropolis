// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext } from "react";
import type { ClientCommand, ServerEvent } from "@retropolis/shared";

export interface BoardConnection {
  send: (command: ClientCommand) => void;
  /** Send a mutating command and optimistically apply its expected outcome(s)
   *  through the shared reducer (seq 0 = local echo). */
  mutate: (
    command: ClientCommand,
    optimistic: ServerEvent | ServerEvent[],
  ) => void;
}

const ConnectionContext = createContext<BoardConnection | null>(null);

export const ConnectionProvider = ConnectionContext.Provider;

export function useConnection(): BoardConnection {
  const connection = useContext(ConnectionContext);
  if (connection === null)
    throw new Error("useConnection outside of a board room");
  return connection;
}
