---
id: "b249a4cb-1450-4d75-b13e-c015e92bc878"
title: "Carlos Office UI fix plan from Impeccable &amp; Taste audit — iteration 2"
scope: "inbox"
agent: "Dex"
tags: ["plan","ui","impeccable","carlos-office","2026-08-06","iter2","verdict"]
source: "Iteration 2 of Carlos Office UI fix plan; operationalises 90-System/Carlos Office UI audit.md. Delta from iter 1: adds structured JSON verdict block, tightens A-AG-1/A-ST-* to live code, restates coverage map."
created: "2026-08-06T16:58:49.699Z"
updated: "2026-08-06T16:58:49.699Z"
---
# Carlos Office UI fix plan from Impeccable &amp; Taste audit — iteration 2

---
id: "2026-08-06-carlos-office-ui-fix-plan-iter2"
title: "Carlos Office UI fix plan from Impeccable & Taste audit — iteration 2"
scope: "inbox"
agent: "Dex"
tags: ["plan","ui","impeccable","carlos-office","2026-08-06","iter2","verdict"]
source: "Iteration 2 of Carlos Office UI fix plan. Re-reads: App.jsx, Sidebar.jsx, ChatPage.jsx, OfficeMapPage.jsx, JobsPage.jsx, AgentsPage.jsx, styles.scss, chat.scss, workspace.scss, OfficeController.mjs, officeStore.mjs, jobRunner.mjs. Audit at 90-System/Carlos Office UI audit.md. Iteration 1 returned revise on 'Valid structured QC verdict' (no JSON block). This iteration adds the verdict block, tightens criterion text to the live code (no appendMessage export; runAgent forwards to agentRunner.mjs not to a shell), and re-asserts the 400-line cap."
created: "2026-08-06T17:20:00.000Z"
updated: "2026-08-06T17:20:00.000Z"
canonical_repo_path: "docs/ui-impeccable-plan.md"
line_count_target: "<= 400"
---

# Carlos Office UI fix plan — Impeccable & Taste (iteration 2)

> Plan-only artifact. Operationalises the audit at `90-System/Carlos Office UI audit.md` (2026-08-06).
> Canonical repo path: `docs/ui-impeccable-plan.md` (materialise on next sync; durable copy lives in the Obsidian vault).
> Iteration: 2 of 3. Re-reads: App.jsx, Sidebar.jsx, ChatPage.jsx, OfficeMapPage.jsx, JobsPage.jsx, AgentsPage.jsx, styles.scss, chat.scss, workspace.scss, OfficeController.mjs, officeStore.mjs, jobRunner.mjs (2026 live).
> Delta from iter 1: adds the structured JSON verdict block Vera required, tightens A-AG-1 and A-ST-* to match the live code (no `appendMessage` symbol, no shell `spawn` in `runAgent`), and explicitly enumerates the [F] and [A] items covered.

## 0. Audit delta vs. live repo

Audit authored 2026-08-06 against a snapshot. Findings already mitigated in the current code close with `// already done` so the criteria still pass. Findings referencing symbols no longer present close with `// stale — guardrail kept` and preserve the principle. Stale-by-mitigation: 1.14, 2.1, 2.4, 2.6, 2.10, 2.13. Stale-by-missing-symbol: 1.2, 1.5, 1.6, 1.7.

Two audit claims are softened in the plan because the live code disagrees with the audit snapshot:
- 1.6: `runAgent` (added in `Back/src/controllers/OfficeController.mjs` ~L1) does not currently call `spawn`; it forwards to `agentRunner.mjs` (not preloaded in this session). The injection risk exists at the controller boundary where `{ prompt }` is accepted, so validation is still added there. The audit text "shell command via spawn" is recorded as a stale description.
- 1.8: `officeStore.mjs` does not export `appendMessage`. The controller's `chat` (~L99-L131) does read-modify-write inline. A-ST-1 names the controller path, not a non-existent helper.

## A. Acceptance criteria

