import { WebSocket as ReconnectingWebSocket } from "partysocket";
import {
  parseServerEvent,
  type ClientCommand,
  type ServerEvent,
} from "@retropolis/shared";

export type ConnectionStatus = "connecting" | "online" | "offline";

export interface BoardSocketOptions {
  boardId: string;
  /** Called on every (re)connect — the join carries the stored session key,
   *  so a reconnect reclaims identity and the fresh `sync` resyncs state. */
  join: () => Extract<ClientCommand, { type: "join" }>;
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
}

const HEARTBEAT_INTERVAL_MS = 30_000; // Cloudflare idle timeout is ~100s; the DO answers without waking

export class BoardSocket {
  private readonly ws: ReconnectingWebSocket;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  // Commands must never travel before this connection's `join` frame — the
  // server drops un-joined traffic. partysocket's own queue flushes BEFORE
  // the open event (i.e. before our join), so library buffering is disabled
  // and BoardSocket queues offline commands itself, flushing them right
  // after join. Client-minted idempotent ids make the replay safe.
  private joinedThisConnection = false;
  private pending: ClientCommand[] = [];

  constructor(options: BoardSocketOptions) {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${location.host}/api/boards/${options.boardId}/ws`;
    options.onStatus("connecting");

    this.ws = new ReconnectingWebSocket(url, [], { maxEnqueuedMessages: 0 });
    this.ws.addEventListener("open", () => {
      options.onStatus("online");
      this.ws.send(JSON.stringify(options.join()));
      this.joinedThisConnection = true;
      for (const command of this.pending.splice(0)) {
        this.ws.send(JSON.stringify(command));
      }
    });
    this.ws.addEventListener("message", (event) => {
      const parsed = parseServerEvent(event.data as unknown);
      if (parsed) options.onEvent(parsed);
    });
    this.ws.addEventListener("close", () => {
      this.joinedThisConnection = false;
      options.onStatus("offline");
    });

    this.heartbeat = setInterval(() => {
      if (this.ws.readyState === this.ws.OPEN) this.ws.send("ping");
    }, HEARTBEAT_INTERVAL_MS);

    // Dev-only e2e hook: lets tests force a disconnect deterministically
    // (browser offline emulation does not close established WebSockets).
    if (import.meta.env.DEV) {
      (
        window as unknown as { __retropolisWs?: ReconnectingWebSocket }
      ).__retropolisWs = this.ws;
    }
  }

  send(command: ClientCommand): void {
    if (this.joinedThisConnection && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(command));
    } else {
      this.pending.push(command);
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.ws.close();
  }
}
