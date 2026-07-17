# Competitive Analysis

Researched July 2026. Covers 11 products: EasyRetro, Parabol, Retrium, TeamRetro, Spreo (ex-Metro Retro), Neatro, GoRetro, Scrumlr, Kollabe, retro.tools, Retrospected.

## Market read

The retro-tool market has spent the last two years retreating from free. Retrium, TeamRetro, and Spreo now offer no free plan at all — only 30-day trials (all verified July 2026). GoRetro's once-generous free plan was gutted in late 2025; its own site now shows conflicting messaging between the pricing page (trial only) and residual help articles. EasyRetro cut its free tier from 3 public boards per month to 1, with only a single board retained on the dashboard. Kollabe's free plan caps history at 7 days and meetings per month. The clearest cautionary tale is Spreo: removing the free plan in September 2024 caused visible community backlash and documented churn to Kollabe, EasyRetro, and others — and spawned competitors marketing "no-signup, free" directly against it. The only genuinely free, no-strings competitor left standing is Scrumlr, a showcase project by inovex — and it lacks action items, comments, GIFs, pickers, and guarantees no long-term persistence.

The second structural split is guided versus playful. The guided-phase tools (Parabol, Retrium, Neatro, and to a degree TeamRetro) enforce a linear facilitation wizard — private write, group, vote, discuss — and are repeatedly criticized as utilitarian and joyless: no GIFs, no sounds, no random pickers. The one genuinely playful tool, Spreo, has spinners, a jukebox, confetti cannons, and cursor hats — but it is a freeform infinite canvas with no phase state machine, and competitors like TeamRetro explicitly market "guided step-by-step retros" against exactly that, because it confuses retro novices. Meanwhile the toggle-driven tools (EasyRetro, GoRetro, Scrumlr, retro.tools) make facilitators hand-flip individual settings mid-session, a documented source of misconfiguration pain. Guided AND playful is an empty quadrant.

Third, the German/EU market is underserved. Parabol's English-only UI is a repeatedly cited complaint from international teams. GoRetro hosts data only in US Central — a real problem for GDPR-conscious German buyers. Neatro, Kollabe, and Retrospected have no independent GDPR/SOC 2 attestation. Scrumlr proves the counter-positioning works: "hosted in Germany, GDPR-compliant, no account needed" is essentially its entire pitch, and it has real traction with this audience — but it is feature-thin and its hosted instance offers no persistence guarantee.

Retropolis sits at the intersection all four gaps leave open: guided (an explicit, labeled phase stepper with ready-checks) and playful (GIFs, wheel-of-fortune presenter picker, kudos phase, confetti-grade details) and genuinely free (Cloudflare free-tier economics make "actually free, no board caps" durable rather than a loss-leader to be gutted later) and EU-hosted with a German+English UI and no participant PII (link-only join). No competitor occupies more than two of these positions at once, and the two unique features in the field — a random presenter picker with rotation tracking, and an appreciation phase — are cheap to build.

## Feature matrix

Legend: ✓ = full support, partial = limited/paid-gated/undocumented, ✗ = absent. Products: EasyRetro (ER), Parabol (PB), Retrium (RT), TeamRetro (TR), Spreo/ex-MetroRetro (SP), Neatro (NE), GoRetro (GR), Scrumlr (SC), Kollabe (KO), retro.tools (rt), Retrospected (RS).