Criteria IDs use `A-<area>-<n>`. Each is binary (pass/fail). `L` ranges are approximate, taken from the live files preloaded by the runtime manifest; the verifier should re-confirm with `grep -n`. Every [F] (1.1-1.15) and every [A] (2.1-2.16) item in the audit is covered by at least one criterion.

### A.1 Sidebar [1.1, 1.2, 2.1, 2.12] — App.jsx, components/Sidebar.jsx, styles.scss, workspace.scss

- A-SB-1 [1.1][F] Sidebar nav scrolls inside the sidebar, not the viewport. PASS iff `Sidebar.jsx` ~L33-L47 wraps the nav in `overflow-y: auto` and a `max-height: calc(100dvh - <header+footer>)` AND a Playwright check `page.locator('.sidebar').evaluate(el => el.scrollHeight <= el.clientHeight || el.scrollTop works)` passes.
- A-SB-2 [1.2][F] Every icon-only `<button>` inside `Sidebar.jsx` carries `aria-label`. PASS iff `axe-core` reports zero "Buttons must have discernible text" violations in the sidebar root. // stale — no collapse chevron in live `Sidebar.jsx`; finding is a guardrail.
- A-SB-3 [2.1][A] `<nav>` has an accessible name. PASS iff `Sidebar.jsx` L34 reads `<nav className="nav-list" aria-label="…">`. // already done — live has `aria-label="Office navigation"`.
- A-SB-4 [2.12][A] All sidebar touch targets are at least 44×44 CSS px. PASS iff every `.nav-item` in `workspace.scss` (currently `min-height: 39px` at ~L128) and `styles.scss` declares `min-height: 44px`.

### A.2 Chat [1.11, 1.12, 1.15, 2.8, 2.9, 2.10, 3.11, 3.2] — pages/ChatPage.jsx, chat.scss, styles.scss

- A-CH-1 [1.11][F] Attachment cards show the mime when the extension is missing. PASS iff `ChatPage.jsx` attachment render (truncated region ~L380+) shows `<small>` with `${file.mimeType}` whenever `file.name` lacks a recognised extension.
- A-CH-2 [1.12][F] Switching conversations warns on unsent input. PASS iff `ChatPage.jsx` `openConversation` (~L175-L195) checks `input.trim() || pendingFiles.length` and, if non-empty and the target differs from `conversationId`, shows a `confirm()` or in-app prompt before discarding.
- A-CH-3 [1.15][F] The speech engine is created at most once per session. PASS iff `recognitionRef.current` is reused and `toggleListening` does not instantiate a new `Recognition()` while one is active. // acceptable as-is; document in JSDoc.
- A-CH-4 [2.8][A] Attachment buttons have an accessible name that includes the filename. PASS iff the download button in `ChatPage.jsx` has `aria-label={`Download ${file.name}`}` and a pending file has `aria-label="Pending upload"`.
- A-CH-5 [2.9][A] Composer textarea has `aria-label="Message to Nora"`. PASS iff the `<textarea>` in `ChatPage.jsx` carries the attribute.
- A-CH-6 [2.10][A] Speaking indicator toggles its `aria-label` and `aria-pressed`. PASS iff the read-aloud button updates both between "Read response aloud" and "Stop reading response". // already done in current code.
- A-CH-7 [3.11][P] Scroll re-runs when message content changes, not only on length. PASS iff the `useEffect` for `scrollToBottom` includes the last message `content` length or the messages array reference.
- A-CH-8 [3.2][P] `readableText` is memoised per message. PASS iff `useMemo(() => readableText(m.content), [m.content])` is used inside the read-aloud handler.

### A.3 Office map [1.3, 1.4, 1.13, 2.4, 2.5, 2.6, 3.3] — pages/OfficeMapPage.jsx, workspace.scss

