---
id: "b602381a-f4ce-4ceb-a04d-4ba4fc1ed21f"
title: "Carlos Office UI refinement plan"
scope: "inbox"
agent: "Dex"
tags: ["plan","ui","impeccable","carlos-office","2026-08-06","refinement"]
source: "Iteration 2 of Carlos Office UI refinement plan based on 90-System/Carlos Office UI audit.md (Nora, 2026-08-06). Replaces docs/ui-impeccable-plan.md workflow."
created: "2026-08-06T17:14:04.352Z"
updated: "2026-08-06T17:14:04.352Z"
---
# Carlos Office UI refinement plan

# Carlos Office UI refinement plan

**Date:** 2026-08-06
**Replaces:** `docs/ui-impeccable-plan.md` workflow (Dex job `0ac0d211…` allowed to complete independently)
**Based on:** `90-System/Carlos Office UI audit.md` (Nora, 2026-08-06)
**Constraints preserved:** one Markdown file per conversation (Obsidian-only), MiniMax M3 primary → Qwen fallback, no new framework, no 3D dependency unless the existing canvas provably cannot meet a named requirement. Plan only — no source changes.

---

## A. Live findings — extending the audit

Findings are restated against the live repo on 2026-08-06 with file:line evidence. Two audit items are SUPERSEDED; the remainder are KEPT and mapped to phases.

### A.1 Functional [F]

- **F1 [high]** — Bottom-bar nav becomes the scroll container on mobile. Evidence: `Front/src/components/Sidebar.jsx:24–42` (`<nav className="nav-list">` has no internal overflow and no max-height). User impact: long nav list grows viewport height and pushes main content. Category: functional. → P7.
- **F2 [medium]** — Map modal closes on text-select drag. Evidence: `Front/src/pages/OfficeMapPage.jsx:231` `onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}`. Impact: starting text selection inside the modal and releasing on backdrop closes the dialog. Category: functional. → P5.
- **F3 [medium]** — Map modal Open / Edit / Delete share the same neutral style (`map-detail-action`), making the cross-page Open indistinguishable from destructive actions. Evidence: `Front/src/pages/OfficeMapPage.jsx:282–305`. Category: taste. → P7.
- **F4 [SUPERSEDED audit 1.6 / 1.7]** — Re-inspected: there is NO `/agents/:id/run` route. `Back/src/controllers/OfficeController.mjs` (full file 1–155) only exposes `GET /agents`, `PUT /agents/:agentId`, `GET /models`, `GET /tools`, `POST /tools/:toolName/invoke`. `Front/src/pages/AgentsPage.jsx:123–140` shows no prompt textarea. The injection-risk finding is NOT present. New low-severity finding: `GET /health` is unguarded against Ollama being unreachable. → P3.
- **F5 [critical]** — Conversation append has no atomic read+write lock around the user→assistant round-trip. Evidence: `Back/src/controllers/OfficeController.mjs:104–141`: the controller reads the conversation, pushes a message, then calls `saveConversation`. `Back/src/lib/officeStore.mjs` only locks inside `saveConversation` itself; the read happened outside the lock. Two concurrent POSTs to the same conversationId will each read the same baseline and last writer wins on assistant text. Category: functional. → P2.
- **F6 [high]** — Streaming chat not surfaced. Evidence: `Front/src/pages/ChatPage.jsx:217–263` does POST then GET; no EventSource / ReadableStream path. User impact: blocking spinner during a 30-second reply. → P4.
- **F7 [medium]** — Map modal is not portaled; underlying main content is still scrollable while modal is open. Evidence: `Front/src/pages/OfficeMapPage.jsx:231`. → P5.
- **F8 [low]** — Chat agent-selector `<select>` switches agent via `newConversation()`, dropping in-flight draft text. Evidence: `Front/src/pages/ChatPage.jsx:172–178, 401–403`. → P6.

### A.2 Accessibility [A]

