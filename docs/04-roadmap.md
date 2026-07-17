# Retropolis — Roadmap

Status: draft v1 · 2026-07-17. Milestones are scoped so each ends in something demoable and E2E-tested; the walking skeleton comes first so deploy/test infrastructure never blocks feature work later. Cut lines (MVP / v1.x / v2 / later / never) are defined in `01-product-spec.md` §13.

## M0 — Walking skeleton (foundation)

Goal: a deployed, tested "hello board" proving every architectural mechanism end to end.

- pnpm monorepo (`apps/web`, `apps/worker`, `packages/shared`), TS strict, ESLint 9 + Prettier, `@cloudflare/vite-plugin` dev loop (one command: SPA + Worker + DO in workerd).
- `POST /api/boards` creates a BoardRoom DO (**jurisdiction "eu" from day one** — location is fixed at creation, this cannot be retrofitted), mints admin token; join page → WebSocket via partysocket → Hibernation API accept → `sync` snapshot round-trip; zod protocol envelope; `applyServerEvent` reducer shared by both ends.
- All four test layers running in CI on a trivial feature (join roster): domain, pool-workers (incl. the separate `--no-isolate` WS project), component, one multi-context Playwright test. PR preview deploys (`env.preview`) + production deploy on main.
- Definition of done: two browsers see each other join a deployed board.

## M1 — The core loop: write → reveal

- Templates (6) + custom columns; board settings.
- Notes CRUD with optimistic ops + ack/reject; emoji reactions (fixed row).
- **Private write phase with server-side redaction** — including the filtered snapshot path; the multi-context "A writes, B sees nothing until reveal" E2E test is the acceptance gate.
- Ghost cards + roster presence; ready-check; phase state machine with the big "next phase" button; timer (deadline + DO alarm, pause/+1 min, sound, soft timeout).
- Reveal: all-at-once and per-column, with stagger animation.

## M2 — Presenting: picker + grouping

- Wheel of fortune: server draw (CSPRNG) → seeded deterministic replay on all clients; pool/history; admin re-spin/skip/add/remove; "everyone presented" celebration; reduced-motion + aria-live paths.
- Synced presenter focus (picked person's notes spotlighted everywhere).
- Drag grouping/merge with unmerge; stack vote/reaction attachment.
- Facilitator handoff + co-admin.

## M3 — Deciding: voting + discussion

- Blind dot-voting: per-person budget, optional per-card cap, uniform dots, admin progress meter; server-enforced.
- Vote close → tallies + top-N crowning → discussion queue walking the winners.
- Action items with owner (per board in v1).

## M4 — Delight & shipping: kudos, GIFs, export, i18n, retention

- Appreciation wall (hidden section, Close-phase reveal, card types, read-aloud flow).
- KLIPY GIF proxy (`rating` forced, cached, attribution, per-board toggle); emoji picker (self-hosted data).
- Markdown/CSV/JSON export (authors excluded by default); archived read-only board view.
- DE+EN i18n pass over everything; icebreaker check-in (minimal: random question display).
- 90-day retention self-delete alarm + delete-now; usage telemetry counter; degradation banner.
- A11y + `prefers-reduced-motion` audit; empty/error/reconnect states. **→ v1.0 launch**: register domain (recommendation: getretropolis.de), Betriebsrat sign-off (see `05-privacy-gdpr.md` — start this conversation during M1, not after M4).

## v1.x (fast follows)

Slot-machine picker skin · full icebreaker bank (~100 questions DE/EN) + weather check-in · staged/hidden columns as general feature · working-agreements card · board duplication.

## v2 (needs team spaces)

`TeamRoom` DO (named team → board list, action-item carry-over auto-injected as retro phase 2, kudos history) · ROTI poll + trend · Lean Coffee + Team Health Check board types · lotto-ball machine · pixel cursors (group/discuss phases only, 3–4 Hz) · PDF export · multi-round voting · parking lot · safety check.

## Later / research

AI grouping suggestions + AI summary (paid inference conflicts with free-tier economics — revisit with budget) · Jira/Slack integrations · async mode · optional E2E encryption ("server sees only ciphertext" — a strong German-market story) · template import/export.