| Feature                                                           | ER      | PB      | RT      | TR      | SP      | NE      | GR      | SC      | KO      | rt      | RS      |
| ----------------------------------------------------------------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| Permanent usable free tier                                        | partial | ✓       | ✗       | ✗       | ✗       | ✓       | partial | ✓       | partial | ✓       | partial |
| No-account join for participants                                  | ✓       | ✗       | ✗       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       |
| Templates + custom columns                                        | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       |
| Private write phase (own notes only until reveal)                 | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | partial | ✓       | ✓       |
| Anonymity option (hide authors)                                   | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       |
| Live presence / typing-activity indicators                        | ✗       | partial | ✓       | ✓       | ✓       | partial | partial | partial | partial | ✗       | partial |
| Live cursors on board                                             | ✗       | ✗       | ✗       | ✗       | ✓       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       |
| Ready-check ("I'm done" signal)                                   | ✗       | ✓       | partial | ✓       | ✓       | ✓       | ✗       | ✓       | ✓       | ✗       | ✓       |
| Explicit phase state machine (admin advances)                     | ✗       | ✓       | ✓       | ✓       | ✗       | ✓       | ✗       | ✗       | ✓       | ✗       | ✗       |
| Facilitator timer (pause / add time)                              | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       |
| Background music / playful sounds                                 | ✗       | ✗       | ✗       | ✓       | ✓       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       |
| GIFs on cards                                                     | ✓       | ✗       | ✗       | ✓       | ✗       | ✗       | ✓       | ✗       | ✓       | ✗       | ✓       |
| Emoji reactions on cards                                          | ✓       | ✓       | ✓       | partial | ✓       | ✗       | partial | ✓       | ✓       | ✓       | ✗       |
| Comments/threads on cards                                         | ✓       | ✓       | ✗       | ✓       | ✓       | ✗       | ✓       | ✗       | ✓       | ✗       | ✗       |
| Card grouping/merging (drag)                                      | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✗       | ✓       |
| AI grouping/clustering                                            | ✗       | partial | ✗       | ✓       | partial | ✗       | ✗       | ✗       | ✓       | ✗       | ✗       |
| Admin-configurable votes per person                               | ✓       | ✓       | ✗       | ✓       | ✓       | ✓       | ✓       | ✓       | partial | ✗       | ✓       |
| Advanced vote rules (per-card/per-column caps, cast-all, abstain) | partial | partial | partial | ✓       | partial | partial | partial | partial | ✗       | ✗       | partial |
| Votes hidden during voting (anti-bandwagon)                       | ✓       | partial | ✓       | ✓       | partial | ✓       | ✓       | ✓       | ✓       | ✗       | ✗       |
| Auto-sort / discussion queue by votes                             | partial | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       |
| Top-N voted highlight/filter for discussion                       | ✗       | partial | partial | ✓       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       |
| Synced presenter mode (all viewports follow card)                 | partial | ✓       | ✓       | ✓       | ✓       | partial | ✗       | ✓       | ✓       | ✗       | ✗       |
| Random presenter picker (wheel/spinner)                           | ✗       | ✗       | ✗       | partial | ✓       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       |
| "Everyone presents once" rotation tracking                        | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       |
| Action items with owners                                          | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✓       | ✗       | ✓       | ✗       | ✓       |
| Action carry-over to next retro                                   | ✗       | ✓       | ✓       | ✓       | partial | ✓       | ✓       | ✗       | ✓       | ✗       | ✗       |
| Board persistence / history                                       | partial | partial | ✓       | ✓       | ✓       | partial | ✓       | partial | partial | partial | ✓       |
| Export (PDF/CSV/Markdown)                                         | ✓       | partial | partial | ✓       | ✓       | partial | partial | ✓       | partial | partial | ✓       |
| Integrations (Jira/Slack/ADO/...)                                 | ✓       | ✓       | partial | ✓       | partial | partial | partial | ✗       | ✓       | ✗       | ✗       |
| Built-in icebreakers                                              | ✗       | ✓       | ✗       | ✓       | ✓       | ✓       | ✓       | ✗       | ✓       | partial | ✗       |
| Team health check / radar                                         | partial | partial | ✓       | ✓       | partial | ✓       | ✓       | ✗       | ✗       | ✗       | ✗       |
| ROTI / session-quality feedback                                   | ✗       | partial | ✓       | ✓       | ✓       | ✓       | partial | ✗       | partial | ✗       | ✗       |
| Appreciation / kudos section                                      | ✗       | ✗       | ✗       | partial | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       |
| AI summary at close                                               | ✓       | ✓       | ✗       | ✓       | ✗       | ✗       | partial | ✗       | ✓       | ✗       | partial |
| Facilitator handoff / co-admin                                    | ✗       | ✓       | ✓       | ✗       | ✓       | ✗       | ✗       | ✓       | ✓       | partial | ✓       |
| German UI and/or EU-Germany hosting                               | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       | ✗       | ✓       | ✗       | partial | partial |

## Table stakes

Everything below is expected by users of any modern retro tool. Shipping without these means losing on fundamentals before differentiators even register.