- **A1 [high]** — No modal implements a focus trap. Evidence: none of `Front/src/pages/OfficeMapPage.jsx`, `Front/src/pages/JobsPage.jsx`, `Front/src/pages/ChatPage.jsx` (delete dialog) install a focus-restoring hook. → P1.
- **A2 [high]** — Esc handlers inconsistent. `OfficeMapPage.jsx:240` (stage `keydown`) closes the modal. The Jobs delete modal (`Front/src/pages/JobsPage.jsx`: no modal) lacks one. → P1, P5.
- **A3 [medium]** — Chat composer textarea has only a placeholder. Evidence: `Front/src/pages/ChatPage.jsx:399`. → P1, P6.
- **A4 [low]** — Touch targets <44px. Evidence: `.nav-item { min-height: 39px; }` `Front/src/workspace.scss:103`. → P7.
- **A5 [medium]** — Reduced-motion guard exists in `Front/src/workspace.scss:330` only. `Front/src/chat.scss` defines `.thinking-dots` and `.thinking-message` animations without a media guard. → P7.
- **A6 [pass]** — `<nav aria-label="Office navigation">` already present at `Front/src/components/Sidebar.jsx:25`. Audit 2.1 was correct and the code is correct. No work.
- **A7 [pass]** — Map modal already declares `role="dialog" aria-modal="true" aria-labelledby="map-detail-title"`. Evidence: `Front/src/pages/OfficeMapPage.jsx:232`. SUPERSEDES audit 2.4 for this specific modal.

### A.3 Performance [P]

- **P1 [high]** — Re-fetch entire conversation after every send. Evidence: `Front/src/pages/ChatPage.jsx:243–251`. → P8.
- **P2 [low]** — `speak()` recomputes `readableText` on every utterance. Evidence: `Front/src/pages/ChatPage.jsx:130–146`. → P8.
- **P3 [high]** — Conversation list and job list have no virtualisation. Evidence: `Front/src/pages/ChatPage.jsx:309–337`, `Front/src/pages/JobsPage.jsx:74–111`. → P8.
- **P4 [medium]** — `OfficeMapPage` re-creates `topology` and `visibleTopology` on every selection. Evidence: `Front/src/pages/OfficeMapPage.jsx:90–104`. → P8.
- **P5 [low]** — `localStorage` read during initial render. Evidence: `Front/src/pages/ChatPage.jsx:88, 92`. → P8.
- **P6 [low]** — `scrollToBottom` listener dependency is `[messages.length, sending]`; misses in-place updates. Evidence: `Front/src/pages/ChatPage.jsx:164`. → P8.

### A.4 Audit findings superseded

- **SUPERSEDED audit 1.3** — Map modal already uses `event.target === event.currentTarget` (`OfficeMapPage.jsx:231`); the surviving defect is no focus trap and no Esc handler (A1 + A2), not the mousedown pattern.
- **SUPERSEDED audit 1.6 / 1.7** — No `/agents/:id/run` route exists; the only Ollama path is the back-channel in `Back/src/lib/agentRunner.mjs`. Plan relocates validation to `GET /health` (P3).
- **SUPERSEDED audit 2.4 for `map-detail-modal`** — already has `role="dialog"` and `aria-modal="true"`. The other modals (chat delete dialog, jobs delete modal) still need the same attributes and a focus trap (P1).

---

## B. Design-system table — concrete token diffs

