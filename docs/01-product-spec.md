# Retropolis — Product Specification

Status: draft v1 · 2026-07-17 · based on competitive/platform research verified July 2026 (see `03-competitive-analysis.md`)

## 1. Vision

Retropolis is a **guided, playful, genuinely free** retrospective tool for teams. One facilitator steps the whole room through a clear phase flow; participants write in private, present in a random order picked by a wheel of fortune, vote blind, and end on appreciation. Clean and minimal to look at, with moments of deliberate delight (the spin, the reveal, the confetti).

**Positioning — the empty quadrant.** Research across 11 competitors shows the market splits into _guided-but-utilitarian_ tools (Parabol, Retrium, Neatro — repeatedly criticized as joyless) and _playful-but-unguided_ ones (Metro Retro/Spreo — fun, but novices get lost without a phase flow). Nobody occupies **guided + playful**. On top of that, the market has retreated from free (Retrium/TeamRetro/Spreo are trial-only; EasyRetro is down to 1 board/month), and no mainstream tool offers German UI or EU data residency. Retropolis takes all three: guided **and** playful **and** free, hosted in the EU with a German/English UI.

**Unique features no competitor has (verified July 2026):**

- A random presenter picker with **"everyone presents once" rotation tracking** — zero tools track who already presented; only Spreo has any picker at all (a generic spinner gadget).
- An **appreciation/kudos closing phase** — essentially absent everywhere (TeamRetro has kudos only as a comment type).
- Admin-configured **top-N voted highlight** for discussion — only TeamRetro has anything comparable.

## 2. Users & roles

| Role                    | How they get it                                                                                                                 | Capabilities                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Facilitator (admin)** | Creates the board; receives a private admin link (capability URL). Can promote any participant to co-facilitator; can hand off. | Advance/rewind phases, start/pause/extend timer, configure voting, spin the picker, reveal notes/columns, manage participants, export, delete board. |
| **Participant**         | Opens the share link (or scans the QR code shown next to it), types a display name. No account, no e-mail.                      | Write/edit/delete own notes, react, vote, mark "I'm done", present when picked.                                                                      |

No user accounts in v1 (decided). Identity per board = self-chosen display name + server-assigned color + a session token in localStorage so a refresh keeps your notes yours. **Facilitator handoff is MVP** — the session must survive the admin's dropped connection (Retrium's lack of this dominated its negative reviews).

## 3. The session flow (phase state machine)

The facilitator steps through phases with **one big "next phase" button**. Every phase has a preset, editable timer. Optional **auto-advance** when everyone has pressed "I'm done" (freshest competitor pattern, Kollabe 2026). Server owns the phase state; illegal transitions are rejected.

Default flow (60-min defaults, phases marked _(opt)_ are skippable per board):

| #   | Phase                          | Default time | What happens                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Check-in** _(opt)_           | 5 min        | Random icebreaker question from the built-in bank (GIF answers encouraged). Prime Directive shown as dismissible splash.                                                                                                                                                                                                                          |
| 2   | **Review actions** _(opt, v2)_ | 5 min        | Open action items from the team's last retro are shown first — the single biggest driver of retro value per facilitation research.                                                                                                                                                                                                                |
| 3   | **Write**                      | 15 min       | Private writing. Each participant sees **only their own notes**. Others appear as ghost cards ("Anna is writing in _Went well_") — activity visible, content never. Ready-check: "I'm done" ✓ per participant.                                                                                                                                    |
| 4   | **Present & group**            | 15 min       | Notes revealed (all at once, or column by column). The **picker** (wheel/lotto) chooses who presents next, excluding everyone who already presented, until the pool is empty → small celebration. The picked person's notes get spotlighted on every screen (synced presenter focus). Duplicate cards are merged by drag-to-stack (with unmerge). |
| 5   | **Vote**                       | 3 min        | Blind dot-voting (see §6). Ready-check + admin progress meter.                                                                                                                                                                                                                                                                                    |
| 6   | **Discuss**                    | 15 min       | Voting closes → cards auto-sort by votes → the **top N** (admin-configured) are visually crowned and walked one at a time. Action items with an owner are captured.                                                                                                                                                                               |
| 7   | **Close**                      | 5 min        | **Appreciation wall** revealed (see §7) and read aloud. Optional anonymous ROTI poll (v2). Board archives; export offered.                                                                                                                                                                                                                        |

Timer behavior: visible to all, color warning near the end, optional sound, pause / +1 min extension. Timeouts are **soft** — a signal, never an input lock (TeamRetro pattern; locking is the top facilitation complaint elsewhere).