- **Template library plus fully custom columns.** 8+ formats (Start-Stop-Continue, Mad-Sad-Glad, 4Ls, Sailboat, ...) with rename/recolor/reorder of columns — 11/11 competitors have this.
- **Private write phase.** Each participant sees only their own notes (hidden or blurred) until the facilitator reveals — 10/11 have it. Retropolis already plans this; it is NOT a differentiator.
- **Anonymity toggle** (show/hide card authors) — 11/11. Best-in-class does it by design: uniform/random note colors, own notes marked by a subtle border (Retrium, Scrumlr).
- **Zero-signup participant join via plain link** — universal except Parabol and Retrium. Monetize/limit by boards, never by participant count.
- **Configurable dot voting.** Admin sets votes per person, with vote counts HIDDEN during the voting phase to prevent bandwagoning (EasyRetro, Retrium, TeamRetro, Neatro, GoRetro, Scrumlr, Kollabe all do this) — hidden-during-voting should be the Retropolis default.
- **Facilitator-controlled timer visible to all**, with sound alert, pause, and add-a-minute (EasyRetro Jun 2026, Retrium, TeamRetro, Scrumlr). Soft timeout — a signal, not a lock — per TeamRetro.
- **Drag-and-drop card grouping/merging of duplicates** — 10/11 have it; only retro.tools lacks it and is criticized for it. Not in the original founder feature list — it is mandatory.
- **Auto-sort cards/columns by vote count when voting closes**, producing the discussion agenda with zero facilitator effort — effectively universal.
- **Emoji reactions on cards** — near-universal (9/11).
- **Ready-check.** Participants mark "I'm done" during write/vote phases, shown as checkmarks/count to the facilitator — 7-8/11 and rising (Kollabe added auto-advance Apr 2026). Now expected in any phase-driven tool.
- **Board persistence under a stable URL plus export** (CSV minimum; PDF/Markdown expected) — universal in some form.
- **Action items with an owner** — 9/11. Only the two hobby open-source tools lack it, and reviews punish Scrumlr hard for the gap.
- **Facilitator handoff / promote a co-admin mid-session** — present in most guided tools. Retrium's historical lack of it dominated its negative reviews.

## Where Retropolis wins (differentiators)