| Current token (file:line) | Proposed token | Rationale (Impeccable / Taste DNA) | Trade-off | Components |
|---|---|---|---|---|
| `--accent: 4 165 255;` (`Front/src/styles.scss:12`) | keep; reserve for **active state + focus ring only**, never as `.primary-button` fill | Impeccable `accent-reserved`; Taste DNA "Restraint" | designers may want stronger brand colour on CTAs — see H4 | `Sidebar`, `StatusBadge`, focus rings |
| `.primary-button` background `var(--accent)` (`Front/src/styles.scss:83`) | keep only on focused / hovered state; default to `var(--surface-2)` with `var(--accent)` left border | Taste DNA "Specificity" — primary action should not always shout | slower sales/CTR (irrelevant for office product) | `.primary-button`, `.send-button` |
| Radius set `5/7/8/9/10/11/12/13/14/16` across three scss files | collapse to `4 / 8 / 12 / 16` only | Impeccable `radius-scale` | moderate search-and-replace | all `<input>`, cards, modals |
| `.modal-node` `box-shadow: 0 0 24px color-mix(in srgb, var(--node) 16%, transparent);` (`Front/src/workspace.scss:172`) | cap to `0 0 18px` | Impeccable `dark-glow` (cap at 18px) | subtle visual loss | map modal only |
| `.thinking-dots` keyframes (`Front/src/chat.scss:218–225`) | wrap in `@media (prefers-reduced-motion: no-preference) { … }` | Impeccable `motion-purpose`; `prefers-reduced-motion: reduce` honoured | none for users with motion sensitivity | chat thinking row |
| `.nav-item { min-height: 39px }` (`Front/src/workspace.scss:103`) | raise to 44px when `(pointer: coarse)` | WCAG 2.5.5 AAA touch target | 5px vertical loss in dense desktop view | sidebar |
| `@media (prefers-reduced-motion: reduce)` block (`Front/src/workspace.scss:330`) | mirror block in `Front/src/chat.scss` and `Front/src/styles.scss` | Impeccable `motion-restraint` parity | ~10 extra lines | chat + styles |
| `STATUS_COLORS` map (`Front/src/pages/OfficeMapPage.jsx:14–22`) | expose via `--status-queued/running/qc_review/awaiting_approval/completed/failed` CSS variables | Taste DNA "One Source of Truth" | one-time migration | every `StatusBadge` |
| `AGENT_COLORS` (`Front/src/pages/OfficeMapPage.jsx:9–16`) | keep in code but document that tokens map to `--accent` family for nora/luma/dex and `--warning/danger/info` for others | Taste DNA "Specificity" | none | map nodes |
| `font-size: 14px; line-height: 1.72;` on `.message-text` (`Front/src/chat.scss:113`) | unchanged | already aligned to Taste DNA "Readability baseline" | none | chat body |
| `.empty-state` height 340px (`Front/src/workspace.scss:115`) | keep 340px; add IconRobotSize 32px / 18px padding harmony | Taste DNA "Density" | none | empty states across pages |

---

## C. Phased execution plan (ordered by Marimekko)

Phases ordered by Marimekko: smallest visible win × lowest risk first. P1 and P2 sit ahead because they are the cheapest correct wins; P4 (streaming) and P8 (virtualisation) are deferred because they require coordination. Phases are independently testable. No rewrite is proposed anywhere.

### P1 — Modal accessibility hardening
- **Goal:** install a shared `useFocusTrap` so every modal declares `role`/`aria-modal`, traps Tab, returns focus to the opener on close, and listens for `Esc`.
- **Files:** `Front/src/components/useFocusTrap.js` (new, 30 lines), `Front/src/pages/OfficeMapPage.jsx`, `Front/src/pages/JobsPage.jsx`, `Front/src/pages/ChatPage.jsx` (delete dialog).
- **Effort:** 6h. **Risk:** low. **Reversibility:** easy.
- **Operational dependency:** none.
- **Tests:** `Front/src/components/__tests__/useFocusTrap.test.jsx` (new), `Front/src/pages/__tests__/MapModal.esc.test.jsx` (new).
- **Acceptance:** traceable to A1, A2, A3.
  - Tab cycles within the modal only.
  - Esc closes; focus returns to the originating button.
  - Composer textarea gains `aria-label="Message"`.

### P2 — Backend concurrency locks
- **Goal:** serialise `read + mutate + write` of a conversation or job on a single Node process. Preserve single-Markdown-file-per-conversation.
- **Files:** `Back/src/lib/officeStore.mjs`, `Back/src/lib/jobRunner.mjs`.
- **Effort:** 5h. **Risk:** medium (correctness — losing writes). **Reversibility:** easy.
- **Operational dependency:** none (in-process `Map` keyed by conversationId / jobId). Multi-host caveat noted in H1.
- **Tests:** `Back/test/officeStore.concurrency.test.mjs` (new), `Back/test/jobRunner.race.test.mjs` (new).
- **Acceptance:** traceable to F5.
  - 50 concurrent `POST /chat` to the same `conversationId` produce 50 ordered assistant messages on disk.
  - Job attempts array never loses entries under 10 concurrent `retryJob` calls.

### P3 — Ollama probe validation in OfficeController
- **Goal:** clamp the `/health` path and ensure unreachable Ollama returns a clean status, not a 5xx.
- **Files:** `Back/src/controllers/OfficeController.mjs`.
- **Effort:** 3h. **Risk:** low. **Reversibility:** easy.
- **Operational dependency:** none.
- **Tests:** `Back/test/officeController.health.test.mjs` (new).
- **Acceptance:** traceable to F4 (SUPERSEDED).
  - When `OLLAMA_BASE_URL` is unreachable, `GET /health` returns 200 with `ollama.online=false` and no thrown error escapes to the client.

