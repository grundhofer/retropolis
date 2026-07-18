# Retropolis — Roadmap

Status: **M0–M5 shipped, v1.1 live** · updated 2026-07-18. Milestones are scoped so each ends in something demoable and E2E-tested; the walking skeleton came first so deploy/test infrastructure never blocked feature work later. Cut lines (MVP / v1.x / v2 / later / never) are defined in `01-product-spec.md` §13.

## Shipped — v1.1 (M0–M5)

All five build milestones are complete, deployed to production (https://retropolis.sebastiangrundhoefer.workers.dev), and each passed a multi-agent adversarial review. **176 tests** across four layers (83 shared domain · 80 worker-in-workerd · 2 component · 11 multi-context e2e).

- **M0 — Walking skeleton**: monorepo, EU-jurisdiction BoardRoom DO, WebSocket hibernation, live roster, all four test layers + CI.
- **M1 — Core loop**: 6 templates, private write phase (server-side redaction), ghost cards, ready-check, phase machine, DO-alarm timer, reveal.
- **M2 — Presenting**: wheel-of-fortune picker with rotation tracking, synced presenter focus, drag-grouping with vote-preserving stacks, facilitator handoff.
- **M3 — Deciding**: blind dot-voting (server-enforced budgets, anonymous meter), top-N crowns, synced discussion queue, action items.
- **M4 — Delight & shipping**: appreciation/kudos wall (close phase, anonymity, staged reveal), Markdown/CSV/JSON export (author-excluded by default, phase-gated for privacy), GIF support via the KLIPY proxy + per-board toggle, 90-day retention with keep/delete-now, emoji picker, full DE/EN.
- **M5 — Facilitation rituals**: opening check-in phase (24-question icebreaker bank with facilitator shuffle, all localized DE/EN; dismissible Prime Directive; live-editable working agreements) and a closing anonymous ROTI poll (own score private to the caster's sockets; the average is withheld until three people respond so it can't be differenced back to an individual).

**Follow-ups before wider launch** (not blocking): register the domain (`getretropolis.de` recommended), enable CI auto-deploy secrets, set `KLIPY_API_KEY` (+ `GIF_HOST_SUFFIX`) to turn on live GIF search, and start the Betriebsrat conversation (see `05-privacy-gdpr.md`).

## Original milestone plan (for reference)

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

Slot-machine picker skin · icebreaker bank expansion (~100 questions DE/EN; 24 shipped in M5) · staged/hidden columns as general feature · board duplication.

## v2 (needs team spaces)

`TeamRoom` DO (named team → board list, action-item carry-over auto-injected as retro phase 2, kudos history) · ROTI trend across sprints (the per-retro poll shipped in M5) · Lean Coffee + Team Health Check board types · lotto-ball machine · pixel cursors (group/discuss phases only, 3–4 Hz) · PDF export · multi-round voting · parking lot · safety check.

## Later / research

AI grouping suggestions + AI summary (paid inference conflicts with free-tier economics — revisit with budget) · Jira/Slack integrations · async mode · optional E2E encryption ("server sees only ciphertext" — a strong German-market story) · template import/export.