- **Genuinely free, full-featured.** The market has retreated from free: Retrium, TeamRetro, and Spreo are trial-only (verified Jul 2026); GoRetro gutted free late 2025; EasyRetro is down to 1 public board/month; Kollabe's free tier is 4 meetings/month with 7-day history. Spreo's Sept 2024 free-plan removal caused visible backlash and churn. The only real free competitor is Scrumlr, which lacks action items, comments, GIFs, and pickers, and guarantees no persistence. Cloudflare free-tier economics make "actually free, no board caps" a durable moat.
- **Random presenter picker with rotation tracking.** Only Spreo has any picker (a generic Spinner gadget); ZERO tools track who already presented and repeat until everyone has gone. Retropolis's wheel-of-fortune/lotto machine with automatic exclusion of past presenters is unique in the entire field. Pair it with synced presenter mode so the picked person's card focuses everyone's screen.
- **Playful + guided is an empty quadrant.** Guided-phase tools (Parabol, Retrium, Neatro) are explicitly criticized as utilitarian/no-fun; the playful tool (Spreo: jukebox, confetti, cursor hats) has no phase state machine and confuses retro novices. An explicit labeled phase stepper (write → reveal → vote → discuss → appreciate) combined with GIFs, wheel, confetti, and sounds is unoccupied.
- **German/EU trust positioning.** Parabol's English-only UI is a repeatedly cited complaint; GoRetro hosts data only in US Central; Neatro, Kollabe, and Retrospected have no GDPR/SOC 2 attestation. Scrumlr proves "hosted in Germany, GDPR, no account" sells to this audience but is feature-thin. Retropolis: German+English UI, EU data residency (Cloudflare region hints / EU jurisdiction), no participant PII (link-only join) — a marketable trust story competitors can't quickly copy.
- **Appreciation/kudos closing section.** Essentially absent everywhere — TeamRetro has kudos only as a comment type; no tool has an end-on-positives PHASE. Cheap to build (a final column/phase revealed last — Scrumlr's hidden-column trick shows the mechanic) and emotionally sticky.
- **Presence + private-write done together.** Retrium's blur-not-hide (see THAT colleagues write, not WHAT) plus sidebar activity indicators, and TeamRetro's typing indicators beside avatars — none of the free/playful tools have this. Blurred ghost cards + typing dots + ready-count during the hidden write phase delivers Retropolis's planned live presence without breaking privacy.
- **Explicit phase state machine with optional ready-check auto-advance.** EasyRetro, GoRetro, and Scrumlr all make facilitators hand-flip settings toggles (documented misconfiguration pain); Kollabe's Apr 2026 auto-advance-when-all-ready is the freshest pattern. One big "next phase" button plus optional auto-advance directly serves "extremely easy to understand".
- **Admin-configured top-N highlight.** Only TeamRetro offers a "top-N voted" discussion filter; Retropolis's planned "admin sets how many top-voted cards get highlighted" is near-unique. Implement as: voting closes → top N cards visually crowned → discussion queue walks them one at a time.
- **Blind-by-design voting.** Combine hidden vote counts during voting (table stakes) with uniform dot colors and a facilitator-only anonymous progress meter ("7/9 have used all votes" — Neatro). No free tool combines all three.

## What we deliberately skip

- **Planning poker / standups / sprint management suite.** Parabol, Kollabe, Spreo, and GoRetro all diluted into meeting suites. Retro-only focus keeps the app "extremely easy" and small enough for the Cloudflare free tier; GoRetro even paywalls poker at $49/mo, proving it's a separate market.
- **Infinite freeform canvas** (Spreo/Miro model). Flexibility without a phase machine confuses retro novices — TeamRetro markets its guided flow against exactly this. Column boards plus explicit phases beat it for our stated design goals.
- **Full Figma-style live cursors.** Only Spreo has them; they conflict with the private write phase (cursor position leaks what someone is writing about) and add constant WebSocket fan-out cost against Cloudflare free-tier limits. Typing/activity indicators plus ready-count deliver the actual presence value — downgrade "see where colleagues are writing" to blurred ghost cards plus typing indicators.
- **200+ template library or AI template generator.** EasyRetro's 200+ is a checkbox nobody praises; Retrium markets a curated ~15 as quality-over-quantity. Ship 8-12 great templates plus custom columns.
- **Autonomous auto-grouping that moves cards without confirmation.** Spreo's is the canonical G2 complaint ("groups things users don't want"). If AI grouping ever ships (later), suggestions-only.
- **Enterprise SSO/SAML, SCIM, audit logs, SOC 2 program.** For a free internal-team tool this is pure cost; the GDPR / no-PII / link-only-join story covers the German trust need without certification overhead.
- **Surveys/polls module beyond a single ROTI question.** EasyRetro's surveys and Kollabe's polls are undifferentiated bolt-ons nobody cites as a reason to buy.
- **Drawing/annotation on cards, whiteboard shapes/connectors/icon libraries.** Whiteboard feature-weight (Spreo's 30k icons) directly opposes "clean, minimal"; GIFs and emoji already cover expressiveness.
- **Native mobile apps.** Every competitor is responsive-web only; match that.
- **Cross-board analytics/sentiment dashboards.** Enterprise feature with weak love even where it exists (EasyRetro analytics criticized, Neatro's promised analytics never shipped). Board history plus export suffices.
- **Integrations (Jira/Trello/ADO/Slack) at MVP.** Every integration is a maintenance treadmill; Scrumlr thrives with zero integrations in Retropolis's exact target segment. Markdown/CSV export is the 80% solution until v2+.
- **Built-in video/audio chat.** No competitor has it; teams already sit in Teams/Meet/Zoom.

## Competitor profiles

### EasyRetro

**Positioning:** Retro-only browser tool (launched 2015 as FunRetro, rebranded 2020) built around zero-friction adoption: participants join via a bare URL with no account, and the product leans on a 200+ template library.

**Free tier / pricing:** Free plan cut to 1 public board/month (from 3), only 1 board kept on the dashboard, no team/private boards — but unlimited participants. Paid tiers are per-organization; review sites report conflicting 2026 prices (roughly $28-90/mo depending on source), and the official pricing page could not be scraped, so treat exact figures as approximate.

**Session flow:** Entirely toggle-driven — no phase state machine. The facilitator enables "Hide cards" for the private write phase (with an owner-only peek), unhides for reveal (optionally column by column), merges duplicates by manual drag, enables dot voting with configurable limits and hidden counts, then sorts by votes and captures action items. Closes with an AI summary and broad export options (PDF/CSV/PNG/Excel/DOCX/Confluence).

**Worth borrowing:**

- "Hide vote count" during voting — blind dot-voting prevents bandwagoning; make this the Retropolis default
- Vote limits configurable per column, not just per board
- Timer with escalating color warnings, sound, pause/resume, and "+1 minute" (Jun 2026)
- Hide/reveal whole columns — lets the facilitator stage the board (fits an appreciation column revealed last)
- Zero-friction join; limit by board count, never by participant count
- Highlight-on-hover / presentation mode so remote viewers follow the discussed card without live cursors

**Weaknesses:**

- Free tier called "stingy" — a frequent complaint and an opening for a genuinely free tool
- No phase state machine: manual toggle-flipping is easy to misconfigure mid-session
- No ready-check, no live presence, no random picker
- Manual-only grouping is tedious on large boards
- Weak analytics; enterprise gaps (SAML top-tier only, no SOC 2/ISO 27001 advertised) matter to EU buyers

### Parabol

**Positioning:** Open-source (AGPL) meeting suite — retros, standups, sprint poker, check-ins — built as a strictly linear, facilitator-driven wizard rather than a freeform board. The app IS the agenda.

**Free tier / pricing:** Genuinely free Starter: 2 teams, unlimited users, 10 meetings/month, 30-day history, 3 AI summaries/month. Team plan $8 per active user/month (only users who logged in within 30 days are billed). Self-hosting the AGPL codebase removes SaaS limits.

**Session flow:** Facilitator advances fixed phases: icebreaker posed person-by-person, private anonymous Reflect (others' cards shown as blurred placeholders — activity visible, content not), multiplayer drag grouping with AI-suggested theme titles, dot voting (default 5 votes, max 3 per topic), then discussion auto-sorted by votes with threaded comments and takeaway tasks. Ends with an automated summary email to all invitees.

**Worth borrowing:**

- "Ready" button + ready count so participants quietly signal completion
- Anonymized activity during private write: show THAT colleagues are typing without showing WHAT
- Vote cap per topic prevents dot-dumping on one card
- Facilitator handoff at any time (baton pass) — resilience if the admin drops
- Automated end-of-meeting summary (attendance + top topics + action items) — a natural shape for "export best notes"

**Weaknesses:**

- English-only UI — repeatedly cited by international/German teams; a direct opening for Retropolis
- Rigid linear flow; participants sometimes start grouping prematurely, disrupting reflection
- Little fun factor: no GIFs, sounds, or playful pickers
- Free tier gaps: no health checks, only 2 custom templates, 30-day history
- Self-hosting is nontrivial (Node + PostgreSQL + Valkey) versus an edge-native app

### Retrium

**Positioning:** Premium guided-facilitation retro tool for enterprise teams; "Guided Facilitation" enforces a Think → Group → Vote → Discuss → Wrap-Up sequence that only the facilitator can advance.

**Free tier / pricing:** No free tier at all — 30-day trial only. Paid per Team Room, not per user: Team $39/mo/room, Business $59/mo/room billed annually (adds SAML SSO), Enterprise custom (25+ teams). Verified July 2026.

**Session flow:** Private Think phase shows others' notes blurred (activity visible, content not) with a live-presence sidebar. Grouping is collaborative drag-and-drop. Voting is private and anonymous with an auto-calculated allotment (votes per person = square root of topic count — not facilitator-configurable), and the phase cannot advance until everyone has voted. Discuss switches layout entirely to one topic at a time, ordered by votes; Wrap-Up collects a 1-5 ROTI rating.

**Worth borrowing:**

- Blur (not hide) others' notes during write, plus sidebar "active now" indicators — exactly Retropolis's planned presence + private-write combo
- Hard ready-gate on voting: can't advance until every participant has voted
- Anonymity through design: randomized note colors, subtle private marker on own notes, uniform vote-dot colors
- Discuss phase leaves the column board and shows one top-voted topic at a time
- ROTI wrap-up (1-5 "was this retro worth our time?") — cheap meta-feedback loop
- Facilitator "Abstain" button so the admin doesn't skew the vote gate

**Weaknesses:**

- No free tier; price seen as high, and per-room cost multiplies across teams
- Vote count imposed by formula, not facilitator-configurable
- No AI features, exports limited to CSV/TXT, Jira export transfers only the action-item title
- No fun/energizer mechanics at all — the exact playful gap Retropolis targets
- Historical inability to hand off facilitator mid-meeting shaped its negative reviews (now addressed)

### TeamRetro

**Positioning:** Enterprise-oriented guided retro and team-health platform with the deepest facilitation feature set in the field — nine phases from icebreaker through close, heavy AI assists, and 15 integrations.

**Free tier / pricing:** No permanent free tier — 30-day full-featured trial. Single Team US$25/mo (max 25 members); Small Org $60/mo for 3 teams; Large Org from $90/mo. SSO/SAML on all paid tiers; SOC 2 Type 2, SCIM, audit logs on Enterprise.

**Session flow:** Fixed facilitator-driven sequence: icebreaker and mood check-in, review of open actions from last retro, private brainstorm ("show ideas in next step") with typing indicators and an "I'M FINISHED" ready-check shown as avatar checkmarks, drag or AI-suggested grouping, richly configurable voting (per-person, per-idea, per-column caps, mandatory cast-all, abstain, hidden until reveal), then discussion with a Top-N-voted filter and a PRESENT mode that syncs everyone's screens. Closes with a ROTI survey; a parking lot auto-carries deferred topics to the next meeting.

**Worth borrowing:**

- Soft timers: timeout is a signal, not a lock; optional background music during the write phase
- "I'M FINISHED" checkmarks on avatars — directly reusable for Retropolis phase control
- Two-level reveal control: hide IDEAS until next phase AND hide VOTES until next phase, as separate toggles
- Open-actions phase at the START of each retro — closes the loop; the single biggest driver of retro value
- Parking lot with automatic carry-over
- PRESENT mode syncing all viewports — pairs perfectly with the wheel-of-fortune picker

**Weaknesses:**

- No free plan; expensive at scale (~$150/mo for 10 teams)
- Rigid prescribed flow — phases can't be freely reordered or skipped
- Grouping reported as slow/buggy; UI "quirky" with a learning curve
- Single Team plan capped at 25 members; guests/observers locked behind Enterprise
- Thin independent review base (~12 Capterra reviews); most comparisons are vendor pages

### Spreo (ex-Metro Retro, ex-Ludi)

**Positioning:** Online whiteboard for agile teams with built-in meeting facilitation — the most playful tool in the field (spinner, jukebox, buzzer, confetti cannon, cursor hats) on an infinite freeform canvas. Rebranded twice (~2025-2026): metroretro.io → ludi.co → spreo.io.

**Free tier / pricing:** No free tier since September 2024 — 30-day trial, then boards go read-only. Paid per member: Starter ~$4-5/user/mo, Business ~$6-8/user/mo (figures approximate), Consultant ~$25/host/mo. Board-level guests are free and unlicensed.

**Session flow:** Host activates Meeting Mode on a template board; Private Writing is on by default (notes obscured to others), with a Ready Check button and a placeable timer. Reveal is granular: per-note by the author, "Show All", or host Force Reveal. Notes drag-group into Topics; voting rounds are configurable (votes per person, duplicate-vote toggle) with a results panel, and each new round locks the previous one. Discussion uses spotlight/follow, ping arrows, and a Spinner gadget for random selection. There is no enforced phase machine — the host advances socially, guided by template frames.

**Worth borrowing:**

- Reveal granularity: per-note author reveal + Show All + host Force Reveal; one-at-a-time reveal explicitly framed as anti-anchoring
- "Hide Identities" anonymity is deliberately irreversible — a strong trust guarantee German teams will appreciate
- Versioned voting rounds (new round locks previous results) — vote topics, then vote actions
- Playfulness as first-class gadgets: Spinner, Jukebox playing music to all participants, confetti — direct validation of Retropolis's wheel/lotto idea
- Host can restrict which tools participants may use per phase
- Export with per-column selection incl. votes; HTML/Markdown tuned for Confluence/Notion pasting

**Weaknesses:**

- Free-plan removal (Sept 2024) is the biggest recurring complaint and drove churn to competitors
- Two rebrands in quick succession — documentation, SEO, and identity confusion
- Only one integration (Jira), and it's gated behind the Business plan
- Auto-grouping "grabby" (groups things users don't want); no template preview without creating a board
- Freeform canvas without a phase machine confuses retro novices — competitors market guided flows against exactly this

### Neatro

**Positioning:** Focused, rigid guided-retro tool (Collect → Group → Vote → Action Plan, no freeform mode) with strong anti-groupthink defaults and per-team flat pricing. Small bootstrapped Canadian team.

**Free tier / pricing:** Free forever: up to 10 members, unlimited retros and team radars, 70+ templates — but only 30-day history and NO exports or integrations. Premium $23.20/team/month (per team, not per user); Pro $31.20/team/month adds SAML SSO.

**Session flow:** Optional icebreaker (200+ question game) plus automatic reminder of incomplete action items from last retro. In Collect, others' cards are auto-hidden by default (not a toggle). Grouping is collaborative with theme tagging. In Vote, votes are hidden from participants while the facilitator sees an anonymous real-time progress meter. Action Plan produces SMART items with exactly one owner each, tracked on a cross-session kanban; every retro closes with an automatic anonymous ROTI survey and a full report.

**Worth borrowing:**

- Auto-hide others' cards during write as the default, framed explicitly as anti-groupthink — good marketing angle
- Facilitator-only anonymous voting progress meter ("7/9 have used all votes")
- Action-item carryover: unfinished items auto-resurface at the START of the next session
- Automatic one-click ROTI survey at close
- Exactly one mandatory owner per action item — prevents orphaned outcomes

**Weaknesses:**

- Rigid 4-step flow with no flexibility is polarizing (independent review score 5.1/10 partly for this)
- Free plan has no exports and no integrations — the repeatedly cited main drawback
- No Slack/Teams integration; no AI at all; no recurring scheduling
- No SOC 2 / ISO 27001 / GDPR attestation — relevant for German/EU buyers
- Zero fun extras (no GIFs, music, pickers) and only one icebreaker type; 3-person team means slow feature velocity

### GoRetro

**Positioning:** Retro plus sprint-management tool (by AgileSparks) whose distinguishing idea is data-driven engagement: "Joker cards" generated from the team's own sprint metrics to break blank-board silence.

**Free tier / pricing:** In flux and sources conflict (July 2026): the pricing page shows only a 30-day trial, one comparison says the free plan was discontinued late 2025, yet GoRetro's own help articles still reference a residual 1-team free plan — treat as unreliable. Paid: Premium $29/team/month, Sprint Pro $49/team/month (adds planning poker), per-team pricing.

**Session flow:** Toggle-based like EasyRetro: facilitator flips "hide cards and authors" for the private write window (with a countdown timer), reveals, drag-merges (reversibly), enables voting with per-person limits and hidden counts, then discusses top-voted items — optionally seeded by Joker cards. Closes with a one-click 1-5 happiness check and an auto-generated recap. No ready-check and no enforced phase sequence.

**Worth borrowing:**

- Joker cards: auto-generated discussion prompts from real team data — Retropolis could ship a lightweight canned/randomized prompt-card version
- Persistent action-item backlog that rolls unfinished items into the next retro
- One-click happiness/morale check (1-5) at close with a trend line
- Auto-generated meeting recap (top cards, participation, action items) as a one-click artifact
- Merge/unmerge — reversible grouping rather than one-way merge

**Weaknesses:**

- Free plan gutted/discontinued late 2025 with inconsistent official messaging — a market opening
- Data hosted only in US Central — a real problem for German/EU customers
- No enforced phase flow, no ready-check — facilitator can't tell when everyone finished writing
- Thin integrations (Jira plus one-directional Slack); poker paywalled at $49/mo
- Overwhelmingly positive G2/Capterra reviews with few substantive negatives suggest a curated review presence

### Scrumlr

**Positioning:** The German open-source benchmark: MIT-licensed, entirely free (no paid tier exists), registration-less with generated animal-name avatars, GDPR-compliant and hosted in Germany by inovex. Its trust-through-locality pitch is exactly Retropolis's target audience.

**Free tier / pricing:** Everything is free; no monetization. Self-hostable via Docker Compose/Kubernetes (Go + React).

**Session flow:** No phase state machine — the moderator drives implicit phases via toggles: "ShowNotesOfOtherUsers" off for the private write phase (with timer and a "mark me as done" ready-check), flip on for reveal, drag-stacking for grouping, then a configured voting session (vote limit, cumulative votes, hidden votes, anonymity) that auto-sorts columns by votes on close. Discussion uses a shared-note presenter mode that snaps every viewport to the card, with a "return to presentation" button. Exports to PDF/JSON/CSV/Markdown.

**Worth borrowing:**

- "Mark me as done" ready-check tied to the timer — moderator ends the write phase early instead of guessing
- Presenter mode via shared-note broadcast plus "return to presentation" button
- Anonymous-but-self-identifiable notes: authors hidden, own notes keep a subtle border
- QR-code join and generated animal names — zero-friction, playful onboarding
- Hidden columns revealed later — the mechanic for a surprise appreciation column
- The whole trust pitch: "hosted in Germany, GDPR, open source, no account"

**Weaknesses:**

- No action items at all — no owners, no carry-over; its biggest functional gap
- No comments, icebreakers, health checks, GIFs, sounds, or pickers
- No integrations, no API; history is device/browser-bound and long-term persistence is not guaranteed
- Thin documentation; unstacking/regrouping historically clunky
- Not listed on G2/Capterra; small maintainer team (~341 GitHub stars) — bus-factor and slow cadence risk

### Kollabe

**Positioning:** Agile meetings suite (retros + planning poker + standups) by a solo developer, founded 2023; leans on AI features, themed templates, and flat per-workspace pricing. Note: despite a reputation for "fun interactive pickers", no wheel-of-names/random-picker feature was found anywhere on kollabe.com, its changelog, or third-party reviews — engagement hooks are AI tools, icebreakers, and GIFs instead.

**Free tier / pricing:** Free: up to 10 members, 7-day history, "limited meetings per month" per the pricing page (marketing pages claim unlimited basic retros — messaging is inconsistent). Premium $29/month flat per workspace, not per seat.

**Session flow:** Brainstorm → group → vote → discuss → action items, with customizable phases and a phase timer. A hard "own notes only until reveal" write phase is not clearly documented — visibility is configurable rather than an explicit reveal moment. Since April 2026, retros can auto-advance to the next phase when every participant marks ready. Grouping combines manual clustering with the most-praised feature in its reviews: AI semantic grouping. Discussion runs in a synchronized presentation mode; closes with AI summary, sentiment analysis, and pushes to Jira/GitHub/Linear/Azure DevOps.

**Worth borrowing:**

- Ready-check auto-advance: the phase moves itself when everyone clicks ready — a complement to the admin's manual control
- AI semantic grouping (even a simple client-side similarity suggestion would differentiate — later, suggestions-only)
- Per-card anonymity: anonymous and attributed cards coexist in one session
- Synchronized presentation mode viewport
- Themed/pop-culture templates as low-cost playfulness

**Weaknesses:**

- No random picker despite playful positioning — the gap Retropolis's wheel fills
- No documented hard private-write phase; dot-voting reportedly not independently configurable
- No advertised SOC 2 / ISO 27001 / GDPR posture — a real concern for German/EU customers
- Solo-founder risk; retro module younger than the poker core; almost no third-party review footprint (independent score 5.5/10)
- Free tier's 7-day history is too short for retro follow-ups; free-tier messaging inconsistent

### retro.tools

**Positioning:** Radically minimal MIT-licensed open-source retro board: no accounts, no logins, no tracking — "a retro is just a URL". Single-maintainer hobby project (Svelte + Rust).

**Free tier / pricing:** 100% free, no known limits; self-hostable.

**Session flow:** Creator picks one of 5 templates (or imports a custom YAML template), optionally sets an icebreaker question and an encryption password, and shares via link or on-screen QR code. Phases emerge from four owner toggles in one dropdown: Obscure Cards (blur others' cards for the write phase), New Cards Allowed, Voting Allowed, Sort by Votes. Voting is unlimited "Agree" clicks with undo — no per-person budget. Closes with CSV export and optional board deletion.

**Worth borrowing:**

- Optional true end-to-end encryption via board password (server sees only ciphertext) — a killer German-privacy story on free hosting
- On-screen QR code for hybrid rooms
- Custom template as an importable/exportable YAML file — no server-side template store needed
- One icebreaker question field at board creation — near-zero cost, real warm-up value
- "Everyone is Admin" toggle — one switch instead of role-management UI

**Weaknesses:**

- No grouping/merging at all — duplicate stickies get discussed twice; criticized for it
- No ready-check, no presence, no action items, no per-person vote budget
- No history beyond a browser-local past-boards list; no integrations; CSV-only export
- Anyone with the URL can join and spam votes
- Single-maintainer project (~101 GitHub stars) — continuity risk

### Retrospected

**Positioning:** Long-running open-source retro board by a solo developer, notable for granular per-board voting configuration and a clean Markdown summary export. Anonymous or OAuth-authenticated use.

**Free tier / pricing:** Free Basic tier: unlimited retrospectives capped at 40 posts per board (the GitHub README mentions 50 — the cap has varied; verify). Pro $12.90/mo (unlimited posts, client-side encryption, private sessions); Self-Hosted license $599 one-time.

**Session flow:** One-click session creation with 1-5 custom columns and rich per-board options (max posts per user, up/down vs like votes, vote limits, self-voting, multi-votes, blur mode, moderator-only grouping). Blur mode hides others' posts during the write phase while participants flag themselves "Ready"; the moderator then disables blur, the team drag-groups cards into collapsible groups, votes with the configured rules, and sorts by votes. Closes with a Summary mode digest copyable as Markdown or rich text.

**Worth borrowing:**

- Ready-check during blur mode — directly solves the write-to-reveal transition
- Fine-grained voting config: per-user limits, self-voting toggle, multi-vote toggle, vote cancellation
- Collapsible card groups — the board stays tidy after merging
- Summary mode with copy-as-Markdown — cheaper than PDF export and pastes cleanly into Confluence/Slack
- Domain-based auto-upgrade (whole email domain gets Pro) — a clever B2B distribution mechanic

**Weaknesses:**

- Free tier's 40-post cap is easy to hit in one lively retro with 8+ people, forcing an upgrade mid-session
- Encryption and private sessions are paywalled — free boards are open to anyone with the link
- One-man project; GitHub issues show rate-limiting/DoS problems on the SocketIO layer
- Dated UI; no comments, icebreakers, health checks, or fun features
- No SOC 2 or formal GDPR program per TeamRetro's comparison page (marketing source, but plausible for a solo open-source project)