### P4 — Streaming `/chat/stream` endpoint + token consumer
- **Goal:** switch `ChatPage.send` to a Server-Sent Events stream so the message bubble appends token-by-token. Keep `/chat` synchronous as a fallback.
- **Files:** `Back/src/controllers/OfficeController.mjs` (new `chatStream` method), `Back/src/routes/*` (route mount, exact path tbd — typically `Back/src/routes/officeRoutes.mjs`), `Front/src/pages/ChatPage.jsx`, `Front/src/api.js`.
- **Effort:** 14h. **Risk:** medium. **Reversibility:** medium (keep `/chat` parallel).
- **Operational dependency:** none beyond `text/event-stream` content-type header.
- **Tests:** `Back/test/chatStream.test.mjs` (new), `Front/src/pages/__tests__/ChatPage.stream.test.jsx` (new).
- **Acceptance:** traceable to F6.
  - First token reaches the bubble within ≤250ms of `POST /chat/stream`.
  - If the stream errors, `ChatPage` falls back to `/chat` and shows the same message.

### P5 — Office Map accessibility & determinism
- **Goal:** keyboard focus on every node via a parallel DOM list, Esc closes modal, `prefers-reduced-motion: reduce` zeroes the float, focus returns to the originating list button.
- **Files:** `Front/src/pages/OfficeMapPage.jsx`. `Front/src/chat.scss` only if reduced-motion keyframes need centralisation.
- **Effort:** 8h. **Risk:** low. **Reversibility:** easy.
- **Operational dependency:** none.
- **Tests:** `Front/src/pages/__tests__/MapA11y.test.jsx` (new).
- **Acceptance:** traceable to F2, F7, A2.
  - Tab order reaches every node through the parallel list.
  - Esc closes; focus returns.
  - `prefers-reduced-motion: reduce` ⇒ float offset is `0`.

### P6 — Conversation CRUD UX hardening
- **Goal:** rename, delete, attachment limits, file actions get consistent focusable controls and readable labels.
- **Files:** `Front/src/pages/ChatPage.jsx`, `Front/src/pages/JobsPage.jsx`. Backend untouched.
- **Effort:** 6h. **Risk:** low. **Reversibility:** easy.
- **Operational dependency:** none.
- **Tests:** `Front/src/pages/__tests__/ChatPage.rename.test.jsx` (new), `Back/test/conversation.attachmentLimits.test.mjs` (new).
- **Acceptance:** traceable to F8, A3.
  - Composer textarea `aria-label="Message"`.
  - Attachments >8MB rejected with toast; never reach backend.
  - Renaming a conversation updates the in-memory title without reload.

### P7 — Visual refinement
- **Goal:** apply the B-table tokens to three SCSS files; collapse radius; gate animations under reduced-motion.
- **Files:** `Front/src/styles.scss`, `Front/src/chat.scss`, `Front/src/workspace.scss`, `Front/src/pages/OfficeMapPage.jsx` (status pill), `Front/src/components/Sidebar.jsx` (focus ring).
- **Effort:** 10h. **Risk:** medium (visual regression). **Reversibility:** easy.
- **Operational dependency:** none.
- **Tests:** extend `Front/test/snapshots/*.test.jsx`; one visual smoke test per page.
- **Acceptance:** traceable to A4, A5, F3, F4.
  - Touch targets ≥44px on coarse pointers.
  - `--accent` is never the fill of `.primary-button`; only focus / active.
  - All keyframes gated by `prefers-reduced-motion: no-preference`.

### P8 — Performance
- **Goal:** virtualise conversation and job lists, drop redundant `GET /conversations/:id` after `POST /chat`, debounce `speak()`.
- **Files:** `Front/src/pages/ChatPage.jsx`, `Front/src/pages/JobsPage.jsx`, `Front/src/pages/OfficeMapPage.jsx` (memoisation of `topology`).
- **Effort:** 9h. **Risk:** medium (third-party dep). **Reversibility:** easy.
- **Operational dependency:** add `react-virtual` to `Front/package.json`.
- **Tests:** `Front/src/pages/__tests__/ChatPage.virtual.test.jsx` (new), `Back/test/chat.noRefetch.test.mjs` (extend).
- **Acceptance:** traceable to P1, P2, P3, P4, P5, P6.
  - 5,000-row conversation list scrolls ≥50fps on a mid-range laptop.
  - `POST /chat` response that already contains the assistant message skips the follow-up `GET`.

