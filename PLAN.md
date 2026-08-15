# Retropolis — Project Plan

A guided, playful, genuinely free retrospective tool for teams. Browser-only, realtime, hosted on the Cloudflare free tier, EU data residency, German + English UI.

Created 2026-07-17 from a multi-agent research pass (11 competitor deep-dives, Cloudflare free-tier verification, retro facilitation research, realtime/picker UX research, three-way tech-stack judge panel — all facts verified against primary sources in July 2026).

## The plan

| Doc                                                           | Contents                                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01-product-spec.md](docs/01-product-spec.md)                 | Vision & positioning, roles, the 7-phase session flow, templates, privacy model, voting, pickers, appreciation wall, GIFs/emoji, exports, UX principles, MVP cut lines          |
| [02-architecture.md](docs/02-architecture.md)                 | Stack decision (React 19 + Vite 7 + Workers/Durable Objects), system design, realtime protocol, data model, free-tier survival rules, security, 4-layer testing strategy, risks |
| [03-competitive-analysis.md](docs/03-competitive-analysis.md) | Market read, feature matrix across 11 tools, table stakes, differentiators, deliberate skips, per-competitor profiles                                                           |
| [04-roadmap.md](docs/04-roadmap.md)                           | M0 walking skeleton → M4 launch, then v1.x / v2 / later                                                                                                                         |
| [05-privacy-gdpr.md](docs/05-privacy-gdpr.md)                 | GDPR + §87 BetrVG works-council playbook, data inventory, sub-processors, rollout checklist                                                                                     |
| [06-legal.md](docs/06-legal.md)                               | AGPL-3.0 decision & monetisation model, CLA rationale, dependency-licence policy, trademark findings and filing plan, pre-launch legal checklist                                |

## Decisions locked (2026-07-17)

1. **Access:** no accounts — share link (+ QR) for participants, capability admin link for the facilitator.
2. **Privacy:** EU-jurisdiction Durable Objects; boards auto-delete after 90 days; per-board anonymity toggle (default off).
3. **Language:** German + English i18n from day one.
4. **Stack:** judge-panel winner — pnpm monorepo · React 19 + Vite 7 + `@cloudflare/vite-plugin` · zustand · Tailwind 4 + shadcn/ui · motion · partysocket · Hono + one SQLite-backed `BoardRoom` DO per board (WebSocket Hibernation API, DO alarms) · zod protocol + pure domain core in `packages/shared` · Vitest 4 (+ pool-workers) + Playwright.
5. **GIFs:** KLIPY via Worker proxy (Tenor API is dead as of 2026-06-30; GIPHY's free production tier no longer exists).
6. **Realtime model:** server-authoritative with optimistic ops (Figma model), no CRDT; write-phase privacy enforced server-side by payload omission.
7. **Presence:** v1 = roster + ghost cards ("Anna is writing in _Went well_"); pixel cursors deferred to v2 (privacy leak during write phase + the #1 free-tier cost driver).

## Open questions (user decision needed before launch, none block development)

1. **Domain/name:** `retropolis.de` is taken. Register **getretropolis.de** (recommended; verified available 2026-07-17), `retropolis-app.de`, `retropolis24.de` — or rename? Only one .de will be registered. **Decide this together with the trademark question:** "Retropolis" is already in commercial use by three unrelated games in Nice class 9 — run the register search in [docs/06-legal.md](docs/06-legal.md) before committing to the name, while the repo is still private and renaming is free.
2. **Works council:** does the company have a Betriebsrat? If yes, start the §87 BetrVG conversation during M1 (see docs/05).