## 4. Boards & templates

- **6 launch templates** (curated beats EasyRetro's 200 — nobody praises the pile): Went Well / To Improve / Action Items · Start / Stop / Continue · Mad / Sad / Glad · 4Ls · Sailboat (the flagship playful one) · Starfish. Each template card in the picker carries a one-line _"when to use this"_ — directly serves "easy to understand".
- **Custom columns** always: rename, recolor, reorder, add, remove.
- Optional **appreciation section** can be attached to any template (see §7).
- Board options at creation (all changeable later): anonymity (hide authors — off by default per decision, one toggle away), GIFs on/off, votes per person, top-N count, retention.
- Second wave (v1.x/v2): KALM, DAKI, Hot Air Balloon, Rose/Bud/Thorn, Plus/Delta; Lean Coffee and Team Health Check as **distinct board types** (they need different mechanics), v2.

## 5. Notes, presence & privacy model

- **Sticky notes**: text (with emoji), optional GIF, author chip (unless anonymous board), emoji reactions (fixed row 👍 ❤️ 😂 🎉 👀 + "more" opens the full picker — Slack/GitHub pattern).
- **Private-until-reveal is server-side**: during the write phase the server never sends other people's note content down the wire — not hidden by CSS, _absent from the payload_, including in join/reconnect snapshots (the classic leak path). This is also a works-council selling point: anti-surveillance by design.
- **Presence** ("see where colleagues are adding notes"): participant roster with status, plus **ghost cards** — skeleton shimmer cards in the column where someone is typing, carrying no content and no true length signal. This delivers the requested "see where colleagues are writing" _better_ than pixel cursors, which (a) would leak what someone is writing about during the private phase, (b) are the #1 free-tier cost driver (see architecture doc). Figma-style pixel cursors are a v2 flag, active only in grouping/discussion phases, throttled to 3–4 Hz.
- Grouping: drag a card onto another to stack; stacks show a count badge; unstack via the stack's menu; votes attach to the stack.

## 6. Voting

- Admin configures **votes per person** (default 3; heuristic hint in UI: ~√(number of cards)) and optionally **max votes per card**.
- **Blind by design** (no free competitor combines all three): vote counts hidden during voting · uniform dot rendering (no colors betraying who voted) · admin sees only an anonymous progress meter ("7/9 have used all votes").
- Voting closes → server computes tallies + **top N** → cards crowned, discussion queue walks them one at a time. Votes are rejected server-side when over budget or out of phase.

## 7. Appreciation wall ("thank you" section)

Optional final section, hidden until the Close phase (staged reveal — the surprise finale):

- Cards are **addressed to a named teammate**, with Management-3.0-style card types (Thank You · Great Job · Well Done · Congratulations · Totally Awesome) + free text + GIF/emoji.
- Optionally anonymous senders. Read aloud in Close. Included in the export.
- v2: per-person kudos history across a team's boards.

## 8. Pickers ("who presents next")

One shared abstraction, three skins (see architecture doc §6 for the sync protocol):

1. **Wheel of Fortune (MVP)** — equal segments per remaining participant, 4–6 s ease-out spin with per-segment tick, pointer-flapper overshoot, confetti + big winner card on stop, frozen ~2 s.
2. **Slot machine (v1.x)** — hand-rolled reels; better than a wheel for long name lists.
3. **Lotto ball machine (v2)** — matter-js cosmetic tumbling, scripted draw.

Rules: winner is drawn **server-side with `crypto.getRandomValues()` before the animation starts** (decide first, animate second — the wheelofnames.com fairness model; a one-line "how picks work" note builds trust). Winner auto-moves from pool to a visible ordered **pick history** (doubles as meeting progress). Admin controls: re-spin, skip/defer, remove person, add latecomer, manual pick. No engineered near-misses — organic deceleration only. Everyone watches the _same_ animation land on the _same_ name.

**Accessibility**: `prefers-reduced-motion` → instant crossfade to the winner from the same server payload; `aria-live="polite"` announces "Ana presents next, 4 remaining"; the textual pick history is the accessible source of truth (canvas is invisible to screen readers); sounds off by default.

## 9. GIFs & emoji

- **GIF search: KLIPY** (the post-Tenor industry default — Discord, WhatsApp, Figma migrated to it; free lifetime production key). Tenor's API was shut down June 30, 2026; GIPHY's free production tier no longer exists. All searches go **through our Worker proxy** (key secrecy, employee IPs/search terms never reach the US operator, `rating=g|pg` enforced server-side, cached). Required KLIPY attribution shown in the picker. **Per-board GIF toggle** for privacy-strict teams. Provider isolated behind one module — GIFs are a degradable feature.
- **Emoji: native Unicode** (zero bytes, zero third-party requests). Picker: `emoji-picker-element` (~12.5 kB, framework-agnostic, built-in German i18n, IndexedDB-cached) with **self-hosted emoji data** (default CDN would be a GDPR leak). _Note: this deviates from the stack panel's emoji-mart suggestion — the dedicated emoji/GDPR research showed emoji-picker-element is smaller, self-hostable, and ships German search data; emoji-mart stays the fallback if the web-component wrapper fights React._

## 10. Persistence, retention & export

- Boards persist under their stable URL, readable (archived, read-only) after Close.
- **Retention (decided)**: boards auto-delete after 90 days (per-board override: keep/extend/delete-now). The board's own alarm does the cleanup — see architecture doc.
- **Export**: Markdown (paste-ready for Confluence/Slack) + CSV + JSON in v1; includes columns, notes, groups, vote counts, top-N, action items, kudos; **author names excluded by default** (opt-in). PDF snapshot v2. Export-then-purge is the promoted workflow ("keep the best notes, let the personal data die").

## 11. i18n & language (decided)

German + English from day one. All strings externalized; language auto-detected, switchable in the header; icebreaker question bank maintained in both languages. Template names keep their established English names in both locales (retro jargon), with German descriptions.

## 12. UI/UX principles

1. **One primary action per screen per role.** The facilitator's is the big "next phase" button; the participant's is the phase's core verb (write / vote / present). Everything else recedes.
2. **A phase stepper is always visible** — everyone knows where in the retro they are and what comes next. This is the single biggest complaint-fixer vs. EasyRetro/GoRetro's settings-toggle chaos.
3. **Clean, minimal surface; playfulness in moments, not decoration.** Generous whitespace, calm neutral palette with one accent, sticky notes as the only colorful element. Delight is reserved for events: the reveal stagger, the wheel, confetti when the pool empties. No mascots, no clutter. (Skip list: whiteboard shapes, drawing tools, 30k icon libraries.)
4. **Zero-friction entry**: share link or QR code → type a name → you're in. Under 10 seconds.
5. **Motion respects `prefers-reduced-motion` everywhere**; sounds off by default (open offices, calls).
6. **Explain in place**: template "when to use" one-liners, vote-count heuristic hint, "how picks work" fairness note. No manual.
7. Responsive web; no native apps (no competitor has them either).

## 13. Feature cut lines

**MVP (v1.0):** board create/join via link + QR · 6 templates + custom columns · phase machine with timer (pause/+1 min/sound) · private write with ghost cards + roster presence · ready-check · reveal (all/per-column) · presenting via wheel + rotation tracking + synced presenter focus · drag grouping with unmerge · blind voting + top-N crowning · action items (per board) · appreciation wall · emoji reactions + picker · GIFs via KLIPY proxy + per-board toggle · anonymity toggle · facilitator handoff · Markdown/CSV/JSON export · DE+EN · 90-day auto-delete · reduced-motion + aria-live a11y.

**v1.x:** slot machine skin · icebreaker question bank (~100 questions DE/EN) + weather-report check-in · hidden/staged columns as a general feature · working-agreements pinned card · board duplication.

**v2:** team spaces (named team → action-item carry-over into next retro, kudos history, board list) · ROTI closing poll with trend · Lean Coffee + Team Health Check board types · lotto machine · pixel cursors in group/discuss phases · PDF export · multi-round voting · parking lot · safety check (anonymous 1–5).

**Later:** AI grouping suggestions (suggest-only, never auto-apply) + AI summary · Jira/Slack push · async mode · E2E encryption option · template import/export.

**Never (deliberate skips, see analysis doc):** planning poker/standup suite · infinite freeform canvas · 200-template pile · autonomous auto-grouping · enterprise SSO/SCIM/SOC2 · built-in video chat · cross-board analytics dashboards · native mobile apps.

## 14. Naming & domain

`retropolis.de` is **taken** (checked via DENIC RDAP 2026-07-17). Available candidates checked the same day: **`getretropolis.de`** (recommended), `retropolis-app.de`, `retropolis24.de`. Notable taken names: retroboard/retrospace/retrozone/sprintretro/retrohub/retrolab/retroraum/retroplatz.de. One .de domain will be registered (constraint); recommendation: **getretropolis.de** unless a rename is preferred — decide before launch, nothing in the codebase depends on it.