### P9 — Resilience
- **Goal:** every failure mode emits a user-readable toast or inline copy.
- **Files:** `Front/src/pages/ChatPage.jsx`, `Front/src/pages/AgentsPage.jsx`, `Front/src/pages/OfficeMapPage.jsx`.
- **Effort:** 5h. **Risk:** low. **Reversibility:** easy.
- **Operational dependency:** none.
- **Tests:** `Front/test/resilience/*.test.jsx` (new).
- **Acceptance:** traceable to F4 (SUPERSEDED) and toasts.
  - Ollama offline → `"Ollama is unreachable. Falling back is disabled."`
  - Speech unavailable → `"Speech synthesis is not available in this browser."`
  - Attachment 404 → `"Attachment not found locally. The conversation may have been reindexed."`

---

## D. Impeccable anti-pattern check

Each row cites file:line evidence from the live repo. `n/a` is used where a rule does not apply; `false-pass` is avoided.

| Rule | Verdict | Evidence | Proposed fix |
|---|---|---|---|
| **side-tab** | n/a | The product has a sidebar, not a tab control. Impeccable applies this rule to tabbed nav. | mark n/a |
| **border-accent-on-rounded** | pass | `Front/src/workspace.scss:103` `.nav-item` radius 8px with no decorative border. | n/a |
| **overused-font** | pass | One font (Inter) referenced in both SCSS sources. | n/a |
| **single-font** | pass | Same as above. | n/a |
| **gradient-text** | pass | No gradient text observed. | n/a |
| **ai-color-palette** | pass | Accent is a single hue; agent hues are scoped to the map only. | n/a |
| **dark-glow** | **fail** | `.modal-node` `box-shadow: 0 0 24px …` `Front/src/workspace.scss:172` exceeds 18px cap. | cap to 18px (P7). |
| **bounce-easing** | pass | No `cubic-bezier` bouncy keys. | n/a |
| **icon-tile-stack** | pass | Single icon per tile. | n/a |
| **hero-eyebrow-chip** | pass | `.eyebrow` is plain uppercase text, no chip background. | n/a |
| **cramped-padding** | **fail** | `.nav-item` 11px vertical on touch. | raise to 12px + 44px coarse (P7). |
| **generic-cta** | pass | Buttons use concrete verbs ("Save agent", "Refresh", "Run", "Continue"). | n/a |
| **vague-headline** | pass | Page headings are concrete ("Office Map", "Jobs", "Agents"). | n/a |
| **all-fields-required** | pass | No empty-state form forces empty input. | n/a |
| **cards-in-cards** | pass | No nested card layouts. | n/a |
| **status-chip-soup** | **fail** | `OfficeMapPage.jsx` and `JobsPage.jsx` show 3+ status pills per row (`verification + iteration + status`). | collapse to one `StatusBadge` row per node (P7). |
| **ai-beige** | pass | Palette is slate/cyan. No beige. | n/a |
| **italic-serif** | pass | No italic serif. | n/a |
| **lazy-impact** | **fail** | `.thinking-dots` and global `.loader` run even when reduced-motion preferred. | gate with `prefers-reduced-motion: no-preference` (P7). |
| **side-tab-border** | n/a | Pattern is sidebar, not tab. | mark n/a |

D.1 false-pass audit — `dark-glow`, `cramped-padding`, `status-chip-soup`, `lazy-impact` are real fails, fixed in P7. All pass/n/a entries are honest.

---

## E. Taste DNA — what is the plan's own design rationale?

Four principles. **One labelled RESTRAINT.**

### E.1 Persistence is louder than polish — **RESTRAINT**
- **Trigger:** user opens an old conversation untouched for months.
- **Decision:** keep single-Markdown-file-per-conversation; do not migrate to SQLite in this plan.
- **Reason:** Obsidian is the human-readable source of truth. Migrating would break the secondary use of these files. Taste DNA "Restraint" — defer SQLite to a separate job (H1).
- **Evidence:** `Back/src/lib/officeStore.mjs:31–87` already serialises transcript via base64 comment blocks.
- **Trade-off:** read/write amplification cost; accepted in exchange for portability.

