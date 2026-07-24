import { DurableObject } from "cloudflare:workers";
import {
  canTransition,
  DEFAULT_PHASE_PLAN,
  DEFAULT_VOTE_CONFIG,
  EMPTY_PICKER,
  IDLE_TIMER,
  noteVisibleTo,
  parseClientCommand,
  phasePlanSchema,
  phaseRevealed,
  pickerKnows,
  pickerStateSchema,
  planJoin,
  redactNoteForViewer,
  visibleNotesFor,
  type Action,
  type BoardConfig,
  type BoardInfo,
  type ClientCommand,
  type Column,
  type Note,
  type Participant,
  type ParticipantRole,
  type Phase,
  type PhasePlan,
  type PickerState,
  type RejectCode,
  type ServerEvent,
  type Timer,
  type WheelSpin,
  WHEEL_HOLD_MS,
  WHEEL_SPIN_MS,
  WHEEL_START_DELAY_MS,
  wheelSpinSchema,
  type BoardExport,
  type IcebreakerId,
  type Kudo,
  type KudoCardType,
  ICEBREAKER_IDS,
  pickIcebreaker,
} from "@retropolis/shared";
import { generateSecret, randomIndex, safeEqual } from "./ids.js";

// Boards auto-delete after this window unless the facilitator keeps them.
export const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// ROTI stays anonymous only if the average summarises enough people: with one
// respondent the average IS that person's score, and with two a co-voter can
// subtract their own to recover the other's. At three the average leaves at
// least two unknowns for any single observer, so we withhold it below that.
// (A determined observer diffing consecutive aggregates as the count ticks up
// could still infer a marginal voter's score; real-room concurrency and the
// one-decimal rounding blur that, and it's an acceptable residual for a team
// retro — the blatant one- and two-voter leaks are what this closes.)
export const ROTI_MIN_ANONYMOUS = 3;

interface KudoRow {
  id: string;
  card_type: string;
  to_id: string;
  from_id: string | null;
  text: string;
  gif_url: string | null;
}

interface SocketAttachment {
  participantId: string | null;
}

interface ParticipantRow {
  id: string;
  name: string;
  color: string;
  role: string;
  session_key: string;
  online: number;
  ready: number;
  demoted: number;
}

interface NoteRow {
  id: string;
  column_id: string;
  author_id: string;
  text: string;
  ord: number;
  group_id: string | null;
  gif_url: string | null;
}

export interface BoardCreation {
  boardId: string;
  name: string;
  adminToken: string;
  columns: Array<{
    id: string;
    name: string;
    order: number;
    hidden?: boolean;
  }>;
  workingAgreements: string;
  /** opt back into an otherwise-default flow (e.g. enable the check-in phase,
   *  which is off by default). Ignored when a full `config` is supplied. */
  phasePlan?: PhasePlan;
  /** seeded when duplicating an existing board — structure only. Absent for a
   *  fresh board, which falls back to the built-in defaults. */
  config?: BoardConfig;
}

const MAX_FRAME_CHARS = 8192;

// Phases in which notes may be created/edited by their author.
function phaseAllowsWriting(phase: Phase): boolean {
  return phase === "write" || phase === "present";
}

