# Retropolis — Privacy, GDPR & Works Council Playbook

Status: draft v1 · 2026-07-17 · research verified July 2026. This is engineering guidance plus a rollout playbook, **not legal advice** — have the DPO/legal review before launch.

## 1. Why this document exists

Retropolis is an employee-feedback tool for a German company. Two legal frames apply beyond ordinary GDPR hygiene:

- **§87(1) Nr. 6 BetrVG (works council co-determination):** applies to any technical system _objectively capable_ of monitoring employee behavior or performance — capability alone suffices, no monitoring intent needed (settled BAG case law). A tool with live presence, per-person notes, timestamps and vote logs is squarely capable. **Consequence: involve the Betriebsrat before rollout** and target a works agreement (Betriebsvereinbarung). Plan this during development (M1), not at launch. Once introduced with consent, later content changes (new templates etc.) are generally not separately co-determined.
- **GDPR legal basis:** for a voluntarily used team tool, §26 BDSG / Art. 6(1)(f) GDPR (legitimate interest + genuine voluntariness + works agreement). Employee _consent_ is problematic in employment contexts due to power imbalance — don't build the compliance story on it.

## 2. Privacy by design — decisions already in the architecture

These aren't bolt-ons; they're why the works-council conversation should be easy:

| Design decision                                                                       | Privacy effect                                                   |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| No accounts; join via link + self-chosen display name (pseudonyms fine)               | Minimal personal data; no e-mail addresses, no directory         |
| Private write phase enforced **server-side** (others' notes never sent over the wire) | Anti-surveillance by design — a selling point, frame it that way |
| No admin superpowers over content: the facilitator sees exactly what the team sees    | No hidden "who wrote what" view                                  |
| Ghost cards carry no content and no true length signal                                | Activity visible, behavior not measurable                        |
| Blind voting; admin sees only an anonymous progress count                             | No vote attribution                                              |
| Per-board anonymity toggle (strips `authorId` from all payloads permanently)          | Optional full anonymity for sensitive retros                     |
| No per-user analytics, no tracking SDKs, no IP logging in the app                     | Nothing to co-determine about evaluation                         |
| Exports exclude author names by default                                               | The keepable artifact is depersonalized                          |
| EU jurisdiction Durable Objects (decided)                                             | Board data stored & processed in EU data centers                 |
| 90-day auto-delete + facilitator delete-now + export-then-purge flow (decided)        | Short-lived data; the Löschkonzept writes itself                 |

## 3. Data inventory (what exists, where, how long)

| Data                                         | Where                          | Lifetime                                     |
| -------------------------------------------- | ------------------------------ | -------------------------------------------- |
| Display name, assigned color, role           | Board DO (EU)                  | Until board deletion (≤90 days default)      |
| Notes, reactions, votes, action items, kudos | Board DO (EU)                  | Same                                         |
| Session token                                | Participant's localStorage     | Local only                                   |
| GIF search terms                             | Worker (transit only, proxied) | Not stored; never reaches KLIPY with user IP |
| GIF media loads                              | KLIPY CDN (US)                 | Viewer IPs visible to CDN — see §4           |
| Application logs                             | None by design                 | —                                            |

## 4. Third parties / sub-processors

- **Cloudflare, Inc. (US):** hosting. EU jurisdiction DOs pin board data to EU data centers, but: full network-level residency is an Enterprise product (TLS still terminates at the nearest edge), and Cloudflare remains subject to the US CLOUD Act regardless of storage location. **Name this openly** in the DPIA/works agreement; the compensating measures are the standard post-Schrems-II set — EU-US Data Privacy Framework/SCCs, plus the fact that the data is low-sensitivity, minimized and short-lived. Normal, defensible practice for internal tooling; hiding it would be worse than stating it.
- **Kikliko, Inc. / KLIPY (US):** GIF search. Their privacy policy states they collect IP addresses and search history from API requests. Mitigations shipped: all search calls proxied through our Worker (KLIPY sees only the Worker's egress IP), no real `customer_id` ever sent, `rating=g|pg` forced server-side. Residual: GIF _media_ loads from their CDN expose viewer IPs — disclosed in the privacy notice; per-board GIF toggle lets strict teams disable the feature entirely; R2 media caching is the v2 hardening if the works council asks.
- **Nothing else.** Emoji data self-hosted; no fonts/CDNs/analytics from third parties.

## 5. Rollout checklist

1. During M1: informal Betriebsrat heads-up + demo of the private write phase and this document.
2. Draft works agreement covering: purpose (team retrospectives, no performance evaluation), data inventory (§3), retention (90 days), voluntariness, anonymity option, sub-processors (§4).
3. One-page **Löschkonzept**: default 90-day auto-delete, facilitator delete-now, export-then-purge, no backups outside the DO.
4. In-app privacy notice (DE/EN), linked from the join page: what's stored, where, how long, sub-processors, the GIF-CDN caveat.
5. DPO review of DPIA-lite + this doc.
6. Launch note to teams: emphasize "your drafts never leave your browser's session until you submit; nobody — including admins — can read others' notes before reveal."