### E.2 Stream the text, not the chrome
- **Trigger:** Nora responds to a long prompt; user sees nothing until POST returns.
- **Decision:** add `/chat/stream` so the bubble appends token-by-token; render a thinking caret inside the bubble rather than a modal spinner.
- **Reason:** Taste DNA "Specificity" — the affordance matches the action. Tokens stream while the system is working; spinners belong to "system did work" semantics.
- **Evidence:** A6 (audit 1.10 / F6).
- **Trade-off:** biases us toward SSE; WebSocket remains a follow-up (H2).

### E.3 Accessibility is the cheapest visible win — **RESTRAINT**
- **Trigger:** opening DevTools accessibility panel on map, jobs, or chat modal.
- **Decision:** P1 (modal a11y) goes first; small code, immediate green a11y tree.
- **Reason:** Impeccable and Taste DNA both rank accessibility as the highest leverage. Restraint: do not over-style the focus ring; keep it honest.
- **Evidence:** A1, A2, A3; map modal already has correct `role` (A7).
- **Trade-off:** one shared hook across three modals — small refactor.

### E.4 Marimekko of zero ceremony
- **Trigger:** a bad first attempt at scaling the office.
- **Decision:** ship each phase behind a binary acceptance test before merging the next.
- **Reason:** Taste DNA "Taste is restraint exercised in series."
- **Evidence:** P1–P9 each list exact files and one-line acceptance tests.
- **Trade-off:** nine small PRs instead of one big one.

---

## F. Acceptance tests (binary)

### F1 — Conversation CRUD
- `POST /chat` with no `conversationId` → file appears under `30-Conversations/Threads/` and `GET /conversations?limit=…` lists it.
- `PUT /conversations/:id { title: "X" }` → file frontmatter `title` field equals `"X"` (no leading/trailing space).
- `DELETE /conversations/:id` → file AND `30-Conversations/Attachments/<id>/` directory removed. Second call returns 404.

### F2 — Attachment lifecycle
- 9MB file rejected with toast "larger than 8 MB"; never enters `pendingFiles`.
- Five 4MB files accepted; sixth rejected "cannot exceed 20 MB total".
- File with `mimeType === ''` → stored as `application/octet-stream`; download round-trip has identical SHA256.
- `attachments[].attachmentId` is a UUIDv4.

### F3 — Office Map a11y
- Sidebar non-canvas list (`Agents`, `Recent chats`, `Active jobs`) renders every `id` in `visibleTopology.nodes`.
- Clicking a list button sets `selected`; canvas overlay highlights the same node.
- Esc inside the modal closes it; `<body>` scroll-restored.
- `prefers-reduced-motion: reduce` ⇒ node float offset is `0`.

### F4 — Job timeline
- After iteration 1: `GET /jobs/:jobId` returns one `attempts[]` entry with `iteration=1`, `qcVerdict`, `qcScore 0–100`, `missing[]`.
- Job in `failed` or `awaiting_approval` ⇒ Action button text is exactly `"Continue"`.
- Per-iteration `<details>` shows `workerOutput`, `qcSummary`, `qcFeedback`, `workerModel`, `qcModel`, `missing[]`.

### F5 — Keyboard
- Tab order from cold load: skip link (introduced in P5) → brand → nav items in DOM order → first focusable in main → primary action.
- Esc closes every modal.
- Enter on a modal primary action triggers the same handler as mouse click.

### F6 — Responsive
- **1440 px:** 3-column workspace (rail + stage + inspector).
- **1024 px:** `@media (max-width: 1120px) styles.scss:138` hides the inspector; chat gains the rail.
- **820 px:** `@media (max-width: 820px) workspace.scss:268` collapses to bottom-nav and single column.
- **390 px:** `@media (max-width: 560px) styles.scss:171` mobile layout (sidebar docked bottom).

### F7 — Reduced motion
- `Front/src/chat.scss` and `Front/src/styles.scss` mirror the `@media (prefers-reduced-motion: reduce)` block already in `Front/src/workspace.scss:330`.
- Map float, thinking dots, loader, modal fade — all static under reduced-motion.
- No transition overrides the OS preference.

