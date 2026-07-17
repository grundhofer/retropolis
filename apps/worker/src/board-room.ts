import { DurableObject } from "cloudflare:workers";
import {
  canTransition,
  DEFAULT_PHASE_PLAN,
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
  type BoardConfig,
  type BoardInfo,
  type ClientCommand,
  type Column,
  type Note,
  type Participant,
  type ParticipantRole,
  type Phase,
  type PickerState,
  type RejectCode,
  type ServerEvent,
  type Timer,
  type WheelSpin,
  WHEEL_HOLD_MS,
  WHEEL_SPIN_MS,
  WHEEL_START_DELAY_MS,
  wheelSpinSchema,
} from "@retropolis/shared";
import { generateSecret, randomIndex, safeEqual } from "./ids.js";

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
}

export interface BoardCreation {
  boardId: string;
  name: string;
  adminToken: string;
  columns: Array<{ id: string; name: string; order: number }>;
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
        ord INTEGER NOT NULL
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
  }

  // Called once by the Worker when a board is created (RPC).
  async initialize(creation: BoardCreation): Promise<void> {
    if (this.getMeta("id") !== null) return; // idempotent: replays must not rotate the admin token
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO board_meta (key, value) VALUES
         ('id', ?), ('name', ?), ('adminToken', ?), ('createdAt', ?), ('seq', '0'),
         ('phase', 'lobby'), ('anonymous', '0'), ('phasePlan', ?)`,
      creation.boardId,
      creation.name,
      creation.adminToken,
      String(now),
      JSON.stringify(DEFAULT_PHASE_PLAN),
    );
    for (const column of creation.columns) {
      this.sql.exec(
        "INSERT INTO columns (id, name, ord) VALUES (?, ?, ?)",
        column.id,
        column.name,
        column.order,
      );
    }
  }

  // RPC: board metadata for the join page; null if never created.
  async info(): Promise<BoardInfo | null> {
    return this.getMeta("id") === null ? null : this.boardInfo();
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
      case "admin.picker.exclude":
      case "admin.picker.include":
        this.handlePickerPool(ws, participant, command);
        return;
      case "admin.role.set":
        this.handleRoleSet(ws, participant, command);
        return;
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.handleDisconnect(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.handleDisconnect(ws);
  }

  // Timer expiry. Alarms are at-least-once and this DO has exactly one alarm
  // slot — from M4 on, retention shares it (nearest-deadline wins).
  override async alarm(): Promise<void> {
    const endsAt = this.getMeta("timerEndsAt");
    if (endsAt === null) return;
    if (Date.now() < Number(endsAt) - 250) {
      // spurious/early fire — re-arm
      await this.ctx.storage.setAlarm(Number(endsAt));
      return;
    }
    // Broadcast BEFORE clearing: if anything throws, the at-least-once retry
    // still finds the deadline and re-broadcasts (clients handle duplicates).
    this.broadcastAll({ type: "timer.ended", seq: this.nextSeq() });
    this.clearTimerMeta();
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
    if (columnId !== null && this.columnById(columnId) === null) return; // stale ghost, ignore
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
    if (this.columnById(cmd.columnId) === null) {
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
        { authorId: existing.author_id },
        participant.id,
        this.phase(),
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
      "INSERT INTO notes (id, column_id, author_id, text, ord, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      cmd.noteId,
      cmd.columnId,
      participant.id,
      cmd.text,
      ord,
      Date.now(),
    );
    const note = this.noteById(cmd.noteId);
    if (note === null) return;
    const seq = this.nextSeq();
    this.ack(ws, cmd.opId, seq);
    this.broadcastNoteEvent(
      (n) => ({ type: "note.created", seq, note: n }),
      note,
    );
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
      !noteVisibleTo({ authorId: row.author_id }, participant.id, this.phase())
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
    this.sql.exec(
      "UPDATE notes SET text = ? WHERE id = ?",
      cmd.text,
      cmd.noteId,
    );
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
      !noteVisibleTo({ authorId: row.author_id }, participant.id, this.phase())
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
    this.sql.exec("DELETE FROM notes WHERE id = ?", cmd.noteId);
    const repairedIds =
      row.group_id === null
        ? []
        : this.repairGroupAfterLeave(row.group_id, cmd.noteId);
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
      // sending the id of a hidden note would leak its existence.
      const phase = this.phase();
      this.broadcastEach((recipientId) =>
        noteVisibleTo(note, recipientId, phase)
          ? { type: "note.deleted", seq, noteId: cmd.noteId }
          : null,
      );
    }
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
    if (this.noteRowById(cmd.noteId) === null) {
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
    this.clearTimerMeta();
    void this.ctx.storage.deleteAlarm();

    this.broadcastAll({
      type: "phase.changed",
      seq: this.nextSeq(),
      phase: target,
    });

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
    if (!phaseRevealed(current) && phaseRevealed(target)) {
      const notes = this.allNotes();
      const anonymous = this.anonymous();
      const seq = this.nextSeq();
      this.broadcastEach((recipientId) => {
        const newlyVisible = notes
          .filter((n) => n.authorId !== recipientId)
          .map((n) => redactNoteForViewer(n, recipientId, anonymous));
        return newlyVisible.length > 0
          ? { type: "notes.revealed", seq, notes: newlyVisible }
          : null;
      });
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
        const endsAt = now + cmd.durationSec * 1000;
        this.setTimerMeta(endsAt, null);
        void this.ctx.storage.setAlarm(endsAt);
        break;
      }
      case "admin.timer.pause": {
        if (timer.endsAt === null) {
          this.reject(ws, undefined, "INVALID", "No running timer");
          return;
        }
        this.setTimerMeta(null, Math.max(0, timer.endsAt - now));
        void this.ctx.storage.deleteAlarm();
        break;
      }
      case "admin.timer.resume": {
        if (timer.pausedRemainingMs === null) {
          this.reject(ws, undefined, "INVALID", "No paused timer");
          return;
        }
        const endsAt = now + timer.pausedRemainingMs;
        this.setTimerMeta(endsAt, null);
        void this.ctx.storage.setAlarm(endsAt);
        break;
      }
      case "admin.timer.extend": {
        if (timer.endsAt !== null) {
          const endsAt = timer.endsAt + cmd.addSec * 1000;
          this.setTimerMeta(endsAt, null);
          void this.ctx.storage.setAlarm(endsAt);
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
        void this.ctx.storage.deleteAlarm();
        break;
      }
    }

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
      { type: `admin.column.${"create" | "rename" | "delete"}` }
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
        this.broadcastAll({ type: "column.created", seq, column });
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
        this.broadcastAll({ type: "column.renamed", seq, column });
        return;
      }
      case "admin.column.delete": {
        if (this.columnById(cmd.columnId) === null) {
          this.ack(ws, cmd.opId); // idempotent
          return;
        }
        this.sql.exec(
          "DELETE FROM reactions WHERE note_id IN (SELECT id FROM notes WHERE column_id = ?)",
          cmd.columnId,
        );
        this.sql.exec("DELETE FROM notes WHERE column_id = ?", cmd.columnId);
        this.sql.exec("DELETE FROM columns WHERE id = ?", cmd.columnId);
        const seq = this.nextSeq();
        this.ack(ws, cmd.opId, seq);
        this.broadcastAll({
          type: "column.deleted",
          seq,
          columnId: cmd.columnId,
        });
        return;
      }
    }
  }

  // ---------------------------------------------------------------------
  // grouping & moving (revealed phases: the board is curated collectively)
  // ---------------------------------------------------------------------

  private handleNoteGroup(
    ws: WebSocket,
    _participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "note.group" }>,
  ): void {
    const phase = this.phase();
    if (!phaseRevealed(phase) || phase === "done") {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "Grouping is available after the reveal",
      );
      return;
    }
    if (cmd.noteId === cmd.targetNoteId) {
      this.reject(ws, cmd.opId, "INVALID", "Cannot group a note with itself");
      return;
    }
    const note = this.noteRowById(cmd.noteId);
    const target = this.noteRowById(cmd.targetNoteId);
    if (note === null || target === null) {
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
    changed.push(note.id);
    if (leftGroup !== null) {
      changed.push(...this.repairGroupAfterLeave(leftGroup, note.id));
    }
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

  private handleNoteUngroup(
    ws: WebSocket,
    _participant: ParticipantRow,
    cmd: Extract<ClientCommand, { type: "note.ungroup" }>,
  ): void {
    const phase = this.phase();
    if (!phaseRevealed(phase) || phase === "done") {
      this.reject(
        ws,
        cmd.opId,
        "PHASE_LOCKED",
        "Grouping is available after the reveal",
      );
      return;
    }
    const note = this.noteRowById(cmd.noteId);
    if (note === null) {
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
    if (phase === "done") {
      this.reject(ws, cmd.opId, "PHASE_LOCKED", "The retro is finished");
      return;
    }
    const note = this.noteRowById(cmd.noteId);
    // Invisible notes answer like nonexistent ones (existence oracle).
    if (
      note === null ||
      !noteVisibleTo({ authorId: note.author_id }, participant.id, phase)
    ) {
      this.reject(ws, cmd.opId, "NOT_FOUND", "Note does not exist");
      return;
    }
    // Before the reveal you sort only your own notes; afterwards the board is
    // curated collectively.
    if (!phaseRevealed(phase) && note.author_id !== participant.id) {
      this.reject(
        ws,
        cmd.opId,
        "NOT_AUTHOR",
        "Only the author can move this note",
      );
      return;
    }
    if (this.columnById(cmd.columnId) === null) {
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
      const seq = this.nextSeq();
      this.broadcastNoteEvent(
        (n) => ({ type: "note.updated", seq, note: n }),
        updated,
      );
    }
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
      return [lastId];
    }
    if (members.length >= 2 && groupId === leavingNoteId) {
      const newGroupId = [...members].sort()[0] as string;
      this.sql.exec(
        "UPDATE notes SET group_id = ? WHERE group_id = ?",
        newGroupId,
        groupId,
      );
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

  private buildSync(
    participant: ParticipantRow,
    sessionKey: string,
  ): ServerEvent {
    const phase = this.phase();
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
      columns: this.columns(),
      picker: this.picker(),
      lastSpin: this.activeSpinForSync(),
      // The snapshot passes through the SAME visibility filter as live
      // events — the snapshot is the classic leak path.
      notes: visibleNotesFor(
        this.allNotes(),
        participant.id,
        phase,
        this.anonymous(),
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
    this.broadcastEach((recipientId) =>
      noteVisibleTo(note, recipientId, phase)
        ? makeEvent(redactNoteForViewer(note, recipientId, anonymous))
        : null,
    );
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
    return row === undefined
      ? null
      : { id: String(row.id), name: String(row.name), order: Number(row.ord) };
  }

  private columns(): Column[] {
    return this.sql
      .exec("SELECT * FROM columns ORDER BY ord")
      .toArray()
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        order: Number(row.ord),
      }));
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
    return { anonymous: this.anonymous(), phasePlan: this.phasePlan() };
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

function readAttachment(ws: WebSocket): SocketAttachment | null {
  const attachment: unknown = ws.deserializeAttachment();
  if (attachment === null || typeof attachment !== "object") return null;
  return attachment as SocketAttachment;
}
