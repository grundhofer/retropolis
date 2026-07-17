import { createContext, useContext } from "react";
import type { ClientCommand, ServerEvent } from "@retropolis/shared";

export interface BoardConnection {
  send: (command: ClientCommand) => void;
  /** Send a mutating command and optimistically apply its expected outcome
   *  through the shared reducer (seq 0 = local echo). */
  mutate: (command: ClientCommand, optimistic: ServerEvent) => void;
}

const ConnectionContext = createContext<BoardConnection | null>(null);

export const ConnectionProvider = ConnectionContext.Provider;

export function useConnection(): BoardConnection {
  const connection = useContext(ConnectionContext);
  if (connection === null)
    throw new Error("useConnection outside of a board room");
  return connection;
}