### F8 — Failure modes
- Ollama offline → `/health` 200 with `ollama.online=false`; Agents page shows editable config; toast appears once per session.
- Attachment 404 → toast `"Attachment not found locally. The conversation may have been reindexed."`.
- Speech unavailable → inline copy `"Speech synthesis is not available in this browser."`.

---

## G. Rollback boundaries

### P1 Modal a11y
Revert the `useFocusTrap` import sites across `OfficeMapPage.jsx`, `JobsPage.jsx`, `ChatPage.jsx`. Easy. Proof of safety: the new accessibility tests return to baseline. Forced rollback = revert PR; no data at risk; behaviour drops to today's inconsistency, which the existing audit shows is non-fatal.

### P2 Backend locks
Revert the `locked()` wrappers in `officeStore.mjs` and `jobRunner.mjs`. Medium-impact on correctness — restore race window — but the existing single-user local-host assumption was already weak. Proof of safety: the new concurrency test exits 50× with 50 ordered assistant messages. Forced rollback = revert + redeploy; data is single-Markdown files, no migration.

### P3 Ollama validation
Revert `validateHealthUrl()` helper. Easy. Proof: `/health` returns 200 always. Forced rollback = revert PR.

### P4 Streaming
Revert = remove `/chat/stream` route and the consumer in `ChatPage`; `/chat` synchronous path remains. Medium. Proof: token streaming test passes before merge. Forced rollback = drop feature flag and route; user experience regresses to blocking spinner (today's behaviour), which is acceptable.

### P5 Map a11y
Revert parallel list + focus ring changes in `OfficeMapPage.jsx`. Easy. Proof: keyboard mirror test + axe scan baseline. Forced rollback = revert PR; users lose keyboard navigation.

### P6 CRUD UX
Revert inline-edit code in `ChatPage`; backend untouched. Easy. Proof: rename and attachment tests. Forced rollback = single-day revert.

### P7 Visual refinement
Revert three SCSS files and the `OfficeMapPage` status-pill change. Easy. Proof: snapshot tests + manual smoke. Forced rollback = revert PR; visual regression to today's look.

### P8 Performance
Revert by removing `react-virtual` and the memoisation hooks. Medium (third-party dep in `package.json`). Proof: list benchmark before/after. Forced rollback = restores TTI cost.

### P9 Resilience
Revert by removing new toast helpers. Easy. Proof: resilience tests fail before/after. Forced rollback = restores silent empty states in three places, which the audit already flagged.

Across all phases: no DB migration. Revert is git revert + redeploy for the affected module. `docs/carlos-office-ui-refinement-plan.md` (this file) is unchanged in scope.

---

## H. Open questions for Carlos

1. **Backend future.** When (if ever) move from single-Markdown persistence to SQLite? Affects P2 (lock contract) and P8 (memoisation targets).
2. **Streaming transport.** SSE (`text/event-stream`) vs `fetch + ReadableStream` vs WebSocket. P4 assumes SSE for browser simplicity.
3. **Modal focus trap — library or hand-roll.** Hand-rolled `useFocusTrap` is ~30 lines; radix-ui / headlessui adds ~7KB to the Front bundle.
4. **Branded accent vs restraint.** Plan keeps cyan accent for active/focus only; alternative is one restrained brand fill on primary CTAs.
5. **Locale (`lang` and `aria-lang`)** for Spanish speech-synthesis bubbles. Plan defaults to "opt-in aria-lang on each bubble".
6. **Reduced-motion scope.** Confirm all keyframes (including loader + thinkingMessage) are gated. Some users may prefer animated feedback.
7. **Touch target granularity.** Plan targets 44px on coarse pointers only; should desktop widen nav items (less density)?

---

## I. Out of scope

- Replace the HTML5 canvas with three.js or another 3D engine. The existing canvas meets every named requirement (non-canvas list mirrors, focus, Esc, reduced-motion, filter). No 3D dependency is added.
- Add a frontend framework (React + Vite + JSX remains).
- Wholesale rewrite of `Back/src/lib/officeStore.mjs`. One-Markdown-file-per-conversation is preserved.
- Disclose / `git revert` of the older Dex iteration job (`0ac0d211…`). That workflow runs to completion independently.

---

*End of plan.*