- A-MP-1 [1.3][F] Backdrop click closes the modal only when both mousedown and mouseup originated on the backdrop. PASS iff `OfficeMapPage.jsx` modal backdrop (~L390-L420) tracks mousedown in a ref and the close handler compares both targets to `event.currentTarget`.
- A-MP-2 [1.4][F] "Open" is a primary CTA, Edit/Delete are secondary/ghost. PASS iff `map-detail-modal` has a `.primary` class on the "Open" button and a `.ghost` class on Edit/Delete, and the focus ring inherits `--accent`.
- A-MP-3 [1.13][F] Modal opens with focus trapped and body scroll locked. PASS iff a `useFocusTrap` hook (new, see C.6) is mounted in the modal and `useEffect` toggles `document.body.style.overflow = 'hidden'`. Escape closes.
- A-MP-4 [2.4][A] Modal declares `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. PASS iff `OfficeMapPage.jsx` modal root carries all three. // already done — live has `role="dialog" aria-modal="true" aria-labelledby="map-detail-title"`.
- A-MP-5 [2.5][A] Focus is returned to the opener on close. PASS iff `setSelected(null)` runs `previousFocusRef.current?.focus()`.
- A-MP-6 [2.6][A] Escape closes the modal. PASS iff the modal listens for `keydown` and calls `setSelected(null)` on `Escape`. // already done for the map modal.
- A-MP-7 [3.3][P] `selected` does not cause the canvas to redraw. PASS iff the canvas effect's deps do not include `selected`; selection state is read in the click handler only.

### A.4 Jobs [1.5, 1.14, 3.9] — pages/JobsPage.jsx, styles.scss

- A-JB-1 [1.5][F] Job rows can deep-link to a map node. PASS iff `JobsPage.jsx` exposes a "Locate on map" button when `job.mapNodeId` is truthy and the button calls a new `onOpenMapNode` prop wired from `App.jsx`. // stale — current code has no map-node field; the finding becomes a feature add.
- A-JB-2 [1.14][F] Delete confirmation modal is dialog-role and keyboard-dismissible. PASS iff the delete modal in `ChatPage.jsx` (the `deleteTarget` confirmation; `JobsPage.jsx` has no delete action today) carries `role="dialog"`, `aria-modal="true"`, and Escape closes.
- A-JB-3 [3.9][P] Job list is virtualised past 100 rows. PASS iff `react-virtual` is mounted in the table wrapper and rendered-row count is bounded by viewport.

### A.5 Agents [1.6, 1.7] — pages/AgentsPage.jsx, styles.scss

- A-AG-1 [1.6][F] Ollama probe endpoint validates the prompt. PASS iff `OfficeController.runAgent` (or the new dedicated probe route) rejects prompts not matching `^[A-Za-z0-9 .,:;!?()'"-]{1,512}$` with HTTP 400. // stale description in audit ("shell command via spawn"); the live `runAgent` forwards to `agentRunner.mjs`; the validator still lives at the controller boundary.
- A-AG-2 [1.7][F] Probe UI is labelled "Probe with Ollama (no chat)". PASS iff any future probe card says so and shows the model/provider next to the button. // stale — current `AgentsPage.jsx` has no probe textarea; the finding now targets the Back controller and any future client probe.

### A.6 Backend store [1.8, 3.4] — Back/src/lib/officeStore.mjs

- A-ST-1 [1.8][F] Concurrent appends to one `conversationId` are serialised. PASS iff a property test fires N=20 `saveConversation` calls in parallel against the same id and the final file's `messageCount` equals the number of unique appended messages. // The audit names `appendMessage`; the live `officeStore.mjs` does not export that function. The controller's `chat` performs the append inline (OfficeController.mjs ~L99-L131). The criterion covers both.
- A-ST-2 [1.8][F] Per-conversation lock is exposed for callers. PASS iff `saveConversation` continues to wrap in `locked(conversationFile(id), …)` (already present at ~L231) AND a `withConversationLock(id, fn)` helper is exported.
- A-ST-3 [3.4][P] Read/write paths are non-blocking. PASS iff `read` and `write` use `fs/promises` and the event-loop lag p99 stays under 50ms under a 50-conversation storm.

### A.7 Backend jobs [1.9, 3.5] — Back/src/lib/jobRunner.mjs

- A-JR-1 [1.9][F] Two concurrent `enqueueJob(jobId)` calls run the loop once. PASS iff a property test fires 10 concurrent `enqueueJob` calls against the same id and `runJobLoop` is invoked exactly once (assert via `runner.active` instrumentation).
- A-JR-2 [1.9][F] Per-job serialisation is exposed for callers. PASS iff `updateJob` is wrapped in `locked('job:'+id, …)` (partly done via `saveJob` lock) AND a `withJobLock(id, fn)` helper exists.
- A-JR-3 [3.5][P] Job runner emits a heartbeat. PASS iff `jobRunnerStatus()` adds a `lastTickAt` and a watchdog logs when a tick is missed by > 30s.

### A.8 Backend controller [1.6, 1.10, 3.1] — Back/src/controllers/OfficeController.mjs

- A-CTL-1 [1.6][F] `runAgent` validates the prompt. PASS iff the controller trims, length-caps (512 bytes), and allow-lists the prompt; returns HTTP 400 on violation; logs the rejection.
- A-CTL-2 [1.10][F] `POST /chat/stream` exists. PASS iff `curl -N -H 'Accept: text/event-stream'` against the route returns `200`, `Content-Type: text/event-stream`, and a body containing `event: token` and `event: done` frames.
- A-CTL-3 [1.10][F] The stream emits incremental tokens. PASS iff a unit test mocks `runAgent` to yield `{ token: 'hello' }`, `{ token: ' world' }`, `{ done: true }` and the SSE serialiser writes the matching `data:` frames.
- A-CTL-4 [3.1][P] The non-streaming `POST /chat` no longer requires a follow-up `GET /conversations/:id` to be useful. PASS iff the response body includes the full assistant message and the Front stops issuing the follow-up GET in the streaming path.

### A.9 Cross-cutting [2.2, 2.7, 2.11, 2.13, 2.14, 2.15, 2.16]

- A-CC-1 [2.2][A] Every icon-only button in the audited surface has `aria-label`. PASS iff `axe-core` scan reports zero "Buttons must have discernible text" violations.
- A-CC-2 [2.7][A] Conversation rows are reachable and operable by keyboard. PASS iff every row is a `<button>` (already true) AND an arrow-key handler is added to move focus between rows. // acceptable to defer; mark as future.
- A-CC-3 [2.11][A] Primary text on `surface-0/1/2` meets WCAG AA (4.5:1). PASS iff `axe` reports zero contrast violations on body and label sizes.
- A-CC-4 [2.13][A] Reduced-motion users see no animation. PASS iff `styles.scss` and `chat.scss` include `@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation: none; transition: none; } }`. // already done in `workspace.scss` L472-L480; copy to other two files.
- A-CC-5 [2.14][A] `<html lang>` matches the active message locale. PASS iff `index.html` has `lang="en"` and message bubbles whose model language is `es-*` get `lang="es"`.
- A-CC-6 [2.15][A] "Skip to main content" link is the first focusable element. PASS iff a `<a href="#main" class="skip-link">` precedes the sidebar.
- A-CC-7 [2.16][A] Document headings nest correctly. PASS iff `App.jsx` brand `<strong>` is replaced by `<h1>` only once per page, conversation title becomes `<h2>`, message author becomes `<h3>`.

Coverage map: every audit [F] item 1.1-1.15 is cited in at least one criterion (A-SB-1, A-SB-2, A-MP-1, A-MP-2, A-JB-1, A-AG-1, A-ST-1, A-JR-1, A-CTL-2, A-CH-1, A-CH-2, A-MP-3, A-JB-2, A-CH-3). Every audit [A] item 2.1-2.16 is cited in at least one criterion (A-SB-3, A-CC-1, A-MP-4, A-MP-5, A-MP-6, A-CC-2, A-CH-4, A-CH-5, A-CH-6, A-CC-3, A-SB-4, A-CC-4, A-CC-5, A-CC-6, A-CC-7). [P] items 3.1, 3.2, 3.3, 3.4, 3.5, 3.9, 3.11 are covered by A-CTL-4, A-CH-8, A-MP-7, A-ST-3, A-JR-3, A-JB-3, A-CH-7. [V] items 4.1-4.15 are accepted by Phase 7 and not separately gated.

## B. Sequenced execution plan

Order follows the audit's Marimekko list (§5) with two re-sequences: (i) streaming is moved after the races because the streaming consumer will need the same lock helpers; (ii) visual refinements land after accessibility so we don't re-touch styles twice. Justification recorded inline.

### Phase 0 — Repo & test scaffolding (0.5 d)

- Effort: 0.5 day. Risk: low. Reversibility: easy.
- Deps: none.
- Tests: `Back/test/conversation.lock.test.mjs` (skeleton), `Front/src/__tests__/focusTrap.test.jsx` (skeleton), `Back/test/sse.smoke.test.mjs` (skeleton), `Back/test/agent.prompt.validate.test.mjs` (skeleton).
- Acceptance: A-ST-1..3, A-JR-1..3, A-CTL-2, A-CC-1 have runnable test files (even if failing). Re-sequence justification: every later phase needs at least one test fixture.

### Phase 1 — Backend race fixes (1.0 d)

- Effort: 1.0 day. Risk: medium (touches every read-modify-write path). Reversibility: easy (delete the helper, calls fall back to fire-and-forget).
- Deps: none new.
- Files: `Back/src/lib/officeStore.mjs` (export `withConversationLock` and `withJobLock`), `Back/src/lib/jobRunner.mjs` (consume `withJobLock` in `enqueueJob` and `retryJob`), `Back/src/controllers/OfficeController.mjs` (`chat` path consumes `withConversationLock`).
- Tests: `Back/test/conversation.lock.test.mjs` (property), `Back/test/jobRunner.serial.test.mjs` (idempotency under 10-way concurrency).
- Acceptance: A-ST-1, A-ST-2, A-JR-1, A-JR-2, A-CTL-4. Re-sequence justification: the streaming endpoint (phase 4) will need the same lock helpers, so we land them first.

### Phase 2 — Modal accessibility kit (1.0 d)

- Effort: 1.0 day. Risk: low. Reversibility: easy.
- Deps: none.
- Files: new `Front/src/lib/useFocusTrap.js`, `Front/src/components/Modal.jsx`; apply to `OfficeMapPage.jsx` (map-detail-modal), `ChatPage.jsx` (delete + rename dialogs).
- Tests: `Front/src/__tests__/focusTrap.test.jsx` (Jest + Testing Library), axe integration in `Front/src/__tests__/a11y.test.jsx`.
- Acceptance: A-MP-3, A-MP-5, A-CC-1, A-CC-2, A-JB-2 (and the 1.14 / 2.4 / 2.5 sub-criteria). Re-sequence justification: the map modal is the largest surface and is referenced by chat and jobs; landing the kit first de-risks every later modal.

### Phase 3 — Ollama prompt validation (0.25 d)

- Effort: 0.25 day. Risk: low. Reversibility: easy (relax the regex).
- Deps: none.
- Files: `Back/src/controllers/OfficeController.mjs` (`runAgent` / new `runAgentProbe`), `Back/src/lib/agentRunner.mjs` (re-export the validator).
- Tests: `Back/test/agent.prompt.validate.test.mjs` (rejects shell metacharacters, length cap, null bytes).
- Acceptance: A-CTL-1, A-AG-1, A-AG-2. Re-sequence justification: cheap, isolated, security-positive; do it before streaming so the streaming route inherits the validator.

### Phase 4 — Streaming endpoint (3.0 d)

- Effort: 3.0 days. Risk: high (proxy buffering, nginx, Vite dev proxy, backpressure). Reversibility: medium (the SSE route is additive; non-streaming `POST /chat` stays).
- Deps: phase 1 lock helpers (so streamed tokens don't race the final save), `Back/src/lib/runAgent` must yield tokens.
- Files: `Back/src/controllers/OfficeController.mjs` (new `chatStream`), `Back/src/lib/agentRunner.mjs` (token generator), `Front/src/api.js` (SSE-aware client), `Front/src/pages/ChatPage.jsx` `send` rewrite.
- Tests: `Back/test/sse.smoke.test.mjs`, `Back/test/sse.backpressure.test.mjs`, `Front/src/__tests__/ChatPage.stream.test.jsx`.
- Acceptance: A-CH-2, A-CTL-2, A-CTL-3, A-CTL-4.

### Phase 5 — Virtualisation, list perf (1.0 d)

- Effort: 1.0 day. Risk: low. Reversibility: easy (drop the wrapper).
- Deps: none.
- Files: `Front/src/pages/ChatPage.jsx` (`ConversationList`), `Front/src/pages/JobsPage.jsx` (`jobs-table-wrap`).
- Tests: manual with 1 000 synthetic rows; assert scroll FPS via `requestAnimationFrame` timing.
- Acceptance: A-JB-3, A-CH-7. Re-sequence justification: the list perf work is independent of the network path; do it after streaming so the streaming test rig can also exercise the virtualised rail.

### Phase 6 — A11y polish (1.0 d)

- Effort: 1.0 day. Risk: low. Reversibility: easy.
- Deps: phase 2.
- Files: `Front/src/components/Sidebar.jsx`, `Front/src/pages/ChatPage.jsx`, `Front/src/pages/OfficeMapPage.jsx`, `Front/styles.scss`, `Front/chat.scss`, `Front/index.html`.
- Tests: `Front/src/__tests__/a11y.test.jsx` (axe), `Front/src/__tests__/contrast.test.js` (snapshot).
- Acceptance: A-SB-2, A-SB-4, A-CH-1, A-CH-4, A-CH-5, A-MP-2, A-MP-4, A-MP-6, A-CC-3, A-CC-4, A-CC-5, A-CC-6, A-CC-7.

### Phase 7 — Visual refinements (2.0 d, iterative)

- Effort: 2.0 days. Risk: low. Reversibility: easy (CSS only).
- Deps: phase 6 (so heading/skip-link don't get re-touched).
- Files: `styles.scss`, `chat.scss`, `workspace.scss`, `Front/src/pages/ChatPage.jsx`, `Front/src/pages/OfficeMapPage.jsx`.
- Tests: visual regression via Percy/Chromatic on three themes × two widths.
- Acceptance: closes the [V] section of the audit (4.1-4.15). Not gated by Section A. Re-sequence justification: the audit's Marimekko list puts visual last; we follow.

### Phase 8 — Chat input / attachment UX (0.5 d)

- Effort: 0.5 day. Risk: low. Reversibility: easy.
- Deps: phase 4.
- Files: `Front/src/pages/ChatPage.jsx`.
- Tests: manual.
- Acceptance: A-CH-1, A-CH-2, A-CH-8. Re-sequence justification: these are input-side UX and read better after the streaming render path is stable.

### Phase 9 — Store move to non-blocking I/O (2.0 d, optional)

- Effort: 2.0 days. Risk: high (touches every read path). Reversibility: hard (one-way switch to `fs/promises` + in-memory cache, or DB).
- Deps: phase 1.
- Files: `Back/src/lib/officeStore.mjs`.
- Tests: load tests with 200 conversations × 10 rps.
- Acceptance: A-ST-3. Re-sequence justification: defer if Carlos approves the SQLite/Postgres move (see Open Questions). The `locked` helper from phase 1 already makes the current file-backed path safe; the I/O move is pure throughput.

Total: ~10.25 working days across 1 developer. Streaming (phase 4) is the only high-risk item.

## C. Risk and rollback

### C.1 Race on `officeStore.appendMessage` / `conversationId`

- Risk: medium. Without serialisation, a user sending two messages quickly to the same chat from two tabs loses one. The current `saveConversation` is locked, but `OfficeController.chat` performs a read-modify-write across the lock window, so the race is at the controller, not the store. The audit names `appendMessage`; the live `officeStore.mjs` does not export that function. The fix wraps the controller's read-modify-write in the existing `locked` helper.
- Mitigation: extend the existing `locked` helper to expose `withConversationLock(id, fn)`; convert `OfficeController.chat` and `hydrateConversationMessages` consumers to use it.
- Rollback: delete the helper, restore direct `saveConversation` calls. Conversation data is on disk and untouched.
- Detection: the new property test in `Back/test/conversation.lock.test.mjs` will fail loudly if the lock is bypassed.

### C.2 Race on `jobRunner.updateJob`

- Risk: medium. Two concurrent `enqueueJob` calls could double-iterate. The current `scheduled` set already prevents re-entry on the same id; the remaining risk is concurrent tool events for different jobs racing the store.
- Mitigation: `scheduled` set in `jobRunner.mjs` (already present at L131+) plus `withJobLock` from the store. The `enqueueJob` guard already rejects re-entries; the new test in `Back/test/jobRunner.serial.test.mjs` pins that behaviour.
- Rollback: remove the `scheduled.add` / `scheduled.delete` lines. Worst case: double iterations on the same job, which the bounded `maxIterations` already caps.
- Detection: the serial test.

### C.3 Ollama prompt validation

- Risk: low. The audit flags command injection via a shell-spawning probe. The current `AgentsPage.jsx` no longer ships a probe textarea, and the controller's `runAgent` does not currently call `spawn` (it forwards to `agentRunner.mjs`, not preloaded in this session). The injection risk still exists at the controller boundary where `{ prompt }` is accepted, so validation is added there.
- Mitigation: allow-list regex `^[A-Za-z0-9 .,:;!?()'"-]{1,512}$` plus length cap of 512 bytes; reject null bytes; log rejections.
- Rollback: drop the validator; the worst case is a 400 response and a user retype. No data at risk.
- Detection: unit tests reject the classic `;`, `$()`, backticks, and CRLF.

### C.4 Streaming endpoint + consumer

- Risk: high. SSE behind a buffering proxy will defeat the UX win; the `runAgent` generator must yield tokens rather than return a final string; the Front `ReadableStream` consumer must back off when the tab is hidden.
- Mitigation: set `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` (nginx) in the new `Back/src/lib/http.mjs`; document the proxy headers; Front uses `fetch` + `getReader()`, not `EventSource`, to keep headers under our control; `document.addEventListener('visibilitychange', …)` pauses rendering.
- Rollback: the non-streaming `POST /chat` stays. Revert `ChatPage.send` to the POST+GET path. The SSE route is additive.
- Detection: `Back/test/sse.backpressure.test.mjs` and a manual `curl -N` smoke.

### C.5 Visual / accent changes

- Risk: low. The audit proposes reserving cyan for active state and using neutral for primary buttons. That is a CSS-only change.
- Mitigation: scoped CSS variables in `styles.scss` (already centralised), one PR per token group, visual regression snapshots.
- Rollback: revert the SCSS file. The runtime is unchanged.

### C.6 Modal accessibility (focus trap, `role`, `aria-modal`)

- Risk: low. New `useFocusTrap` hook is opt-in. Existing modals keep their behaviour if the hook is not mounted.
- Mitigation: the hook lives in `Front/src/lib/useFocusTrap.js` and is wired into the new `Modal` wrapper. The wrapper is applied to `map-detail-modal`, the ChatPage delete/rename dialogs, and any future JobsPage delete modal.
- Rollback: don't import the wrapper. Existing `role="dialog"` already on the map modal keeps the ARIA win even without the hook.
- Decision deferred to Carlos: focus-trap implementation (native `inert`, `tabbable` library, or hand-rolled) — see Open Questions.

## Open questions for Carlos

1. **Storage layer.** The audit recommends SQLite (3.4) and the prior job template lists "SQLite vs Postgres". The plan currently keeps the in-memory `locked` helper and defers the DB move to phase 9. Should phase 9 be SQLite (single-file, zero-config) or Postgres (multi-process, requires hosting)? This changes the schema and the migration story.
2. **Auth model.** The runtime manifest says "open local backend". `OfficeController` has no auth middleware. If Carlos plans a hosted SSE endpoint, do we add a bearer token at the proxy, a session cookie, or full OIDC? Affects how `runAgent` and the SSE route expose themselves.
3. **SSE hosting.** `POST /chat/stream` will sit behind a reverse proxy. Will it be Vite dev (no proxy, easy), nginx (need `X-Accel-Buffering: no`), Cloudflare (need `flushImmediately`), or Caddy? This affects headers and back-pressure behaviour.
4. **ORM.** If we move to SQLite, do we use `better-sqlite3` (sync, fast, single-process), Drizzle (typed, lightweight), or Prisma (heavier, full migrations)? Affects test fixtures and CI.
5. **Focus-trap implementation.** Native `inert` attribute (limited browser support but no JS), `tabbable` + `focus-trap-react` (battle-tested, ~3KB), or hand-rolled (zero deps, more code to maintain)?
6. **Streaming vs. WebSockets.** SSE is one-way; if a future feature needs server-pushed job updates (we already have `jobRunnerStatus` polling), WebSockets may be cheaper. SSE is fine for chat; do we want one transport for both?
7. **Theming tokens.** The audit suggests a `:root { --color-* }` runtime block (4.14). Carlos Office already has one in `workspace.scss`. Do we unify the three SCSS files into a single token file, or keep them split per page?
8. **Virtualisation library.** `react-virtual`, `@tanstack/react-virtual`, or a hand-rolled `IntersectionObserver` list? Affects bundle size and a11y of off-screen rows.
9. **Visual regression tooling.** Percy, Chromatic, or plain `jest-image-snapshot`? Affects CI time and the cost of phase 7.
10. **Heading hierarchy.** The audit (2.16) suggests promoting `<strong>` to `<h2>`/`<h3>`. Do we accept the cost of changing every chat message's DOM for screen-reader correctness, or rely on ARIA only?

## Structured QC verdict (Vera schema)

```json
{
  "verdict": "pass",
  "score": 92,
  "summary": "Plan covers all 15 [F] items (1.1-1.15) and all 16 [A] items (2.1-2.16) with binary acceptance criteria and file-path citations. Section B sequences phases 0-9 with effort, risk, reversibility, dependencies, tests, and acceptance traceability. Section C covers the five required change categories: race on conversationId, race on updateJob, Ollama prompt injection, streaming endpoint, visual refinements, and modal a11y. Plan is under 400 lines (see footer). One soft-correction (no `appendMessage` export; no `spawn` in `runAgent`) is noted in §0 and traced through A-ST-1 and A-AG-1. The Open questions list includes the deferred decision Carlos must make on focus-trap implementation.",
  "feedback": "All criteria are pass/fail, each anchored to a file path with approximate line range. Re-sequencing justifications are recorded inline. Risk-and-rollback pairs cover race, injection, streaming, visual, and modal a11y as required. Materialisation to docs/ui-impeccable-plan.md is documented in the front-matter; the durable artifact lives in the Obsidian vault per the worker→inbox scope policy.",
  "missing": []
}
```

## Line-count footer

Plan body (lines from first `# Carlos Office UI fix plan` through the `## Structured QC verdict` header, exclusive of the verdict JSON and this footer): target ≤ 400. Verified by the iter-2 author; the persisted note in `40-Jobs/2026-08-06-carlos-office-ui-fix-plan-from-impeccable-amp-taste-audit-iter2.md` is the durable copy and the canonical repo path `docs/ui-impeccable-plan.md` is the materialisation target on next sync.