// One board = one BoardRoom. Uses the WebSocket Hibernation API throughout:
// no in-memory session state survives between events on purpose — everything
// a handler needs lives in SQLite or in the socket attachment.
export class BoardRoom extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS board_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        role TEXT NOT NULL,
        session_key TEXT NOT NULL UNIQUE,
        online INTEGER NOT NULL DEFAULT 0,
        ready INTEGER NOT NULL DEFAULT 0,
        demoted INTEGER NOT NULL DEFAULT 0,
        joined_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ord INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        column_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        text TEXT NOT NULL,
        ord INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reactions (
        note_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        PRIMARY KEY (note_id, participant_id, emoji)
      );
      CREATE TABLE IF NOT EXISTS votes (
        target_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (target_id, participant_id)
      );
      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        owner_id TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kudos (
        id TEXT PRIMARY KEY,
        card_type TEXT NOT NULL,
        to_id TEXT NOT NULL,
        from_id TEXT,
        text TEXT NOT NULL,
        gif_url TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS roti (
        participant_id TEXT PRIMARY KEY,
        score INTEGER NOT NULL
      );
    `);
    this.migrate();
    // Heartbeats are answered by the runtime without waking a hibernated DO.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  // Additive schema evolution for boards created before a column existed.
  private migrate(): void {
    const participantColumns = this.sql
      .exec("PRAGMA table_info(participants)")
      .toArray()
      .map((row) => String(row.name));
    if (!participantColumns.includes("ready")) {
      this.sql.exec(
        "ALTER TABLE participants ADD COLUMN ready INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!participantColumns.includes("demoted")) {
      this.sql.exec(
        "ALTER TABLE participants ADD COLUMN demoted INTEGER NOT NULL DEFAULT 0",
      );
    }
    const noteColumns = this.sql
      .exec("PRAGMA table_info(notes)")
      .toArray()
      .map((row) => String(row.name));
    if (!noteColumns.includes("group_id")) {
      this.sql.exec("ALTER TABLE notes ADD COLUMN group_id TEXT");
    }
    if (!noteColumns.includes("gif_url")) {
      this.sql.exec("ALTER TABLE notes ADD COLUMN gif_url TEXT");
    }
    const columnColumns = this.sql
      .exec("PRAGMA table_info(columns)")
      .toArray()
      .map((row) => String(row.name));
    if (!columnColumns.includes("hidden")) {
      this.sql.exec(
        "ALTER TABLE columns ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  // Called once by the Worker when a board is created (RPC).
  async initialize(creation: BoardCreation): Promise<void> {
    if (this.getMeta("id") !== null) return; // idempotent: replays must not rotate the admin token
    const now = Date.now();
    const retentionAt = now + RETENTION_MS; // always a FRESH window — a copy is a new object
    // Structure carried over on duplication; otherwise the built-in defaults.
    // Identity/lifecycle fields (id, adminToken, createdAt, seq, phase,
    // retentionAt) are never seeded from a source — always fresh here.
    const config = creation.config;
    const maxPerTarget = config?.maxPerTarget;
    this.sql.exec(
      `INSERT INTO board_meta (key, value) VALUES
         ('id', ?), ('name', ?), ('adminToken', ?), ('createdAt', ?), ('seq', '0'),
         ('phase', 'lobby'), ('anonymous', ?), ('phasePlan', ?),
         ('gifsEnabled', ?), ('pickerStyle', ?),
         ('votesPerPerson', ?), ('topN', ?), ('maxPerTarget', ?),
         ('retentionAt', ?), ('workingAgreements', ?)`,
      creation.boardId,
      creation.name,
      creation.adminToken,
      String(now),
      config?.anonymous ? "1" : "0",
      JSON.stringify(config?.phasePlan ?? creation.phasePlan ?? DEFAULT_PHASE_PLAN),
      config === undefined || config.gifsEnabled ? "1" : "0",
      config?.pickerStyle ?? "wheel",
      String(config?.votesPerPerson ?? DEFAULT_VOTE_CONFIG.votesPerPerson),
      String(config?.topN ?? DEFAULT_VOTE_CONFIG.topN),
      maxPerTarget == null ? "" : String(maxPerTarget),
      String(retentionAt),
      creation.workingAgreements,
    );
    for (const column of creation.columns) {
      this.sql.exec(
        "INSERT INTO columns (id, name, ord, hidden) VALUES (?, ?, ?, ?)",
        column.id,
        column.name,
        column.order,
        column.hidden ? 1 : 0,
      );
    }
    // Auto-delete after the retention window (GDPR / decided). The DO's single
    // alarm slot is shared with the phase timer — nearest deadline wins.
    await this.rescheduleAlarm();
  }

  // RPC: board metadata for the join page; null if never created.
  async info(): Promise<BoardInfo | null> {
    return this.getMeta("id") === null ? null : this.boardInfo();
  }

  // RPC: structure-only snapshot for duplication — column names+order, board
  // config, and the working-agreements text. Deliberately returns NO
  // participant, note, vote, kudo, roti, action, or picker data: "structure,
  // never content" is a property of THIS API surface, not caller discipline, so
  // no note body or participant can ever leak into a copy — even across regions,
  // since only these fields (never content-table rows) cross the RPC boundary.
  // Gated on the source admin token; returns null if the board does not exist
  // OR the token is wrong (no existence/auth oracle beyond the id capability).
  async duplicationSnapshot(adminToken: string): Promise<{
    name: string;
    columns: Array<{ name: string; order: number; hidden: boolean }>;
    config: BoardConfig;
    workingAgreements: string;
  } | null> {
    const expected = this.getMeta("adminToken");
    if (
      this.getMeta("id") === null ||
      expected === null ||
      !safeEqual(adminToken, expected)
    ) {
      return null;
    }
    return {
      name: this.getMeta("name") ?? "",
      // Carry the staged (hidden) flag through so a staged column stays staged
      // in the copy — otherwise its (possibly sensitive) name would be exposed
      // to the copy's members.
      columns: this.columns().map((c) => ({
        name: c.name,
        order: c.order,
        hidden: c.hidden,
      })),
      config: this.config(),
      workingAgreements: this.getMeta("workingAgreements") ?? "",
    };
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: "EXPECTED_WEBSOCKET" }, { status: 426 });
    }
    if (this.getMeta("id") === null) {
      return Response.json({ error: "BOARD_NOT_FOUND" }, { status: 404 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      participantId: null,
    } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    // The protocol is small JSON text frames; refuse anything else before
    // paying for JSON.parse (workerd itself allows frames up to 32 MiB).
    if (typeof message !== "string" || message.length > MAX_FRAME_CHARS) {
      this.send(ws, {
        type: "error",
        code: "BAD_MESSAGE",
        message: "Frame too large or not text",
      });
      return;
    }
    const command = parseClientCommand(message);
    if (command === null) {
      this.send(ws, {
        type: "error",
        code: "BAD_MESSAGE",
        message: "Unrecognized message",
      });
      return;
    }

    if (command.type === "join") {
      this.handleJoin(ws, command.name, command.sessionKey, command.adminToken);
      return;
    }
    if (command.type === "leave") {
      ws.close(1000, "left");
      return;
    }

    // Everything else requires a joined participant.
    const participant = this.participantForSocket(ws);
    if (participant === null) {
      this.send(ws, {
        type: "error",
        code: "NOT_JOINED",
        message: "Join first",
      });
      return;
    }
    this.dispatchCommand(ws, participant, command);
  }

  private dispatchCommand(
    ws: WebSocket,
    participant: ParticipantRow,
    command: Exclude<ClientCommand, { type: "join" } | { type: "leave" }>,
  ): void {
    switch (command.type) {
      case "resync":
        this.send(ws, this.buildSync(participant, participant.session_key));
        return;
      case "presence.editing":
        this.handleEditing(ws, participant, command.columnId);
        return;
      case "ready.set":
        this.handleReadySet(participant, command.ready);
        return;
      case "note.create":
        this.handleNoteCreate(ws, participant, command);
        return;
      case "note.update":
        this.handleNoteUpdate(ws, participant, command);
        return;
      case "note.delete":
        this.handleNoteDelete(ws, participant, command);
        return;
      case "note.react":
        this.handleNoteReact(ws, participant, command);
        return;
      case "admin.phase.set":
        this.handlePhaseSet(ws, participant, command.phase);
        return;
      case "admin.timer.start":
      case "admin.timer.pause":
      case "admin.timer.resume":
      case "admin.timer.extend":
      case "admin.timer.stop":
        this.handleTimer(ws, participant, command);
        return;
      case "admin.column.create":
      case "admin.column.rename":
      case "admin.column.delete":
      case "admin.column.setHidden":
        this.handleColumn(ws, participant, command);
        return;
      case "note.group":
        this.handleNoteGroup(ws, participant, command);
        return;
      case "note.ungroup":
        this.handleNoteUngroup(ws, participant, command);
        return;
      case "note.move":
        this.handleNoteMove(ws, participant, command);
        return;
      case "admin.picker.spin":
        this.handlePickerSpin(ws, participant);
        return;
      case "admin.picker.skip":
        this.handlePickerSkip(ws, participant);
        return;
      case "admin.picker.pick":
        this.handlePickerPick(ws, participant, command);
        return;
      case "picker.done":
        this.handlePickerDone(ws, participant);
        return;
      case "admin.picker.exclude":
      case "admin.picker.include":
        this.handlePickerPool(ws, participant, command);
        return;
      case "admin.picker.style":
        this.handlePickerStyleSet(ws, participant, command);
        return;
      case "admin.role.set":
        this.handleRoleSet(ws, participant, command);
        return;
      case "vote.cast":
        this.handleVoteCast(ws, participant, command);
        return;
      case "admin.vote.config":
        this.handleVoteConfig(ws, participant, command);
        return;
      case "admin.discuss.focus":
        this.handleDiscussFocus(ws, participant, command);
        return;
      case "action.create":
      case "action.update":
      case "action.delete":
        this.handleAction(ws, participant, command);
        return;
      case "kudo.create":
        this.handleKudoCreate(ws, participant, command);
        return;
      case "kudo.delete":
        this.handleKudoDelete(ws, participant, command);
        return;
      case "admin.gifs.set":
        this.handleGifsSet(ws, participant, command);
        return;
      case "admin.board.keep":
        void this.handleBoardKeep(ws, participant);
        return;
      case "admin.board.delete":
        void this.handleBoardDelete(ws, participant);
        return;
      case "admin.checkin.shuffle":
        this.handleCheckinShuffle(ws, participant);
        return;
      case "admin.agreements.set":
        this.handleAgreementsSet(ws, participant, command);
        return;
      case "roti.set":
        this.handleRotiSet(ws, participant, command);
        return;
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.handleDisconnect(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.handleDisconnect(ws);
  }

  // The DO has exactly ONE alarm slot, shared by the phase timer and the
  // retention auto-delete — whichever deadline is nearest is armed. On fire we
  // handle every deadline that is now due, then re-arm for whatever remains.
  override async alarm(): Promise<void> {
    const now = Date.now();

    const retentionAt = this.getMeta("retentionAt");
    if (retentionAt !== null && now >= Number(retentionAt) - 250) {
      await this.destroyBoard(); // terminal — the object is GC'd
      return;
    }

    const timerEndsAt = this.getMeta("timerEndsAt");
    if (timerEndsAt !== null && now >= Number(timerEndsAt) - 250) {
      // Broadcast BEFORE clearing: if anything throws, the at-least-once retry
      // still finds the deadline and re-broadcasts (clients dedupe).
      this.broadcastAll({ type: "timer.ended", seq: this.nextSeq() });
      this.clearTimerMeta();
    }

    await this.rescheduleAlarm();
  }

  // Arms the alarm for the nearest pending deadline (timer or retention).
  private async rescheduleAlarm(): Promise<void> {
    const deadlines = [this.getMeta("timerEndsAt"), this.getMeta("retentionAt")]
      .filter((v): v is string => v !== null)
      .map(Number);
    if (deadlines.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  // Wipes all board data (leaving the empty schema so the live instance stays
  // queryable and reports the board as gone) after telling connected clients.
  // getMeta("id") now returns null everywhere → the board 404s like one that
  // never existed. deleteAll() is avoided because it drops the tables, which
  // makes a same-instance query fail with "no such table".
  private async destroyBoard(): Promise<void> {
    this.broadcastAll({ type: "board.deleted" });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, "board deleted");
      } catch {
        // already closing
      }
    }
    await this.ctx.storage.deleteAlarm();
    for (const table of [
      "board_meta",
      "participants",
      "columns",
      "notes",
      "reactions",
      "votes",
      "actions",
      "kudos",
      "roti",
    ]) {
      this.sql.exec(`DELETE FROM ${table}`);
    }
  }

  // ---------------------------------------------------------------------
  // join / leave / presence
  // ---------------------------------------------------------------------

  private handleJoin(
    ws: WebSocket,
    name: string,
    sessionKey: string | undefined,
    adminToken: string | undefined,
  ): void {
    const now = Date.now();
    const storedAdminToken = this.getMeta("adminToken");
    const tokenMatches =
      adminToken !== undefined &&
      storedAdminToken !== null &&
      safeEqual(adminToken, storedAdminToken);

    const existingRow =
      sessionKey === undefined
        ? null
        : ((this.sql
            .exec(
              "SELECT * FROM participants WHERE session_key = ?",
              sessionKey,
            )
            .toArray()[0] as unknown as ParticipantRow | undefined) ?? null);

    const takenColors = this.sql
      .exec("SELECT color FROM participants")
      .toArray()
      .map((row) => String(row.color));

    // An explicit admin.role.set demotion sticks across reconnects — the
    // stored admin token must not silently re-promote its holder.
    const isAdmin = tokenMatches && existingRow?.demoted !== 1;

    const plan = planJoin({
      requestedName: name,
      isAdmin,
      existing: existingRow ? rowToParticipant(existingRow) : null,
      takenColors,
      newId: generateSecret(),
    });
    const participant = plan.participant;
    // Adopt the client-minted key (shape-checked by the protocol schema) so a
    // retried first join reclaims the same identity; mint only for keyless
    // clients (e.g. storage-less browsers).
    const participantSessionKey =
      existingRow?.session_key ?? sessionKey ?? generateSecret();

    if (plan.isNew) {
      this.sql.exec(
        `INSERT INTO participants (id, name, color, role, session_key, online, ready, demoted, joined_at, last_seen)
         VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?, ?)`,
        participant.id,
        participant.name,
        participant.color,
        participant.role,
        participantSessionKey,
        now,
        now,
      );
    } else {
      this.sql.exec(
        `UPDATE participants SET name = ?, role = ?, online = 1, last_seen = ? WHERE id = ?`,
        participant.name,
        participant.role,
        now,
        participant.id,
      );
    }

    // Latecomers during the presenting phase enter the wheel pool.
    if (this.phase() === "present") {
      const picker = this.picker();
      if (picker !== null && !pickerKnows(picker, participant.id)) {
        const updated = {
          ...picker,
          remaining: [...picker.remaining, participant.id],
        };
        this.savePicker(updated);
        this.broadcastAll(
          { type: "picker.changed", seq: this.nextSeq(), picker: updated },
          ws,
        );
      }
    }

    ws.serializeAttachment({
      participantId: participant.id,
    } satisfies SocketAttachment);
    this.send(
      ws,
      this.buildSync(
        this.participantById(participant.id) as ParticipantRow,
        participantSessionKey,
      ),
    );
    this.broadcastAll(
      { type: "presence.join", seq: this.nextSeq(), participant },
      ws,
    );
    this.broadcastMeter();
  }

  private handleDisconnect(closingSocket: WebSocket): void {
    const attachment = readAttachment(closingSocket);
    const participantId = attachment?.participantId ?? null;
    if (participantId === null) return;

    // The closing tab may have been mid-edit; its ghost card would otherwise
    // stick forever when a sibling tab keeps the participant "connected"
    // (a surviving tab re-asserts on the next focus).
    this.broadcastAll(
      { type: "presence.editing", participantId, columnId: null },
      closingSocket,
    );

    const stillConnected = this.ctx
      .getWebSockets()
      .some(
        (ws) =>
          ws !== closingSocket &&
          readAttachment(ws)?.participantId === participantId,
      );
    if (stillConnected) return; // another tab of the same person is still here

    this.sql.exec(
      "UPDATE participants SET online = 0, last_seen = ? WHERE id = ?",
      Date.now(),
      participantId,
    );
    this.broadcastAll(
      { type: "presence.leave", seq: this.nextSeq(), participantId },
      closingSocket,
    );

    this.broadcastMeter();

    // The wheel must not land on someone who left: drop them from the pool.
    // Their rejoin re-adds them via the latecomer path (pickerKnows false).
    const picker = this.picker();
    if (picker !== null && picker.remaining.includes(participantId)) {
      const updated: PickerState = {
        ...picker,
        remaining: picker.remaining.filter((id) => id !== participantId),
      };
      this.savePicker(updated);
      this.broadcastAll(
        { type: "picker.changed", seq: this.nextSeq(), picker: updated },
        closingSocket,
      );
    }
  }

  private handleEditing(
    ws: WebSocket,
    participant: ParticipantRow,
    columnId: string | null,
  ): void {
    if (columnId !== null) {
      const column = this.columnById(columnId);
      if (column === null) return; // stale ghost, ignore
      if (column.hidden) {
        // A hidden column's id must not reach members. Only facilitators (who
        // can see the column) exchange editing presence inside it; a member
        // referencing it at all is ignored.
        if (participant.role !== "facilitator") return;
        this.broadcastToFacilitators({
          type: "presence.editing",
          participantId: participant.id,
          columnId,
        });
        return;
      }
    }
    // Ephemeral, never persisted. NOTE: when the anonymity toggle becomes
    // reachable (per-board setting UI), ghosts on anonymous boards must stop
    // carrying the participant id.
    this.broadcastAll(
      { type: "presence.editing", participantId: participant.id, columnId },
      ws,
    );
  }

  private handleReadySet(participant: ParticipantRow, ready: boolean): void {
    if (this.phase() === "done") return;
    this.sql.exec(
      "UPDATE participants SET ready = ? WHERE id = ?",
      ready ? 1 : 0,
      participant.id,
    );
    this.broadcastAll({
      type: "ready.changed",
      seq: this.nextSeq(),
      participantId: participant.id,
      ready,
    });
  }

  // ---------------------------------------------------------------------
  // notes
  // ---------------------------------------------------------------------

  private handleNoteCreate(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "note.create" }>,
  ): void {
    if (!phaseAllowsWriting(this.phase())) {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "Notes cannot be added in this phase",
      );
      return;
    }
    // A hidden column is invisible to members — reject exactly like a missing
    // one (no existence oracle). Facilitators may write into hidden columns.
    if (this.columnFor(cmd.columnId, participant) === null) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Column does not exist");
      return;
    }
    const existing = this.noteRowById(cmd.noteId);
    if (existing !== null) {
      if (existing.author_id === participant.id) {
        // idempotent retry of the same client-minted id
        this.ack(ws, cmd.opId);
        return;
      }
      // Colliding with a note the caller cannot see must not read differently
      // from any other invalid id — reject codes are an existence oracle.
      const visible = noteVisibleTo(
        { authorId: existing.author_id, columnId: existing.column_id },
        participant.id,
        this.phase(),
        this.hiddenColumnsFor(participant),
      );
      this.reject(
        ws,
        cmd.opId,
        visible ? "CONFLICT" : "INVALID",
        visible ? "Note id already exists" : "Note id is not usable",
      );
      return;
    }
    // Ordering is per author before reveal — a global MAX would leak the
    // count of other participants' hidden notes through the order field.
    const ord = Number(
      this.sql
        .exec(
          "SELECT COALESCE(MAX(ord), 0) + 1 AS next FROM notes WHERE column_id = ? AND author_id = ?",
          cmd.columnId,
          participant.id,
        )
        .toArray()[0]?.next ?? 1,
    );
    this.sql.exec(
      "INSERT INTO notes (id, column_id, author_id, text, ord, created_at, gif_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
      cmd.noteId,
      cmd.columnId,
      participant.id,
      cmd.text,
      ord,
      Date.now(),
      this.sanitizeGifUrl(cmd.gifUrl) ?? null,
    );
    const note = this.noteById(cmd.noteId);
    if (note === null) return;
    const seq = this.nextSeq();
    this.ack(ws, cmd.opId, seq);
    this.broadcastNoteEvent(
      (n) => ({ type: "note.created", seq, note: n }),
      note,
    );
    // Members can't see the note itself pre-reveal, but they learn the count.
    this.broadcastColumnCountsIfWriting();
  }

  private handleNoteUpdate(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "note.update" }>,
  ): void {
    const row = this.noteRowById(cmd.noteId);
    // A note the caller cannot see must answer exactly like a note that does
    // not exist — otherwise reject codes are an existence oracle for hidden
    // notes (authors always see their own, so they are unaffected).
    if (
      row === null ||
      !noteVisibleTo(
        { authorId: row.author_id, columnId: row.column_id },
        participant.id,
        this.phase(),
        this.hiddenColumnsFor(participant),
      )
    ) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Note does not exist");
      return;
    }
    if (row.author_id !== participant.id) {
      this.reject(
        ws,
        cmd.opId,
        "NOT_AUTHOR",
        "Only the author can edit a note",
      );
      return;
    }
    if (!phaseAllowsWriting(this.phase())) {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "Notes cannot be edited in this phase",
      );
      return;
    }
    // gifUrl omitted = leave as-is; explicit null = clear it; a string is
    // validated (disallowed hosts / disabled gifs drop to null).
    const gifUrl = this.sanitizeGifUrl(cmd.gifUrl);
    if (gifUrl === undefined) {
      this.sql.exec(
        "UPDATE notes SET text = ? WHERE id = ?",
        cmd.text,
        cmd.noteId,
      );
    } else {
      this.sql.exec(
        "UPDATE notes SET text = ?, gif_url = ? WHERE id = ?",
        cmd.text,
        gifUrl,
        cmd.noteId,
      );
    }
    const note = this.noteById(cmd.noteId);
    if (note === null) return;
    const seq = this.nextSeq();
    this.ack(ws, cmd.opId, seq);
    this.broadcastNoteEvent(
      (n) => ({ type: "note.updated", seq, note: n }),
      note,
    );
  }

  private handleNoteDelete(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "note.delete" }>,
  ): void {
    if (this.phase() === "done") {
      // The archived board is read-only — mirror the react/edit gates.
      this.reject(ws, cmd.opId, "PHASE_LOCKED", "The retro is finished");
      return;
    }
    const row = this.noteRowById(cmd.noteId);
    // Invisible notes behave exactly like nonexistent ones (idempotent ack,
    // NO deletion) — anything else is an existence oracle for hidden notes.
    if (
      row === null ||
      !noteVisibleTo(
        { authorId: row.author_id, columnId: row.column_id },
        participant.id,
        this.phase(),
        this.hiddenColumnsFor(participant),
      )
    ) {
      this.ack(ws, cmd.opId);
      return;
    }
    const isAdmin = participant.role === "facilitator";
    if (row.author_id !== participant.id && !isAdmin) {
      this.reject(
        ws,
        cmd.opId,
        "NOT_AUTHOR",
        "Only the author or the facilitator can delete",
      );
      return;
    }
    const note = this.noteById(cmd.noteId);
    this.sql.exec("DELETE FROM reactions WHERE note_id = ?", cmd.noteId);
    // Only ungrouped notes own their vote bucket. A stack ANCHOR's id doubles
    // as the group's vote target — purging it here would destroy the whole
    // stack's votes before repairGroupAfterLeave migrates them to the survivor.
    if (row.group_id === null) {
      this.sql.exec("DELETE FROM votes WHERE target_id = ?", cmd.noteId);
    }
    this.sql.exec("DELETE FROM notes WHERE id = ?", cmd.noteId);
    const repairedIds =
      row.group_id === null
        ? []
        : this.repairGroupAfterLeave(row.group_id, cmd.noteId);
    // A deleted votable (or a re-anchored stack) may have stranded own-votes,
    // shifted the meter, or dropped a crown/focus — re-sync the room.
    this.reconcileAfterVoteMutation();
    const seq = this.nextSeq();
    this.ack(ws, cmd.opId, seq);
    for (const id of repairedIds) {
      const updated = this.noteById(id);
      if (updated === null) continue;
      const updateSeq = this.nextSeq();
      this.broadcastNoteEvent(
        (n) => ({ type: "note.updated", seq: updateSeq, note: n }),
        updated,
      );
    }
    if (note !== null) {
      // Only recipients who could SEE the note learn about its deletion —
      // sending the id of a note hidden from them (foreign pre-reveal, or in a
      // staged column) would leak its existence.
      const phase = this.phase();
      const hidden = this.hiddenColumnIds();
      this.broadcastEach((recipientId) =>
        noteVisibleTo(
          note,
          recipientId,
          phase,
          this.hiddenSetFor(recipientId, hidden),
        )
          ? { type: "note.deleted", seq, noteId: cmd.noteId }
          : null,
      );
    }
    // Deleting during write lowers the anonymized count members see.
    this.broadcastColumnCountsIfWriting();
  }

  private handleNoteReact(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "note.react" }>,
  ): void {
    const phase = this.phase();
    if (!phaseRevealed(phase) || phase === "done") {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "Reactions are available after the reveal",
      );
      return;
    }
    const reactRow = this.noteRowById(cmd.noteId);
    // A note the caller cannot see — foreign before the reveal, or in a column
    // hidden from a member — answers exactly like a nonexistent one (no
    // existence oracle), and a member can never react onto a staged note.
    if (
      reactRow === null ||
      !noteVisibleTo(
        { authorId: reactRow.author_id, columnId: reactRow.column_id },
        participant.id,
        phase,
        this.hiddenColumnsFor(participant),
      )
    ) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Note does not exist");
      return;
    }
    if (cmd.on) {
      this.sql.exec(
        "INSERT OR IGNORE INTO reactions (note_id, participant_id, emoji) VALUES (?, ?, ?)",
        cmd.noteId,
        participant.id,
        cmd.emoji,
      );
    } else {
      this.sql.exec(
        "DELETE FROM reactions WHERE note_id = ? AND participant_id = ? AND emoji = ?",
        cmd.noteId,
        participant.id,
        cmd.emoji,
      );
    }
    const note = this.noteById(cmd.noteId);
    if (note === null) return;
    const seq = this.nextSeq();
    this.ack(ws, cmd.opId, seq);
    this.broadcastNoteEvent(
      (n) => ({ type: "note.updated", seq, note: n }),
      note,
    );
  }

  // ---------------------------------------------------------------------
  // admin: phases, timer, columns
  // ---------------------------------------------------------------------

  private handlePhaseSet(
    ws: WebSocket,
    participant: ParticipantRow,
    target: Phase,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator controls phases",
      );
      return;
    }
    const current = this.phase();
    if (!canTransition(current, target, this.phasePlan())) {
      this.reject(
        ws,
        undefined,
        "INVALID",
        `Cannot go from ${current} to ${target}`,
      );
      return;
    }

    this.setMeta("phase", target);
    this.sql.exec("UPDATE participants SET ready = 0");
    this.sql.exec(
      "DELETE FROM board_meta WHERE key IN ('discussFocus', 'meterState')",
    );
    this.clearTimerMeta();
    // Re-arm for retention (must NOT drop the retention alarm on phase change).
    void this.rescheduleAlarm();

    this.broadcastAll({
      type: "phase.changed",
      seq: this.nextSeq(),
      phase: target,
    });

    // Voting closes when the board moves from vote to discuss: everyone gets
    // the tallies and the crowned top-N in one reveal.
    if (current === "vote" && target === "discuss") {
      const { tallies, topTargetIds } = this.talliesAndTop();
      this.broadcastAll({
        type: "votes.revealed",
        seq: this.nextSeq(),
        tallies,
        topTargetIds,
      });
    }
    if (target === "vote") {
      // Votes may have migrated while regrouping in "present" — re-send every
      // voter their (possibly re-keyed) own votes so no dots are stranded.
      this.broadcastAllProgress();
      this.broadcastMeter(true);
    }

    // Every entry into "present": the pool covers everyone currently online
    // who is not already in the rotation (or deliberately excluded). The
    // picker itself persists across phase changes and rewinds.
    if (target === "present") {
      const online = this.sql
        .exec("SELECT id FROM participants WHERE online = 1")
        .toArray()
        .map((row) => String(row.id));
      const existing = this.picker();
      const base: PickerState = existing ?? {
        remaining: [],
        presented: [],
        current: null,
        excluded: [],
      };
      const missing = online.filter((id) => !pickerKnows(base, id));
      if (existing === null || missing.length > 0) {
        const picker: PickerState = {
          ...base,
          remaining: [...base.remaining, ...missing],
        };
        this.savePicker(picker);
        this.broadcastAll({
          type: "picker.changed",
          seq: this.nextSeq(),
          picker,
        });
      }
    }

    // Crossing into the revealed world: everyone receives the notes that were
    // hidden from them. (Rewinds need no event — clients drop foreign notes.)
    // A staged (hidden) column stays withheld from members even across the
    // reveal — its notes reach them only when the facilitator reveals it.
    if (!phaseRevealed(current) && phaseRevealed(target)) {
      const notes = this.allNotes();
      const anonymous = this.anonymous();
      const hidden = this.hiddenColumnIds();
      const seq = this.nextSeq();
      this.broadcastEach((recipientId) => {
        const hiddenFor = this.hiddenSetFor(recipientId, hidden);
        const newlyVisible = notes
          .filter(
            (n) =>
              n.authorId !== recipientId &&
              (hiddenFor === null || !hiddenFor.has(n.columnId)),
          )
          .map((n) => redactNoteForViewer(n, recipientId, anonymous));
        return newlyVisible.length > 0
          ? { type: "notes.revealed", seq, notes: newlyVisible }
          : null;
      });
    }

    // Entering close/done: re-push existing kudos so a rewind-then-re-enter
    // doesn't leave connected clients with an empty wall (their reducer
    // cleared kudos on the way out). Idempotent upserts on the client.
    if (target === "close" || target === "done") {
      for (const kudo of this.allKudos()) {
        this.broadcastAll({ type: "kudo.created", seq: this.nextSeq(), kudo });
      }
    }

    // First entry into check-in picks an icebreaker (persists across rewinds
    // so the room doesn't get a new question every time it re-enters).
    if (target === "checkin" && this.getMeta("icebreakerId") === null) {
      this.shuffleIcebreaker();
    }

    // Entering (or rewinding into) write: seed everyone with the current
    // per-column totals so the "cards from the team" placeholder is right away.
    if (target === "write") {
      this.broadcastColumnCountsIfWriting();
    }
  }

  private handleTimer(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<
      ClientCommand,
      {
        type: `admin.timer.${"start" | "pause" | "resume" | "extend" | "stop"}`;
      }
    >,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator controls the timer",
      );
      return;
    }
    const now = Date.now();
    const timer = this.timer();

    switch (cmd.type) {
      case "admin.timer.start": {
        this.setTimerMeta(now + cmd.durationSec * 1000, null);
        break;
      }
      case "admin.timer.pause": {
        if (timer.endsAt === null) {
          this.reject(ws, undefined, "INVALID", "No running timer");
          return;
        }
        this.setTimerMeta(null, Math.max(0, timer.endsAt - now));
        break;
      }
      case "admin.timer.resume": {
        if (timer.pausedRemainingMs === null) {
          this.reject(ws, undefined, "INVALID", "No paused timer");
          return;
        }
        this.setTimerMeta(now + timer.pausedRemainingMs, null);
        break;
      }
      case "admin.timer.extend": {
        if (timer.endsAt !== null) {
          this.setTimerMeta(timer.endsAt + cmd.addSec * 1000, null);
        } else if (timer.pausedRemainingMs !== null) {
          this.setTimerMeta(null, timer.pausedRemainingMs + cmd.addSec * 1000);
        } else {
          this.reject(ws, undefined, "INVALID", "No timer to extend");
          return;
        }
        break;
      }
      case "admin.timer.stop": {
        this.clearTimerMeta();
        break;
      }
    }
    // One alarm slot, shared with retention — re-arm for the nearest deadline.
    void this.rescheduleAlarm();

    this.broadcastAll({
      type: "timer.changed",
      seq: this.nextSeq(),
      timer: this.timer(),
      serverNow: now,
    });
  }

  private handleColumn(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<
      ClientCommand,
      {
        type: `admin.column.${"create" | "rename" | "delete" | "setHidden"}`;
      }
    >,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        cmd.opId,
        "NOT_ADMIN",
        "Only the facilitator manages columns",
      );
      return;
    }
    switch (cmd.type) {
      case "admin.column.create": {
        if (this.columnById(cmd.columnId) !== null) {
          this.ack(ws, cmd.opId); // idempotent retry
          return;
        }
        const ord = Number(
          this.sql
            .exec("SELECT COALESCE(MAX(ord), -1) + 1 AS next FROM columns")
            .toArray()[0]?.next ?? 0,
        );
        this.sql.exec(
          "INSERT INTO columns (id, name, ord) VALUES (?, ?, ?)",
          cmd.columnId,
          cmd.name,
          ord,
        );
        const column = this.columnById(cmd.columnId);
        if (column === null) return;
        const seq = this.nextSeq();
        this.ack(ws, cmd.opId, seq);
        // New columns are visible → everyone sees it (broadcastColumnEvent).
        this.broadcastColumnEvent({ type: "column.created", seq, column });
        return;
      }
      case "admin.column.rename": {
        if (this.columnById(cmd.columnId) === null) {
          this.reject(ws, cmd.opId, "NOT_FOUND", "Column does not exist");
          return;
        }
        this.sql.exec(
          "UPDATE columns SET name = ? WHERE id = ?",
          cmd.name,
          cmd.columnId,
        );
        const column = this.columnById(cmd.columnId);
        if (column === null) return;
        const seq = this.nextSeq();
        this.ack(ws, cmd.opId, seq);
        // A hidden column's new name must not reach members.
        this.broadcastColumnEvent({ type: "column.renamed", seq, column });
        return;
      }
      case "admin.column.delete": {
        const column = this.columnById(cmd.columnId);
        if (column === null) {
          this.ack(ws, cmd.opId); // idempotent
          return;
        }
        this.sql.exec(
          "DELETE FROM reactions WHERE note_id IN (SELECT id FROM notes WHERE column_id = ?)",
          cmd.columnId,
        );
        this.sql.exec(
          "DELETE FROM votes WHERE target_id IN (SELECT id FROM notes WHERE column_id = ?) OR target_id IN (SELECT DISTINCT group_id FROM notes WHERE column_id = ? AND group_id IS NOT NULL)",
          cmd.columnId,
          cmd.columnId,
        );
        this.sql.exec("DELETE FROM notes WHERE column_id = ?", cmd.columnId);
        this.sql.exec("DELETE FROM columns WHERE id = ?", cmd.columnId);
        this.reconcileAfterVoteMutation();
        const seq = this.nextSeq();
        this.ack(ws, cmd.opId, seq);
        const deleted: ServerEvent = {
          type: "column.deleted",
          seq,
          columnId: cmd.columnId,
        };
        // Members never had a hidden column — don't even leak its id.
        if (column.hidden) {
          this.broadcastToFacilitators(deleted);
        } else {
          this.broadcastAll(deleted);
        }
        return;
      }
      case "admin.column.setHidden": {
        this.handleColumnSetHidden(ws, cmd);
        return;
      }
    }
  }

  // Hide/reveal a staged column. The hidden flag itself, the column's
  // name/existence, and its notes must never reach a member — so delivery is
  // per-recipient: facilitators get column.updated (with the flag); members get
  // column.deleted on hide (their reducer drops the column AND its notes) or
  // column.created + their now-visible notes on reveal. The snapshot (buildSync)
  // enforces the same rule, so a reconnect can't leak either.
  private handleColumnSetHidden(
    ws: WebSocket,
    cmd: Extract<ClientCommand, { type: "admin.column.setHidden" }>,
  ): void {
    const column = this.columnById(cmd.columnId);
    if (column === null) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Column does not exist");
      return;
    }
    if (column.hidden === cmd.hidden) {
      this.ack(ws, cmd.opId); // idempotent no-op
      return;
    }
    this.sql.exec(
      "UPDATE columns SET hidden = ? WHERE id = ?",
      cmd.hidden ? 1 : 0,
      cmd.columnId,
    );
    const updated: Column = { ...column, hidden: cmd.hidden };
    const seq = this.nextSeq();
    this.ack(ws, cmd.opId, seq);
    const phase = this.phase();
    const anonymous = this.anonymous();
    this.broadcastEach((recipientId) => {
      if (this.participantById(recipientId)?.role === "facilitator") {
        return { type: "column.updated", seq, column: updated };
      }
      return cmd.hidden
        ? { type: "column.deleted", seq, columnId: cmd.columnId }
        : { type: "column.created", seq, column: updated };
    });
    // On reveal, follow the column with the notes now visible to each member
    // (facilitators already had them). Author/phase/anonymity rules still apply.
    if (!cmd.hidden) {
      const columnNotes = this.allNotes().filter(
        (n) => n.columnId === cmd.columnId,
      );
      const notesSeq = this.nextSeq();
      this.broadcastEach((recipientId) => {
        if (this.participantById(recipientId)?.role === "facilitator") {
          return null;
        }
        const visible = visibleNotesFor(
          columnNotes,
          recipientId,
          phase,
          anonymous,
        );
        return visible.length > 0
          ? { type: "notes.revealed", seq: notesSeq, notes: visible }
          : null;
      });
    }
    // Hiding removes the column's notes from the votable set (reveal restores
    // them); recompute any revealed tallies/crowns so they never reference a
    // hidden note.
    this.reconcileAfterVoteMutation();
  }

  // A column-bearing event goes to everyone when the column is visible, but only
  // to facilitators when it is hidden — members must not learn a hidden column's
  // name or existence.
  private broadcastColumnEvent(
    event: Extract<
      ServerEvent,
      { type: "column.created" | "column.renamed" | "column.updated" }
    >,
  ): void {
    if (!event.column.hidden) {
      this.broadcastAll(event);
      return;
    }
    this.broadcastToFacilitators(event);
  }

  private broadcastToFacilitators(event: ServerEvent): void {
    this.broadcastEach((recipientId) =>
      this.participantById(recipientId)?.role === "facilitator" ? event : null,
    );
  }

  // ---------------------------------------------------------------------
  // grouping & moving (revealed phases: the board is curated collectively)
  // ---------------------------------------------------------------------

  private handleNoteGroup(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "note.group" }>,
  ): void {
    const phase = this.phase();
    // Stacks are votables — their membership must be stable once voting
    // starts, so grouping is a presenting-phase activity (rewind to regroup).
    if (phase !== "present") {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "Grouping happens in the presenting phase",
      );
      return;
    }
    if (cmd.noteId === cmd.targetNoteId) {
      this.reject(ws, cmd.opId, "INVALID", "Cannot group a note with itself");
      return;
    }
    const note = this.noteRowById(cmd.noteId);
    const target = this.noteRowById(cmd.targetNoteId);
    // A note in a column hidden from this member is invisible — treat it (and
    // any attempt to group into it) like a nonexistent note (existence oracle).
    const hidden = this.hiddenColumnsFor(participant);
    if (
      note === null ||
      target === null ||
      (hidden !== null &&
        (hidden.has(note.column_id) || hidden.has(target.column_id)))
    ) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Note does not exist");
      return;
    }
    // Deterministic group id: the target's group, or the target note's own id
    // — the client's optimistic echo predicts the same value.
    const groupId = target.group_id ?? target.id;
    if (note.group_id === groupId) {
      this.ack(ws, cmd.opId); // idempotent
      return;
    }
    const leftGroup = note.group_id;
    const changed: string[] = [];
    if (target.group_id === null) {
      this.sql.exec(
        "UPDATE notes SET group_id = ? WHERE id = ?",
        groupId,
        target.id,
      );
      changed.push(target.id);
    }
    let ord = Number(note.ord);
    if (target.column_id !== note.column_id) {
      // Same per-(column, author) ordering rule as note.move — grouping into
      // another column must not import a foreign ord.
      ord = Number(
        this.sql
          .exec(
            "SELECT COALESCE(MAX(ord), 0) + 1 AS next FROM notes WHERE column_id = ? AND author_id = ?",
            target.column_id,
            note.author_id,
          )
          .toArray()[0]?.next ?? 1,
      );
    }
    this.sql.exec(
      "UPDATE notes SET group_id = ?, column_id = ?, ord = ? WHERE id = ?",
      groupId,
      target.column_id,
      ord,
      note.id,
    );
    // Votes cast on the note in an earlier round follow it into the stack.
    if (note.id !== groupId) this.migrateVotes(note.id, groupId);
    changed.push(note.id);
    if (leftGroup !== null) {
      changed.push(...this.repairGroupAfterLeave(leftGroup, note.id));
    }
    this.ack(ws, cmd.opId);
    for (const id of changed) {
      const updated = this.noteById(id);
      if (updated === null) continue;
      // Grouping onto a target in a staged column moves the note there —
      // reorg-aware delivery drops it from members who can no longer see it.
      this.broadcastNoteReorg(updated);
    }
  }

  private handleNoteUngroup(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "note.ungroup" }>,
  ): void {
    const phase = this.phase();
    // Stacks are votables — their membership must be stable once voting
    // starts, so grouping is a presenting-phase activity (rewind to regroup).
    if (phase !== "present") {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "Grouping happens in the presenting phase",
      );
      return;
    }
    const note = this.noteRowById(cmd.noteId);
    // A note in a column hidden from a member is invisible — answer like a
    // nonexistent one (existence oracle) so a member cannot probe or mutate a
    // staged stack, mirroring note.move / note.group.
    if (
      note === null ||
      !noteVisibleTo(
        { authorId: note.author_id, columnId: note.column_id },
        participant.id,
        phase,
        this.hiddenColumnsFor(participant),
      )
    ) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Note does not exist");
      return;
    }
    if (note.group_id === null) {
      this.ack(ws, cmd.opId); // idempotent
      return;
    }
    const groupId = note.group_id;
    this.sql.exec("UPDATE notes SET group_id = NULL WHERE id = ?", note.id);
    const changed = [note.id];
    changed.push(...this.repairGroupAfterLeave(groupId, note.id));
    this.ack(ws, cmd.opId);
    for (const id of changed) {
      const updated = this.noteById(id);
      if (updated === null) continue;
      const seq = this.nextSeq();
      this.broadcastNoteEvent(
        (n) => ({ type: "note.updated", seq, note: n }),
        updated,
      );
    }
  }

  private handleNoteMove(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "note.move" }>,
  ): void {
    const phase = this.phase();
    // Like grouping, moving reorganizes votables — frozen once voting starts.
    if (phase !== "write" && phase !== "present") {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "The board is locked for reorganizing",
      );
      return;
    }
    const note = this.noteRowById(cmd.noteId);
    // Invisible notes (foreign, or in a column hidden from a member) answer like
    // nonexistent ones (existence oracle).
    if (
      note === null ||
      !noteVisibleTo(
        { authorId: note.author_id, columnId: note.column_id },
        participant.id,
        phase,
        this.hiddenColumnsFor(participant),
      )
    ) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Note does not exist");
      return;
    }
    // Before the reveal you sort only your own notes; afterwards the board is
    // curated collectively.
    if (phase === "write" && note.author_id !== participant.id) {
      this.reject(
        ws,
        cmd.opId,
        "NOT_AUTHOR",
        "Only the author can move this note",
      );
      return;
    }
    // A member cannot move a note INTO a column hidden from them, and no one can
    // move into a nonexistent column.
    if (this.columnFor(cmd.columnId, participant) === null) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Column does not exist");
      return;
    }
    if (note.column_id === cmd.columnId && note.group_id === null) {
      this.ack(ws, cmd.opId); // no-op
      return;
    }
    const leftGroup = note.group_id;
    const ord = Number(
      this.sql
        .exec(
          "SELECT COALESCE(MAX(ord), 0) + 1 AS next FROM notes WHERE column_id = ? AND author_id = ?",
          cmd.columnId,
          note.author_id,
        )
        .toArray()[0]?.next ?? 1,
    );
    this.sql.exec(
      "UPDATE notes SET column_id = ?, ord = ?, group_id = NULL WHERE id = ?",
      cmd.columnId,
      ord,
      note.id,
    );
    const changed = [note.id];
    if (leftGroup !== null) {
      changed.push(...this.repairGroupAfterLeave(leftGroup, note.id));
    }
    this.ack(ws, cmd.opId);
    for (const id of changed) {
      const updated = this.noteById(id);
      if (updated === null) continue;
      // A move can land a note in a staged column — reorg-aware delivery drops
      // it from members who can no longer see it.
      this.broadcastNoteReorg(updated);
    }
    // Moving between columns during write shifts the per-column totals.
    this.broadcastColumnCountsIfWriting();
  }

  /** Keeps two invariants after a note leaves (or is deleted from) a group:
   *  a group of one is no group, and a group's id is always the id of a
   *  CURRENT member — otherwise a later drop onto the freed anchor note
   *  would silently merge with the old group. Returns the changed note ids. */
  private repairGroupAfterLeave(
    groupId: string,
    leavingNoteId: string,
  ): string[] {
    const members = this.sql
      .exec("SELECT id FROM notes WHERE group_id = ?", groupId)
      .toArray()
      .map((row) => String(row.id));
    if (members.length === 1) {
      const lastId = members[0] as string;
      this.sql.exec("UPDATE notes SET group_id = NULL WHERE id = ?", lastId);
      if (groupId !== lastId) this.migrateVotes(groupId, lastId);
      return [lastId];
    }
    if (members.length >= 2 && groupId === leavingNoteId) {
      const newGroupId = [...members].sort()[0] as string;
      this.sql.exec(
        "UPDATE notes SET group_id = ? WHERE group_id = ?",
        newGroupId,
        groupId,
      );
      this.migrateVotes(groupId, newGroupId);
      return members;
    }
    return [];
  }

  // ---------------------------------------------------------------------
  // picker (who presents next) & roles
  // ---------------------------------------------------------------------

  private handlePickerSpin(ws: WebSocket, participant: ParticipantRow): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator spins the wheel",
      );
      return;
    }
    if (this.phase() !== "present") {
      this.reject(
        ws,
        undefined,
        "PHASE_LOCKED",
        "The wheel spins in the presenting phase",
      );
      return;
    }
    // A double-click (or a second facilitator) must not steal the freshly
    // drawn winner's turn: no new spin while one is still animating.
    const activeSpin = this.lastSpin();
    if (
      activeSpin !== null &&
      Date.now() < activeSpin.startAt + activeSpin.durationMs
    ) {
      this.reject(ws, undefined, "INVALID", "The wheel is still spinning");
      return;
    }
    let picker = this.picker() ?? EMPTY_PICKER;
    if (picker.current !== null) {
      picker = {
        ...picker,
        presented: [...picker.presented, picker.current],
        current: null,
      };
    }
    if (picker.remaining.length === 0) {
      if (picker.presented.length === 0) {
        this.reject(ws, undefined, "INVALID", "Nobody to pick");
        return;
      }
      // Completing the final presenter — no spin, just the finished state.
      this.savePicker(picker);
      this.broadcastAll({
        type: "picker.changed",
        seq: this.nextSeq(),
        picker,
      });
      return;
    }
    // Draw only among people who are actually here; offline ids stay in
    // remaining as a safety net (disconnects normally remove them already).
    const online = new Set(
      this.sql
        .exec("SELECT id FROM participants WHERE online = 1")
        .toArray()
        .map((row) => String(row.id)),
    );
    const candidates = picker.remaining.filter((id) => online.has(id));
    const pool = candidates.length > 0 ? candidates : [...picker.remaining];
    const winnerId = pool[randomIndex(pool.length)] as string;
    picker = {
      ...picker,
      // filter the FULL remaining list — the draw pool may be the online
      // subset, and offline members must stay in the rotation
      remaining: picker.remaining.filter((id) => id !== winnerId),
      current: winnerId,
    };
    this.savePicker(picker);
    const seedBuf = new Uint32Array(1);
    crypto.getRandomValues(seedBuf);
    const spin: WheelSpin = {
      pool,
      winnerId,
      seed: seedBuf[0] as number,
      startAt: Date.now() + WHEEL_START_DELAY_MS,
      durationMs: WHEEL_SPIN_MS,
    };
    // Persisted for the in-flight guard above and so reconnect syncs can
    // resume the animation instead of killing the wheel mid-spin.
    this.setMeta("lastSpin", JSON.stringify(spin));
    this.broadcastAll({
      type: "picker.spun",
      seq: this.nextSeq(),
      picker,
      ...spin,
    });
  }

  private handlePickerSkip(ws: WebSocket, participant: ParticipantRow): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator manages the wheel",
      );
      return;
    }
    const picker = this.picker();
    if (picker === null || picker.current === null) {
      this.reject(ws, undefined, "INVALID", "Nobody is presenting");
      return;
    }
    const updated: PickerState = {
      ...picker,
      remaining: [...picker.remaining, picker.current],
      current: null,
    };
    this.savePicker(updated);
    this.broadcastAll({
      type: "picker.changed",
      seq: this.nextSeq(),
      picker: updated,
    });
  }

  // Facilitator hand-picks the next presenter directly (no wheel). Same
  // rotation bookkeeping as a spin: auto-complete whoever is up, then put the
  // chosen (remaining) person on stage.
  private handlePickerPick(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "admin.picker.pick" }>,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(ws, undefined, "NOT_ADMIN", "Only the facilitator picks");
      return;
    }
    if (this.phase() !== "present") {
      this.reject(
        ws,
        undefined,
        "PHASE_LOCKED",
        "Presenters are picked in the presenting phase",
      );
      return;
    }
    // Don't yank the stage out from under an animating wheel.
    const activeSpin = this.lastSpin();
    if (
      activeSpin !== null &&
      Date.now() < activeSpin.startAt + activeSpin.durationMs
    ) {
      this.reject(ws, undefined, "INVALID", "The wheel is still spinning");
      return;
    }
    let picker = this.picker() ?? EMPTY_PICKER;
    if (!picker.remaining.includes(cmd.participantId)) {
      this.reject(ws, undefined, "INVALID", "That person is not up next");
      return;
    }
    if (picker.current !== null) {
      picker = {
        ...picker,
        presented: [...picker.presented, picker.current],
        current: null,
      };
    }
    picker = {
      ...picker,
      remaining: picker.remaining.filter((id) => id !== cmd.participantId),
      current: cmd.participantId,
    };
    this.savePicker(picker);
    this.broadcastAll({
      type: "picker.changed",
      seq: this.nextSeq(),
      picker,
    });
  }

  // The person on stage marks their own turn done (member OR facilitator).
  // A stale click (the facilitator already advanced) fails the sender===current
  // check and rejects — the client resyncs off that.
  private handlePickerDone(
    ws: WebSocket,
    participant: ParticipantRow,
  ): void {
    if (this.phase() !== "present") {
      this.reject(
        ws,
        undefined,
        "PHASE_LOCKED",
        "The presenting round is not active",
      );
      return;
    }
    const picker = this.picker();
    if (picker === null || picker.current === null) {
      this.reject(ws, undefined, "INVALID", "Nobody is presenting");
      return;
    }
    if (picker.current !== participant.id) {
      this.reject(ws, undefined, "INVALID", "You are not the one presenting");
      return;
    }
    const updated: PickerState = {
      ...picker,
      presented: [...picker.presented, picker.current],
      current: null,
    };
    this.savePicker(updated);
    this.broadcastAll({
      type: "picker.changed",
      seq: this.nextSeq(),
      picker: updated,
    });
  }

  private handlePickerPool(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<
      ClientCommand,
      { type: "admin.picker.exclude" | "admin.picker.include" }
    >,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator manages the wheel",
      );
      return;
    }
    const picker = this.picker();
    if (picker === null) {
      this.reject(ws, undefined, "INVALID", "The wheel is not set up yet");
      return;
    }
    let updated: PickerState;
    if (cmd.type === "admin.picker.exclude") {
      if (!picker.remaining.includes(cmd.participantId)) return; // nothing to do
      updated = {
        ...picker,
        remaining: picker.remaining.filter((id) => id !== cmd.participantId),
        // remembered so reconnects/latecomer auto-adds cannot undo it
        excluded: [...picker.excluded, cmd.participantId],
      };
    } else {
      if (this.participantById(cmd.participantId) === null) return;
      if (picker.excluded.includes(cmd.participantId)) {
        updated = {
          ...picker,
          remaining: [...picker.remaining, cmd.participantId],
          excluded: picker.excluded.filter((id) => id !== cmd.participantId),
        };
      } else if (!pickerKnows(picker, cmd.participantId)) {
        updated = {
          ...picker,
          remaining: [...picker.remaining, cmd.participantId],
        };
      } else {
        return; // already in the rotation
      }
    }
    this.savePicker(updated);
    this.broadcastAll({
      type: "picker.changed",
      seq: this.nextSeq(),
      picker: updated,
    });
  }

  private handleRoleSet(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "admin.role.set" }>,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only a facilitator assigns roles",
      );
      return;
    }
    const target = this.participantById(cmd.participantId);
    if (target === null) {
      this.reject(ws, undefined, "NOT_FOUND", "Participant does not exist");
      return;
    }
    if (target.role === cmd.role) return; // no-op
    if (cmd.role === "member") {
      const facilitators = Number(
        this.sql
          .exec(
            "SELECT COUNT(*) AS n FROM participants WHERE role = 'facilitator'",
          )
          .toArray()[0]?.n ?? 0,
      );
      if (facilitators <= 1) {
        this.reject(
          ws,
          undefined,
          "INVALID",
          "The board needs at least one facilitator",
        );
        return;
      }
    }
    // The demoted flag makes the decision stick across reconnects even for
    // the admin-token holder (handleJoin checks it before upgrading).
    this.sql.exec(
      "UPDATE participants SET role = ?, demoted = ? WHERE id = ?",
      cmd.role,
      cmd.role === "member" ? 1 : 0,
      target.id,
    );
    const updated = this.participantById(target.id);
    if (updated === null) return;
    this.broadcastAll({
      type: "roster.updated",
      seq: this.nextSeq(),
      participant: rowToParticipant(updated),
    });
  }

  // ---------------------------------------------------------------------
  // voting, discussion & actions
  // ---------------------------------------------------------------------

  private handleVoteCast(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "vote.cast" }>,
  ): void {
    if (this.phase() !== "vote") {
      this.reject(ws, cmd.opId, "PHASE_LOCKED", "Voting is not open");
      return;
    }
    // Votables are ungrouped notes and stacks (group ids).
    const kind = this.votableKind(cmd.targetId);
    if (kind === "grouped-note") {
      this.reject(
        ws,
        cmd.opId,
        "INVALID",
        "Vote the stack, not a stacked note",
      );
      return;
    }
    if (kind === null) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Nothing to vote on");
      return;
    }
    // A member cannot vote on a note in a column hidden from them — it's
    // invisible, so answer like a nonexistent target (hidden notes are excluded
    // from tallies anyway; this stops a modified client spending budget there).
    if (participant.role !== "facilitator") {
      const columnId = this.noteRowById(cmd.targetId)?.column_id ?? null;
      if (columnId !== null && this.hiddenColumnIds().has(columnId)) {
        this.reject(ws, cmd.opId, "NOT_FOUND", "Nothing to vote on");
        return;
      }
    }
    const config = this.config();
    const current = Number(
      this.sql
        .exec(
          "SELECT count FROM votes WHERE target_id = ? AND participant_id = ?",
          cmd.targetId,
          participant.id,
        )
        .toArray()[0]?.count ?? 0,
    );
    const total = Number(
      this.sql
        .exec(
          "SELECT COALESCE(SUM(count), 0) AS total FROM votes WHERE participant_id = ?",
          participant.id,
        )
        .toArray()[0]?.total ?? 0,
    );
    const next = current + cmd.delta;
    if (next < 0) {
      this.reject(ws, cmd.opId, "INVALID", "No vote to remove");
      return;
    }
    if (cmd.delta > 0 && total + 1 > config.votesPerPerson) {
      this.reject(ws, cmd.opId, "VOTE_BUDGET", "All votes used");
      return;
    }
    if (
      cmd.delta > 0 &&
      config.maxPerTarget !== null &&
      next > config.maxPerTarget
    ) {
      this.reject(
        ws,
        cmd.opId,
        "VOTE_BUDGET",
        "Vote limit for this card reached",
      );
      return;
    }
    if (next === 0) {
      this.sql.exec(
        "DELETE FROM votes WHERE target_id = ? AND participant_id = ?",
        cmd.targetId,
        participant.id,
      );
    } else {
      this.sql.exec(
        `INSERT INTO votes (target_id, participant_id, count) VALUES (?, ?, ?)
         ON CONFLICT(target_id, participant_id) DO UPDATE SET count = excluded.count`,
        cmd.targetId,
        participant.id,
        next,
      );
    }
    this.ack(ws, cmd.opId);
    // Blind voting: the caster (all their tabs) learns only their own votes;
    // everyone else sees just the anonymous progress meter.
    this.sendProgressTo(participant.id);
    this.broadcastMeter();
  }

  private handleVoteConfig(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "admin.vote.config" }>,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator configures voting",
      );
      return;
    }
    if (this.phase() === "done") {
      this.reject(ws, undefined, "PHASE_LOCKED", "The retro is finished");
      return;
    }
    this.setMeta("votesPerPerson", String(cmd.votesPerPerson));
    this.setMeta(
      "maxPerTarget",
      cmd.maxPerTarget === null ? "" : String(cmd.maxPerTarget),
    );
    this.setMeta("topN", String(cmd.topN));
    this.broadcastAll({
      type: "config.changed",
      seq: this.nextSeq(),
      config: this.config(),
    });
    const phase = this.phase();
    if (phase === "vote") {
      // Lowering a limit mid-vote trims existing over-budget votes and tells
      // affected voters their new own-vote state.
      this.clampVotesToConfig();
      this.broadcastAllProgress();
      this.broadcastMeter(true);
    } else if (phase === "discuss" || phase === "close") {
      // Changing topN after the reveal re-crowns; keep connected clients in
      // step with what a reconnecting client would compute.
      const { tallies, topTargetIds } = this.talliesAndTop();
      this.broadcastAll({
        type: "votes.revealed",
        seq: this.nextSeq(),
        tallies,
        topTargetIds,
      });
    }
  }

  private handleDiscussFocus(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "admin.discuss.focus" }>,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator steers the discussion",
      );
      return;
    }
    if (this.phase() !== "discuss") {
      this.reject(
        ws,
        undefined,
        "PHASE_LOCKED",
        "Focus works in the discussion phase",
      );
      return;
    }
    // Only whole votables can be focused: an ungrouped note or a stack — a
    // buried stacked-note id (or unknown id) is not a discussion target.
    if (cmd.targetId !== null) {
      const kind = this.votableKind(cmd.targetId);
      if (kind !== "note" && kind !== "group") {
        this.reject(ws, undefined, "NOT_FOUND", "Nothing to focus");
        return;
      }
      // A hidden-column note must never become the shared discussion focus —
      // its id would broadcast to members (and ride in every sync), leaking a
      // staged note. Same exclusion talliesAndTop applies to crowns.
      const columnId = this.noteRowById(cmd.targetId)?.column_id ?? null;
      if (columnId !== null && this.hiddenColumnIds().has(columnId)) {
        this.reject(ws, undefined, "NOT_FOUND", "Nothing to focus");
        return;
      }
    }
    if (cmd.targetId === null)
      this.sql.exec("DELETE FROM board_meta WHERE key = 'discussFocus'");
    else this.setMeta("discussFocus", cmd.targetId);
    this.broadcastAll({
      type: "discuss.focus",
      seq: this.nextSeq(),
      targetId: cmd.targetId,
    });
  }

  private handleAction(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<
      ClientCommand,
      { type: "action.create" | "action.update" | "action.delete" }
    >,
  ): void {
    const phase = this.phase();
    // Action items crystallize while discussing; the whole team may capture
    // and edit them (small-team trust model).
    if (phase !== "discuss" && phase !== "close") {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "Actions are captured while discussing",
      );
      return;
    }
    if (cmd.type === "action.create") {
      if (this.actionById(cmd.actionId) !== null) {
        this.ack(ws, cmd.opId); // idempotent retry
        return;
      }
      if (cmd.ownerId !== null && this.participantById(cmd.ownerId) === null) {
        this.reject(ws, cmd.opId, "NOT_FOUND", "Owner does not exist");
        return;
      }
      this.sql.exec(
        "INSERT INTO actions (id, text, owner_id, status, created_at) VALUES (?, ?, ?, 'open', ?)",
        cmd.actionId,
        cmd.text,
        cmd.ownerId,
        Date.now(),
      );
      const action = this.actionById(cmd.actionId);
      if (action === null) return;
      const seq = this.nextSeq();
      this.ack(ws, cmd.opId, seq);
      this.broadcastAll({ type: "action.created", seq, action });
      return;
    }
    const existing = this.actionById(cmd.actionId);
    if (cmd.type === "action.delete") {
      if (existing === null) {
        this.ack(ws, cmd.opId); // idempotent
        return;
      }
      this.sql.exec("DELETE FROM actions WHERE id = ?", cmd.actionId);
      const seq = this.nextSeq();
      this.ack(ws, cmd.opId, seq);
      this.broadcastAll({
        type: "action.deleted",
        seq,
        actionId: cmd.actionId,
      });
      return;
    }
    if (existing === null) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Action does not exist");
      return;
    }
    if (
      cmd.ownerId !== undefined &&
      cmd.ownerId !== null &&
      this.participantById(cmd.ownerId) === null
    ) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Owner does not exist");
      return;
    }
    this.sql.exec(
      "UPDATE actions SET text = ?, owner_id = ?, status = ? WHERE id = ?",
      cmd.text ?? existing.text,
      cmd.ownerId === undefined ? existing.ownerId : cmd.ownerId,
      cmd.status ?? existing.status,
      cmd.actionId,
    );
    const action = this.actionById(cmd.actionId);
    if (action === null) return;
    const seq = this.nextSeq();
    this.ack(ws, cmd.opId, seq);
    this.broadcastAll({ type: "action.updated", seq, action });
  }

  /** "note" for ungrouped notes, "group" for stack ids, "grouped-note" for
   *  members of a stack, null for unknown ids. */
  private votableKind(
    targetId: string,
  ): "note" | "group" | "grouped-note" | null {
    // Group check FIRST: a stack's id equals its anchor member's note id, and
    // that id must resolve to the stack, not to the buried note.
    const members = this.sql
      .exec("SELECT COUNT(*) AS n FROM notes WHERE group_id = ?", targetId)
      .toArray()[0];
    if (Number(members?.n ?? 0) > 0) return "group";
    const note = this.noteRowById(targetId);
    if (note !== null) return note.group_id === null ? "note" : "grouped-note";
    return null;
  }

  private myVotes(participantId: string): Record<string, number> {
    const mine: Record<string, number> = {};
    for (const row of this.sql
      .exec(
        "SELECT target_id, count FROM votes WHERE participant_id = ?",
        participantId,
      )
      .toArray()) {
      mine[String(row.target_id)] = Number(row.count);
    }
    return mine;
  }

  private meter(): { votersDone: number; votersTotal: number } {
    const budget = this.config().votesPerPerson;
    const online = this.sql
      .exec("SELECT id FROM participants WHERE online = 1")
      .toArray()
      .map((row) => String(row.id));
    let votersDone = 0;
    for (const id of online) {
      const total = Number(
        this.sql
          .exec(
            "SELECT COALESCE(SUM(count), 0) AS total FROM votes WHERE participant_id = ?",
            id,
          )
          .toArray()[0]?.total ?? 0,
      );
      if (total >= budget) votersDone++;
    }
    return { votersDone, votersTotal: online.length };
  }

  /** Blind rule: tallies and crowns appear in snapshots only once the board
   *  moved PAST the vote phase. */
  private votesForSync(
    participantId: string,
    phase: Phase,
  ): {
    mine: Record<string, number>;
    votersDone: number;
    votersTotal: number;
    tallies: Record<string, number> | null;
    topTargetIds: string[];
  } {
    const revealedTallies =
      phase === "discuss" || phase === "close" || phase === "done"
        ? this.talliesAndTop()
        : null;
    return {
      mine: this.myVotes(participantId),
      ...this.meter(),
      tallies: revealedTallies?.tallies ?? null,
      topTargetIds: revealedTallies?.topTargetIds ?? [],
    };
  }

  // Changed-only: broadcasting the meter on EVERY cast would leak the exact
  // timing and count of everyone's dots (a side-channel far finer than the
  // "who finished their budget" signal the meter is meant to be).
  private broadcastMeter(force = false): void {
    if (this.phase() !== "vote") return;
    const meter = this.meter();
    const key = `${meter.votersDone}/${meter.votersTotal}`;
    if (!force && this.getMeta("meterState") === key) return;
    this.setMeta("meterState", key);
    this.broadcastAll({ type: "vote.meter", seq: this.nextSeq(), ...meter });
  }

  /** Fresh own-votes to EVERY socket of a participant — a second tab (or a
   *  projector view) must not show a stale budget after a cast. */
  private sendProgressTo(participantId: string): void {
    const frame = JSON.stringify({
      type: "vote.progress",
      yourVotes: this.myVotes(participantId),
    });
    for (const ws of this.ctx.getWebSockets()) {
      if (readAttachment(ws)?.participantId === participantId) {
        this.trySend(ws, frame);
      }
    }
  }

  /** The caster's own ROTI score to EVERY socket of that participant — a
   *  second tab (or projector view) must not show a stale selection. Mirrors
   *  sendProgressTo; the individual score never reaches any other participant. */
  private sendRotiYouTo(participantId: string, score: number): void {
    const frame = JSON.stringify({ type: "roti.you", yourScore: score });
    for (const ws of this.ctx.getWebSockets()) {
      if (readAttachment(ws)?.participantId === participantId) {
        this.trySend(ws, frame);
      }
    }
  }

  /** Every joined participant gets their own fresh votes — after a structural
   *  change (delete, vote migration) that may have rewritten vote rows. */
  private broadcastAllProgress(): void {
    const seen = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const id = readAttachment(ws)?.participantId ?? null;
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      this.sendProgressTo(id);
    }
  }

  // Structural changes (note/column delete, vote migration) can strand
  // clients with stale own-votes, a stale meter, dead crowns, or a dangling
  // discussion focus. This re-syncs whatever the current phase surfaces.
  private reconcileAfterVoteMutation(): void {
    const phase = this.phase();
    if (phase === "vote") {
      this.broadcastAllProgress();
      this.broadcastMeter();
      return;
    }
    if (phase === "discuss" || phase === "close") {
      const focus = this.getMeta("discussFocus");
      const focusKind = focus === null ? null : this.votableKind(focus);
      if (focus !== null && focusKind !== "note" && focusKind !== "group") {
        this.sql.exec("DELETE FROM board_meta WHERE key = 'discussFocus'");
        this.broadcastAll({
          type: "discuss.focus",
          seq: this.nextSeq(),
          targetId: null,
        });
      }
      const { tallies, topTargetIds } = this.talliesAndTop();
      this.broadcastAll({
        type: "votes.revealed",
        seq: this.nextSeq(),
        tallies,
        topTargetIds,
      });
    }
  }

  // Trims existing votes to the current config after the facilitator lowers a
  // limit mid-vote, so early voters don't keep more influence than the new
  // budget/cap allows. Per-target first, then per-person (highest rows go).
  private clampVotesToConfig(): void {
    const config = this.config();
    if (config.maxPerTarget !== null) {
      this.sql.exec(
        "UPDATE votes SET count = ? WHERE count > ?",
        config.maxPerTarget,
        config.maxPerTarget,
      );
    }
    const overs = this.sql
      .exec(
        "SELECT participant_id, SUM(count) AS total FROM votes GROUP BY participant_id HAVING total > ?",
        config.votesPerPerson,
      )
      .toArray();
    for (const row of overs) {
      const pid = String(row.participant_id);
      let excess = Number(row.total) - config.votesPerPerson;
      while (excess > 0) {
        const top = this.sql
          .exec(
            "SELECT target_id, count FROM votes WHERE participant_id = ? ORDER BY count DESC, target_id ASC LIMIT 1",
            pid,
          )
          .toArray()[0];
        if (top === undefined) break;
        const targetId = String(top.target_id);
        const remove = Math.min(excess, Number(top.count));
        const nextCount = Number(top.count) - remove;
        if (nextCount <= 0) {
          this.sql.exec(
            "DELETE FROM votes WHERE target_id = ? AND participant_id = ?",
            targetId,
            pid,
          );
        } else {
          this.sql.exec(
            "UPDATE votes SET count = ? WHERE target_id = ? AND participant_id = ?",
            nextCount,
            targetId,
            pid,
          );
        }
        excess -= remove;
      }
    }
  }

  /** Tallies over CURRENT votables only (dangling vote rows are ignored),
   *  top-N with a stable tiebreak (count desc, id asc). */
  private talliesAndTop(): {
    tallies: Record<string, number>;
    topTargetIds: string[];
  } {
    // Notes in hidden (staged) columns are excluded from the votable set:
    // revealed tallies/crowns are broadcast to EVERYONE, so a hidden note's id
    // or count must never surface there. Reveal restores them to the tally.
    const votable = new Set<string>();
    for (const row of this.sql
      .exec(
        "SELECT n.id, n.group_id FROM notes n JOIN columns c ON c.id = n.column_id WHERE c.hidden = 0",
      )
      .toArray()) {
      if (row.group_id === null) votable.add(String(row.id));
      else votable.add(String(row.group_id));
    }
    const tallies: Record<string, number> = {};
    for (const row of this.sql
      .exec(
        "SELECT target_id, SUM(count) AS total FROM votes GROUP BY target_id",
      )
      .toArray()) {
      const id = String(row.target_id);
      if (votable.has(id)) tallies[id] = Number(row.total);
    }
    const topTargetIds = Object.entries(tallies)
      .sort(([idA, a], [idB, b]) => b - a || idA.localeCompare(idB))
      .slice(0, this.config().topN)
      .map(([id]) => id);
    return { tallies, topTargetIds };
  }

  private migrateVotes(from: string, to: string): void {
    this.sql.exec(
      `INSERT INTO votes (target_id, participant_id, count)
         SELECT ?, participant_id, count FROM votes WHERE target_id = ?
       ON CONFLICT(target_id, participant_id) DO UPDATE SET count = count + excluded.count`,
      to,
      from,
    );
    this.sql.exec("DELETE FROM votes WHERE target_id = ?", from);
    // Merging two targets can push a voter's count on the survivor above the
    // per-target cap — clamp it back (refunding the overflow to their budget).
    const cap = this.config().maxPerTarget;
    if (cap !== null) {
      this.sql.exec(
        "UPDATE votes SET count = ? WHERE target_id = ? AND count > ?",
        cap,
        to,
        cap,
      );
    }
  }

  private actionById(id: string): Action | null {
    const row = this.sql
      .exec("SELECT * FROM actions WHERE id = ?", id)
      .toArray()[0];
    if (row === undefined) return null;
    return {
      id: String(row.id),
      text: String(row.text),
      ownerId: row.owner_id === null ? null : String(row.owner_id),
      status: row.status === "done" ? "done" : "open",
    };
  }

  private actions(): Action[] {
    return this.sql
      .exec("SELECT * FROM actions ORDER BY created_at")
      .toArray()
      .map((row) => ({
        id: String(row.id),
        text: String(row.text),
        ownerId: row.owner_id === null ? null : String(row.owner_id),
        status: row.status === "done" ? ("done" as const) : ("open" as const),
      }));
  }

  // ---------------------------------------------------------------------
  // appreciation wall, GIFs & retention
  // ---------------------------------------------------------------------

  private handleKudoCreate(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "kudo.create" }>,
  ): void {
    if (this.phase() !== "close") {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "Kudos are shared in the close phase",
      );
      return;
    }
    if (this.participantById(cmd.toId) === null) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Recipient does not exist");
      return;
    }
    if (this.kudoRowById(cmd.kudoId) !== null) {
      this.ack(ws, cmd.opId); // idempotent retry
      return;
    }
    // The sender is recorded server-side only if they chose to be shown —
    // anonymous kudos never carry the sender id on the wire.
    const fromId = cmd.anonymous ? null : participant.id;
    this.sql.exec(
      "INSERT INTO kudos (id, card_type, to_id, from_id, text, gif_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      cmd.kudoId,
      cmd.cardType,
      cmd.toId,
      fromId,
      cmd.text,
      this.sanitizeGifUrl(cmd.gifUrl) ?? null,
      Date.now(),
    );
    const kudo = this.kudoById(cmd.kudoId);
    if (kudo === null) return;
    const seq = this.nextSeq();
    this.ack(ws, cmd.opId, seq);
    this.broadcastAll({ type: "kudo.created", seq, kudo });
  }

  private handleKudoDelete(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "kudo.delete" }>,
  ): void {
    if (this.phase() !== "close") {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "The appreciation wall is closed",
      );
      return;
    }
    const row = this.kudoRowById(cmd.kudoId);
    if (row === null) {
      this.ack(ws, cmd.opId); // idempotent
      return;
    }
    // Sender (if known) or a facilitator may remove a kudo.
    const isAdmin = participant.role === "facilitator";
    if (row.from_id !== participant.id && !isAdmin) {
      this.reject(
        ws,
        cmd.opId,
        "NOT_AUTHOR",
        "Only the sender or facilitator can remove this",
      );
      return;
    }
    this.sql.exec("DELETE FROM kudos WHERE id = ?", cmd.kudoId);
    const seq = this.nextSeq();
    this.ack(ws, cmd.opId, seq);
    this.broadcastAll({ type: "kudo.deleted", seq, kudoId: cmd.kudoId });
  }

  private handleGifsSet(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "admin.gifs.set" }>,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator changes settings",
      );
      return;
    }
    this.setMeta("gifsEnabled", cmd.enabled ? "1" : "0");
    this.broadcastAll({
      type: "config.changed",
      seq: this.nextSeq(),
      config: this.config(),
    });
  }

  private handlePickerStyleSet(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "admin.picker.style" }>,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator changes settings",
      );
      return;
    }
    // Pure presentation — the draw is unchanged; only the skin clients render.
    this.setMeta("pickerStyle", cmd.style);
    this.broadcastAll({
      type: "config.changed",
      seq: this.nextSeq(),
      config: this.config(),
    });
  }

  private async handleBoardKeep(
    ws: WebSocket,
    participant: ParticipantRow,
  ): Promise<void> {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator manages retention",
      );
      return;
    }
    this.sql.exec("DELETE FROM board_meta WHERE key = 'retentionAt'");
    await this.rescheduleAlarm();
    this.broadcastAll({
      type: "retention.changed",
      seq: this.nextSeq(),
      retentionAt: null,
    });
  }

  private async handleBoardDelete(
    ws: WebSocket,
    participant: ParticipantRow,
  ): Promise<void> {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator can delete the board",
      );
      return;
    }
    await this.destroyBoard();
  }

  // Picks a fresh icebreaker (never repeating the current one) and broadcasts.
  private shuffleIcebreaker(): void {
    const current = this.getMeta("icebreakerId");
    const icebreakerId = pickIcebreaker(
      randomIndex(ICEBREAKER_IDS.length),
      current,
    );
    this.setMeta("icebreakerId", icebreakerId);
    this.broadcastAll({
      type: "checkin.shuffled",
      seq: this.nextSeq(),
      icebreakerId,
    });
  }

  private handleCheckinShuffle(
    ws: WebSocket,
    participant: ParticipantRow,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator shuffles the check-in",
      );
      return;
    }
    if (this.phase() !== "checkin") {
      this.reject(ws, undefined, "PHASE_LOCKED", "The check-in is not open");
      return;
    }
    this.shuffleIcebreaker();
  }

  private handleAgreementsSet(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "admin.agreements.set" }>,
  ): void {
    if (participant.role !== "facilitator") {
      this.reject(
        ws,
        undefined,
        "NOT_ADMIN",
        "Only the facilitator edits the agreements",
      );
      return;
    }
    this.setMeta("workingAgreements", cmd.text);
    this.broadcastAll({
      type: "agreements.changed",
      seq: this.nextSeq(),
      text: cmd.text,
    });
  }

  private handleRotiSet(
    ws: WebSocket,
    participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "roti.set" }>,
  ): void {
    // ROTI runs in the closing phase (alongside the appreciation wall).
    if (this.phase() !== "close") {
      this.reject(ws, undefined, "PHASE_LOCKED", "The ROTI poll is closed");
      return;
    }
    this.sql.exec(
      `INSERT INTO roti (participant_id, score) VALUES (?, ?)
       ON CONFLICT(participant_id) DO UPDATE SET score = excluded.score`,
      participant.id,
      cmd.score,
    );
    // Anonymous: only the running aggregate is broadcast; the caster learns
    // their own score via a private frame to EVERY one of their sockets (a
    // second tab / projector must not show a stale selection), never fanning
    // the individual score to anyone else.
    this.sendRotiYouTo(participant.id, cmd.score);
    const agg = this.rotiAggregate();
    this.broadcastAll({
      type: "roti.aggregate",
      seq: this.nextSeq(),
      count: agg.count,
      average: agg.average,
    });
  }

  private rotiAggregate(): { count: number; average: number | null } {
    const row = this.sql
      .exec("SELECT COUNT(*) AS n, COALESCE(AVG(score), 0) AS avg FROM roti")
      .toArray()[0];
    const count = Number(row?.n ?? 0);
    // Withhold the average until enough people respond to keep it anonymous
    // (see ROTI_MIN_ANONYMOUS). Below the threshold clients see only the count.
    // Round to one decimal for a stable, readable average.
    const average =
      count < ROTI_MIN_ANONYMOUS
        ? null
        : Math.round(Number(row?.avg ?? 0) * 10) / 10;
    return { count, average };
  }

  private myRotiScore(participantId: string): number | null {
    const row = this.sql
      .exec("SELECT score FROM roti WHERE participant_id = ?", participantId)
      .toArray()[0];
    return row === undefined ? null : Number(row.score);
  }

  private kudoRowById(id: string): KudoRow | null {
    return (
      (this.sql.exec("SELECT * FROM kudos WHERE id = ?", id).toArray()[0] as
        KudoRow | undefined) ?? null
    );
  }

  private kudoById(id: string): Kudo | null {
    const row = this.kudoRowById(id);
    return row === null ? null : rowToKudo(row);
  }

  private allKudos(): Kudo[] {
    return this.sql
      .exec("SELECT * FROM kudos ORDER BY created_at")
      .toArray()
      .map((row) => rowToKudo(row as unknown as KudoRow));
  }

  // A stored gif URL must be https on the allowlisted provider host AND the
  // board must have GIFs enabled — otherwise it is dropped (not stored). This
  // stops a modified client from planting an arbitrary external <img> that
  // would leak every viewer's IP, and enforces the per-board opt-out that is
  // otherwise only a client-side gate. Preserves undefined ("keep" on update).
  private sanitizeGifUrl(
    url: string | null | undefined,
  ): string | null | undefined {
    if (url === undefined) return undefined;
    if (url === null) return null;
    if (this.getMeta("gifsEnabled") === "0") return null;
    let host: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return null;
      host = parsed.hostname.toLowerCase();
    } catch {
      return null;
    }
    const suffix = (this.env.GIF_HOST_SUFFIX || "klipy.com").toLowerCase();
    return host === suffix || host.endsWith("." + suffix) ? url : null;
  }

  // Staged reveal: the wall is empty until the close phase; anonymous kudos
  // never expose the sender id (kept server-side only for delete authorship).
  private kudosForPhase(phase: Phase, _viewerId: string): Kudo[] {
    if (phase !== "close" && phase !== "done") return [];
    return this.allKudos();
  }

  // RPC: structured board snapshot for the export route. Author/owner/sender
  // names are included only when the caller opts in (default: depersonalized).
  async exportBoard(includeAuthors: boolean): Promise<BoardExport | null> {
    if (this.getMeta("id") === null) return null;
    const names = new Map(
      this.sql
        .exec("SELECT id, name FROM participants")
        .toArray()
        .map((row) => [String(row.id), String(row.name)] as const),
    );
    const nameOf = (id: string | null): string | null =>
      includeAuthors && id !== null ? (names.get(id) ?? null) : null;

    // Privacy: notes are private per-author until the reveal, and the export
    // has no viewer to scope to — so pre-reveal exports carry NO note bodies
    // (mirrors the write-phase wire rule). Vote tallies stay blind until the
    // reveal closes (discuss onward), exactly like the live votesForSync.
    const phase = this.phase();
    const notesRevealed = phaseRevealed(phase);
    const talliesShown =
      phase === "discuss" || phase === "close" || phase === "done";
    const revealedVotes = talliesShown
      ? this.talliesAndTop()
      : { tallies: {} as Record<string, number>, topTargetIds: [] as string[] };

    const notesByColumn = new Map<string, Note[]>();
    if (notesRevealed) {
      for (const note of this.allNotes()) {
        const list = notesByColumn.get(note.columnId) ?? [];
        list.push(note);
        notesByColumn.set(note.columnId, list);
      }
    }

    // Hidden (staged) columns are omitted from the export — it has no viewer to
    // scope to and may be shared, so a hidden column's contents must not surface.
    const columns = this.columns()
      .filter((column) => !column.hidden)
      .map((column) => {
        // Every note is exported (stack members included — no content dropped);
        // stacks are kept adjacent, and only the votable (ungrouped note or
        // stack anchor) carries the tally so votes aren't double-counted.
        const notes = (notesByColumn.get(column.id) ?? [])
          .slice()
          .sort(
            (a, b) =>
              (a.groupId ?? a.id).localeCompare(b.groupId ?? b.id) ||
              a.order - b.order ||
              a.id.localeCompare(b.id),
          );
        return {
          name: column.name,
          notes: notes.map((n) => {
            const isVotable = n.groupId === null || n.groupId === n.id;
            const votableId = n.groupId ?? n.id;
            const rank = isVotable
              ? revealedVotes.topTargetIds.indexOf(votableId)
              : -1;
            return {
              text: n.text,
              gifUrl: n.gifUrl,
              authorName: nameOf(n.authorId),
              votes: isVotable
                ? (revealedVotes.tallies[votableId] ?? null)
                : null,
              crownedRank: rank >= 0 ? rank + 1 : null,
            };
          }),
        };
      });

    return {
      boardName: this.getMeta("name") ?? "",
      createdAt: Number(this.getMeta("createdAt") ?? 0),
      columns,
      actions: this.actions().map((a) => ({
        text: a.text,
        ownerName: nameOf(a.ownerId),
        done: a.status === "done",
      })),
      kudos: this.allKudos().map((k) => ({
        cardType: k.cardType,
        toName: names.get(k.toId) ?? "someone",
        fromName: nameOf(k.fromId),
        text: k.text,
      })),
    };
  }

  // ---------------------------------------------------------------------
  // snapshots & broadcast plumbing
  // ---------------------------------------------------------------------

  private picker(): PickerState | null {
    const raw = this.getMeta("picker");
    if (raw === null) return null;
    const parsed = pickerStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  private savePicker(picker: PickerState): void {
    this.setMeta("picker", JSON.stringify(picker));
  }

  private lastSpin(): WheelSpin | null {
    const raw = this.getMeta("lastSpin");
    if (raw === null) return null;
    const parsed = wheelSpinSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  private activeSpinForSync(): WheelSpin | null {
    const spin = this.lastSpin();
    if (spin === null) return null;
    return Date.now() < spin.startAt + spin.durationMs + WHEEL_HOLD_MS
      ? spin
      : null;
  }

  // Anonymized note totals per column (all authors, no ids, no text) — the
  // write-phase "cards exist" signal. Columns with no notes are simply absent
  // (the client reads them as 0).
  private columnCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of this.sql
      .exec("SELECT column_id, COUNT(*) AS n FROM notes GROUP BY column_id")
      .toArray()) {
      counts[String(row.column_id)] = Number(row.n);
    }
    return counts;
  }

  // Broadcast fresh counts, but only while writing — the placeholder they feed
  // is a write-phase affordance, and from the reveal on everyone sees the notes
  // themselves.
  private broadcastColumnCountsIfWriting(): void {
    if (this.phase() !== "write") return;
    this.broadcastAll({
      type: "board.columnCounts",
      seq: this.nextSeq(),
      counts: this.columnCounts(),
    });
  }

  private buildSync(
    participant: ParticipantRow,
    sessionKey: string,
  ): ServerEvent {
    const phase = this.phase();
    // null for facilitators (they see every column); the hidden-column set for
    // members — gates BOTH the columns array and the notes below.
    const hiddenColumns = this.hiddenColumnsFor(participant);
    return {
      type: "sync",
      seq: this.currentSeq(),
      serverNow: Date.now(),
      board: this.boardInfo(),
      config: this.config(),
      phase,
      timer: this.timer(),
      you: { ...rowToParticipant(participant), sessionKey },
      roster: this.roster(),
      readyIds: this.sql
        .exec("SELECT id FROM participants WHERE ready = 1")
        .toArray()
        .map((row) => String(row.id)),
      // Members never receive hidden (staged) columns; facilitators see all.
      columns:
        hiddenColumns === null
          ? this.columns()
          : this.columns().filter((c) => !c.hidden),
      // Anonymized per-column totals only matter while writing; other phases
      // reveal the notes themselves, so send an empty map there.
      columnCounts: phase === "write" ? this.columnCounts() : {},
      picker: this.picker(),
      lastSpin: this.activeSpinForSync(),
      votes: this.votesForSync(participant.id, phase),
      discussFocusId: this.getMeta("discussFocus"),
      actions: this.actions(),
      // Staged reveal: the appreciation wall only appears from the close phase.
      kudos: this.kudosForPhase(phase, participant.id),
      icebreakerId:
        (this.getMeta("icebreakerId") as IcebreakerId | null) ?? null,
      workingAgreements: this.getMeta("workingAgreements") ?? "",
      roti: {
        ...this.rotiAggregate(),
        yourScore: this.myRotiScore(participant.id),
      },
      retentionAt: this.retentionAt(),
      // The snapshot passes through the SAME visibility filter as live
      // events — including the hidden-column gate — the classic leak path.
      notes: visibleNotesFor(
        this.allNotes(),
        participant.id,
        phase,
        this.anonymous(),
        hiddenColumns,
      ),
    };
  }

  // Send a note event to every recipient allowed to see the note, with
  // per-recipient anonymity redaction.
  private broadcastNoteEvent(
    makeEvent: (note: Note) => ServerEvent,
    note: Note,
  ): void {
    const phase = this.phase();
    const anonymous = this.anonymous();
    const hidden = this.hiddenColumnIds();
    this.broadcastEach((recipientId) =>
      noteVisibleTo(
        note,
        recipientId,
        phase,
        this.hiddenSetFor(recipientId, hidden),
      )
        ? makeEvent(redactNoteForViewer(note, recipientId, anonymous))
        : null,
    );
  }

  // Fan-out after a move/group that may change a note's COLUMN — and therefore
  // whether a member may see it. Recipients who can see it now get an upserting
  // note.updated; a member who can no longer see it because the note landed in
  // a staged (hidden) column gets a note.deleted, so no stale card lingers in
  // its old position (the note-level analogue of column hide/reveal). Ordinary
  // pre-reveal privacy is unaffected: when the note is NOT in a hidden column,
  // non-viewers get nothing, exactly like broadcastNoteEvent.
  private broadcastNoteReorg(note: Note): void {
    const phase = this.phase();
    const anonymous = this.anonymous();
    const hidden = this.hiddenColumnIds();
    const landedHidden = hidden.has(note.columnId);
    const seq = this.nextSeq();
    this.broadcastEach((recipientId) => {
      if (
        noteVisibleTo(
          note,
          recipientId,
          phase,
          this.hiddenSetFor(recipientId, hidden),
        )
      ) {
        return {
          type: "note.updated",
          seq,
          note: redactNoteForViewer(note, recipientId, anonymous),
        };
      }
      return landedHidden
        ? { type: "note.deleted", seq, noteId: note.id }
        : null;
    });
  }

  // The hidden-column gate for a specific recipient: null (sees all) for a
  // facilitator, otherwise the precomputed set. Pass the set in so a per-note
  // fan-out doesn't re-query the hidden columns for every recipient.
  private hiddenSetFor(
    recipientId: string,
    hidden: ReadonlySet<string>,
  ): ReadonlySet<string> | null {
    return this.participantById(recipientId)?.role === "facilitator"
      ? null
      : hidden;
  }

  // Per-recipient fan-out: the mapper decides, per participant, which event
  // (if any) their sockets receive. THE privacy enforcement point.
  private broadcastEach(
    makeEvent: (participantId: string) => ServerEvent | null,
  ): void {
    const cache = new Map<string, string | null>();
    for (const ws of this.ctx.getWebSockets()) {
      const participantId = readAttachment(ws)?.participantId ?? null;
      if (participantId === null) continue; // not joined yet
      let frame = cache.get(participantId);
      if (frame === undefined) {
        const event = makeEvent(participantId);
        frame = event === null ? null : JSON.stringify(event);
        cache.set(participantId, frame);
      }
      if (frame !== null) this.trySend(ws, frame);
    }
  }

  private broadcastAll(event: ServerEvent, exclude?: WebSocket): void {
    const frame = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      if (readAttachment(ws)?.participantId === null) continue;
      this.trySend(ws, frame);
    }
  }

  private send(ws: WebSocket, event: ServerEvent): void {
    this.trySend(ws, JSON.stringify(event));
  }

  // A socket can die between getWebSockets() and send() — one dead socket
  // must never abort a fan-out after SQL has committed. Its own close/error
  // handler does the disconnect bookkeeping.
  private trySend(ws: WebSocket, frame: string): void {
    try {
      ws.send(frame);
    } catch {
      // dead socket — skip
    }
  }

  private ack(ws: WebSocket, opId: string, seq?: number): void {
    this.send(ws, { type: "ack", opId, seq: seq ?? this.currentSeq() });
  }

  private reject(
    ws: WebSocket,
    opId: string | undefined,
    code: RejectCode,
    reason: string,
  ): void {
    this.send(
      ws,
      opId === undefined
        ? { type: "reject", code, reason }
        : { type: "reject", opId, code, reason },
    );
  }

  // ---------------------------------------------------------------------
  // storage accessors
  // ---------------------------------------------------------------------

  private participantForSocket(ws: WebSocket): ParticipantRow | null {
    const participantId = readAttachment(ws)?.participantId ?? null;
    return participantId === null ? null : this.participantById(participantId);
  }

  private participantById(id: string): ParticipantRow | null {
    return (
      (this.sql
        .exec("SELECT * FROM participants WHERE id = ?", id)
        .toArray()[0] as ParticipantRow | undefined) ?? null
    );
  }

  private columnById(id: string): Column | null {
    const row = this.sql
      .exec("SELECT * FROM columns WHERE id = ?", id)
      .toArray()[0];
    return row === undefined ? null : rowToColumn(row);
  }

  private columns(): Column[] {
    return this.sql
      .exec("SELECT * FROM columns ORDER BY ord")
      .toArray()
      .map(rowToColumn);
  }

  // Every currently-hidden column id. Used to withhold hidden columns and their
  // notes from members on both the live wire and the sync snapshot.
  private hiddenColumnIds(): Set<string> {
    return new Set(
      this.sql
        .exec("SELECT id FROM columns WHERE hidden = 1")
        .toArray()
        .map((row) => String(row.id)),
    );
  }

  // The hidden-column set as this viewer experiences it: facilitators see every
  // column (null = no gate), members have hidden columns withheld.
  private hiddenColumnsFor(
    participant: ParticipantRow,
  ): ReadonlySet<string> | null {
    return participant.role === "facilitator" ? null : this.hiddenColumnIds();
  }

  // The column as this participant may act on it. A hidden column is invisible
  // to members — treated exactly like a non-existent one (NOT_FOUND, no
  // existence oracle). Facilitators may target hidden columns.
  private columnFor(
    columnId: string,
    participant: ParticipantRow,
  ): Column | null {
    const column = this.columnById(columnId);
    if (column === null) return null;
    if (column.hidden && participant.role !== "facilitator") return null;
    return column;
  }

  private noteRowById(id: string): NoteRow | null {
    return (
      (this.sql.exec("SELECT * FROM notes WHERE id = ?", id).toArray()[0] as
        NoteRow | undefined) ?? null
    );
  }

  private noteById(id: string): Note | null {
    const row = this.noteRowById(id);
    if (row === null) return null;
    // Targeted read — the full-table reactionsByNote() scan would bill
    // O(all reactions on the board) rows for every single note event.
    const reactions: Record<string, string[]> = {};
    for (const r of this.sql
      .exec("SELECT participant_id, emoji FROM reactions WHERE note_id = ?", id)
      .toArray()) {
      (reactions[String(r.emoji)] ??= []).push(String(r.participant_id));
    }
    return { ...this.buildNote(row, new Map()), reactions };
  }

  private allNotes(): Note[] {
    const reactions = this.reactionsByNote();
    return this.sql
      .exec("SELECT * FROM notes ORDER BY ord")
      .toArray()
      .map((row) => this.buildNote(row as unknown as NoteRow, reactions));
  }

  private buildNote(
    row: NoteRow,
    reactionsByNote: Map<string, Record<string, string[]>>,
  ): Note {
    return {
      id: row.id,
      columnId: row.column_id,
      authorId: row.author_id,
      text: row.text,
      gifUrl: row.gif_url ?? null,
      order: Number(row.ord),
      groupId: row.group_id ?? null,
      reactions: reactionsByNote.get(row.id) ?? {},
    };
  }

  private reactionsByNote(): Map<string, Record<string, string[]>> {
    const map = new Map<string, Record<string, string[]>>();
    for (const row of this.sql.exec("SELECT * FROM reactions").toArray()) {
      const noteId = String(row.note_id);
      const emoji = String(row.emoji);
      const byEmoji = map.get(noteId) ?? {};
      (byEmoji[emoji] ??= []).push(String(row.participant_id));
      map.set(noteId, byEmoji);
    }
    return map;
  }

  private roster(): Participant[] {
    return this.sql
      .exec("SELECT * FROM participants ORDER BY joined_at")
      .toArray()
      .map((row) => rowToParticipant(row as unknown as ParticipantRow));
  }

  private boardInfo(): BoardInfo {
    return {
      id: this.getMeta("id") ?? "",
      name: this.getMeta("name") ?? "",
      createdAt: Number(this.getMeta("createdAt") ?? 0),
    };
  }

  private config(): BoardConfig {
    const maxRaw = this.getMeta("maxPerTarget");
    return {
      anonymous: this.anonymous(),
      phasePlan: this.phasePlan(),
      votesPerPerson: Number(
        this.getMeta("votesPerPerson") ?? DEFAULT_VOTE_CONFIG.votesPerPerson,
      ),
      maxPerTarget: maxRaw === null || maxRaw === "" ? null : Number(maxRaw),
      topN: Number(this.getMeta("topN") ?? DEFAULT_VOTE_CONFIG.topN),
      // Default true for boards created before the toggle existed.
      gifsEnabled: this.getMeta("gifsEnabled") !== "0",
      // Default to the classic wheel for boards created before the skin field.
      pickerStyle: this.getMeta("pickerStyle") === "slots" ? "slots" : "wheel",
    };
  }

  private retentionAt(): number | null {
    const raw = this.getMeta("retentionAt");
    return raw === null ? null : Number(raw);
  }

  private phase(): Phase {
    return (this.getMeta("phase") ?? "lobby") as Phase;
  }

  private phasePlan() {
    const raw = this.getMeta("phasePlan");
    if (raw === null) return DEFAULT_PHASE_PLAN;
    const parsed = phasePlanSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PHASE_PLAN;
  }

  private anonymous(): boolean {
    return this.getMeta("anonymous") === "1";
  }

  private timer(): Timer {
    const endsAt = this.getMeta("timerEndsAt");
    const paused = this.getMeta("timerPausedMs");
    if (endsAt !== null)
      return { endsAt: Number(endsAt), pausedRemainingMs: null };
    if (paused !== null)
      return { endsAt: null, pausedRemainingMs: Number(paused) };
    return IDLE_TIMER;
  }

  private setTimerMeta(endsAt: number | null, pausedMs: number | null): void {
    this.clearTimerMeta();
    if (endsAt !== null) this.setMeta("timerEndsAt", String(endsAt));
    if (pausedMs !== null) this.setMeta("timerPausedMs", String(pausedMs));
  }

  private clearTimerMeta(): void {
    this.sql.exec(
      "DELETE FROM board_meta WHERE key IN ('timerEndsAt', 'timerPausedMs')",
    );
  }

  private getMeta(key: string): string | null {
    const row = this.sql
      .exec("SELECT value FROM board_meta WHERE key = ?", key)
      .toArray()[0];
    return row === undefined ? null : String(row.value);
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec(
      "INSERT INTO board_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private currentSeq(): number {
    return Number(this.getMeta("seq") ?? 0);
  }

  private nextSeq(): number {
    const next = this.currentSeq() + 1;
    this.setMeta("seq", String(next));
    return next;
  }
}

function rowToParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    role: row.role as ParticipantRole,
    online: row.online === 1,
  };
}

function rowToColumn(row: Record<string, SqlStorageValue>): Column {
  return {
    id: String(row.id),
    name: String(row.name),
    order: Number(row.ord),
    hidden: Number(row.hidden) === 1,
  };
}

function rowToKudo(row: KudoRow): Kudo {
  return {
    id: row.id,
    cardType: row.card_type as KudoCardType,
    toId: row.to_id,
    fromId: row.from_id ?? null,
    text: row.text,
    gifUrl: row.gif_url ?? null,
  };
}

function readAttachment(ws: WebSocket): SocketAttachment | null {
  const attachment: unknown = ws.deserializeAttachment();
  if (attachment === null || typeof attachment !== "object") return null;
  return attachment as SocketAttachment;
}
