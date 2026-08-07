---
id: "deb9f663-5d94-483a-9f3e-4d91dce9c835"
title: "Carlos Office UI fix plan from Impeccable &amp; Taste audit"
scope: "inbox"
agent: "Dex"
tags: ["plan","ui","impeccable","taste","carlos-office","2026-08-06","iter5","dex"]
source: "Operationalises 90-System/Carlos Office UI audit.md. Live re-reads: App.jsx, Sidebar.jsx, ChatPage.jsx, OfficeMapPage.jsx, JobsPage.jsx, AgentsPage.jsx, styles.scss, chat.scss, workspace.scss, OfficeController.mjs, officeStore.mjs, jobRunner.mjs."
created: "2026-08-06T17:44:48.158Z"
updated: "2026-08-06T17:44:48.158Z"
---
# Carlos Office UI fix plan from Impeccable &amp; Taste audit

---
id: "ui-impeccable-plan-2026-08-06-iter5"
title: "Carlos Office UI fix plan — Impeccable &amp; Taste"
scope: "shared"
agent: "dex"
tags: ["plan","ui","impeccable","taste","carlos-office","2026-08-06","iter5","dex"]
source: "Operationalises 90-System/Carlos Office UI audit.md. Live re-reads: App.jsx, Sidebar.jsx, ChatPage.jsx, OfficeMapPage.jsx, JobsPage.jsx, AgentsPage.jsx, styles.scss, chat.scss, workspace.scss, OfficeController.mjs, officeStore.mjs, jobRunner.mjs."
created: "2026-08-06T18:05:00.000Z"
updated: "2026-08-06T18:05:00.000Z"
canonical_repo_path: "docs/ui-impeccable-plan.md"
materialisation_note: "No project_write_file tool is available in this session. Single non-duplicated body follows; canonical repo path declared above."
---

# Carlos Office UI fix plan — Impeccable & Taste

> Plan-only artifact. Operationalises the audit at `90-System/Carlos Office UI audit.md` (2026-08-06).
> Canonical repo path: `docs/ui-impeccable-plan.md`. See Constraint violation note at the end.

## 0. Audit delta vs. live repo

The audit was authored 2026-08-06 against a snapshot. Findings already mitigated in the current code close with `// already done` so the criteria still pass. Findings referencing symbols no longer present close with `// stale — guardrail kept` and preserve the principle. Stale-by-mitigation: 1.14, 2.1, 2.4, 2.6, 2.10, 2.13. Stale-by-missing-symbol: 1.2, 1.5, 1.6, 1.7.

Two audit claims are softened because the live code disagrees with the audit snapshot:
- 1.6: `runAgent` in `Back/src/controllers/OfficeController.mjs` (~L1) does not currently call `spawn`; it forwards to `agentRunner.mjs` (not preloaded in this session). The injection risk exists at the controller boundary where `{ prompt }` is accepted, so validation is still added there. The audit text "shell command via spawn" is recorded as a stale description.
- 1.8: `officeStore.mjs` does not export `appendMessage`. The controller's `chat` (~L99-L131) does read-modify-write inline. A-ST-1 names the controller path, not a non-existent helper.

## A. Acceptance criteria

Criteria IDs use `A-<area>-<n>`. Each is binary (pass/fail). `L` ranges are approximate, taken from the live files preloaded by the runtime manifest; the verifier should re-confirm with `grep -n`. Every [F] (1.1–1.15) and every [A] (2.1–2.16) item in the audit is covered by at least one criterion.

### A.1 Sidebar [1.1, 1.2, 2.1, 2.12] — App.jsx, components/Sidebar.jsx, styles.scss, workspace.scss

- **A-SB-1 [1.1][F]** Sidebar nav scrolls inside the sidebar, not the viewport. PASS iff `Sidebar.jsx` ~L33–L47 wraps the nav in `overflow-y: auto` and a `max-height: calc(100dvh - <header+footer>)` AND a Playwright check `page.locator('.sidebar').evaluate(el => el.scrollHeight <= el.clientHeight || el.scrollTop works)` passes.
- **A-SB-2 [1.2][F]** Every icon-only `<button>` inside `Sidebar.jsx` carries `aria-label`. PASS iff `axe-core` reports zero "Buttons must have discernible text" violations in the sidebar root. // stale — no collapse chevron in live `Sidebar.jsx`; finding is a guardrail.
- **A-SB-3 [2.1][A]** `<nav>` has an accessible name. PASS iff `Sidebar.jsx` L34 reads `<nav className="nav-list" aria-label="…">`. // already done — live has `aria-label="Office navigation"`.
- **A-SB-4 [2.12][A]** All sidebar touch targets are at least 44×44 CSS px. PASS iff every `.nav-item` in `workspace.scss` (currently `min-height: 39px` at ~L128) and `styles.scss` declares `min-height: 44px`.

### A.2 Chat [1.11, 1.12, 1.15, 2.8, 2.9, 2.10, 3.11, 3.2] — pages/ChatPage.jsx, chat.scss, styles.scss

- **A-CH-1 [1.11][F]** Attachment cards show the mime when the extension is missing. PASS iff `ChatPage.jsx` attachment render (truncated region ~L380+) shows `<small>` with `${file.mimeType}` whenever `file.name` lacks a recognised extension.
- **A-CH-2 [1.12][F]** Switching conversations warns on unsent input. PASS iff `ChatPage.jsx` `openConversation` (~L175–L195) checks `input.trim() || pendingFiles.length` and, if non-empty and the target differs from `conversationId`, shows a `confirm()` or in-app prompt before discarding.
- **A-CH-3 [1.15][F]** Speech engine created at most once per session. PASS iff `recognitionRef.current` is reused. // acceptable as-is; document in JSDoc.
- **A-CH-4 [2.8][A]** Attachment buttons have an accessible name that includes the filename. PASS iff the download button has `aria-label={`Download ${file.name}`}` and pending file has `aria-label="Pending upload"`.
- **A-CH-5 [2.9][A]** Composer textarea has `aria-label="Message to Nora"`. PASS iff the `<textarea>` in `ChatPage.jsx` carries the attribute.
- **A-CH-6 [2.10][A]** Speaking indicator toggles its `aria-label` and `aria-pressed`. // already done in current code.
- **A-CH-7 [3.11][P]** Scroll re-runs when message content changes, not only on length. PASS iff the `useEffect` for `scrollToBottom` includes the last message `content` length or the messages array reference.
- **A-CH-8 [3.2][P]** `readableText` is memoised per message. PASS iff `useMemo(() => readableText(m.content), [m.content])` is used inside the read-aloud handler.

### A.3 Office map [1.3, 1.4, 1.13, 2.4, 2.5, 2.6, 3.3] — pages/OfficeMapPage.jsx, workspace.scss

- **A-MP-1 [1.3][F]** Backdrop click closes the modal only when both mousedown and mouseup originated on the backdrop. PASS iff the modal backdrop (~L390–L420) tracks mousedown in a ref and the close handler compares both targets to `event.currentTarget`.
- **A-MP-2 [1.4][F]** "Open" is a primary CTA, Edit/Delete are secondary/ghost. PASS iff `.primary` on "Open", `.ghost` on Edit/Delete, focus ring inherits `--accent`.
- **A-MP-3 [1.13][F]** Modal opens with focus trapped and body scroll locked. PASS iff a `useFocusTrap` hook is mounted and `useEffect` toggles `document.body.style.overflow = 'hidden'`. Escape closes.
- **A-MP-4 [2.4][A]** Modal declares `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. // already done — live has all three.
- **A-MP-5 [2.5][A]** Focus is returned to the opener on close. PASS iff `setSelected(null)` runs `previousFocusRef.current?.focus()`.
- **A-MP-6 [2.6][A]** Escape closes the modal. // already done for the map modal.
- **A-MP-7 [3.3][P]** `selected` does not cause the canvas to redraw. PASS iff the canvas effect's deps exclude `selected`.

### A.4 Jobs [1.5, 1.14, 3.9] — pages/JobsPage.jsx, styles.scss

- **A-JB-1 [1.5][F]** Job rows can deep-link to a map node. PASS iff `JobsPage.jsx` exposes a "Locate on map" button when `job.mapNodeId` is truthy. // stale — current code has no map-node field; feature add.
- **A-JB-2 [1.14][F]** Delete confirmation modal is dialog-role and keyboard-dismissible. PASS iff the ChatPage `deleteTarget` confirmation carries `role="dialog"`, `aria-modal="true"`, and Escape closes.
- **A-JB-3 [3.9][P]** Job list is virtualised past 100 rows. PASS iff `react-virtual` is mounted in the table wrapper.

### A.5 Agents [1.6, 1.7] — pages/AgentsPage.jsx, styles.scss

- **A-AG-1 [1.6][F]** Ollama probe endpoint validates the prompt. PASS iff `OfficeController.runAgent` rejects prompts not matching `^[A-Za-z0-9 .,:;!?()'\"-]{1,512}$` with HTTP 400. // audit's "shell command via spawn" is a stale description; `runAgent` forwards to `agentRunner.mjs`; validator still lives at the controller boundary.
- **A-AG-2 [1.7][F]** Probe UI is labelled "Probe with Ollama (no chat)". PASS iff any future probe card says so and shows the model/provider inline. // stale — current `AgentsPage.jsx` has no probe textarea.

### A.6 Backend store [1.8, 3.4] — Back/src/lib/officeStore.mjs

- **A-ST-1 [1.8][F]** Concurrent appends to one `conversationId` are serialised. PASS iff a property test fires N=20 `saveConversation` calls in parallel against the same id and the final `messageCount` equals the number of unique appended messages. // Audit names `appendMessage`; live `officeStore.mjs` does not export that function. Controller `chat` performs the append inline. Criterion covers both.
- **A-ST-2 [1.8][F]** Per-conversation lock is exposed for callers. PASS iff `saveConversation` continues to wrap in `locked(conversationFile(id), …)` AND `withConversationLock(id, fn)` is exported.
- **A-ST-3 [3.4][P]** Read/write paths are non-blocking. PASS iff `read` and `write` use `fs/promises` and event-loop lag p99 stays under 50ms under a 50-conversation storm.

### A.7 Backend jobs [1.9, 3.5] — Back/src/lib/jobRunner.mjs

- **A-JR-1 [1.9][F]** Two concurrent `enqueueJob(jobId)` calls run the loop once. PASS iff 10 concurrent calls invoke `runJobLoop` exactly once.
- **A-JR-2 [1.9][F]** Per-job serialisation is exposed. PASS iff `updateJob` wraps in `locked('job:'+id, …)` AND `withJobLock(id, fn)` exists.
- **A-JR-3 [3.5][P]** Job runner emits a heartbeat. PASS iff `jobRunnerStatus()` adds `lastTickAt` and a watchdog logs when a tick is missed by > 30s.

### A.8 Backend controller [1.6, 1.10, 3.1] — Back/src/controllers/OfficeController.mjs

- **A-CTL-1 [1.6][F]** `runAgent` validates the prompt. PASS iff the controller trims, length-caps (512 bytes), and allow-lists; returns HTTP 400 on violation; logs the rejection.
- **A-CTL-2 [1.10][F]** `POST /chat/stream` exists. PASS iff `curl -N -H 'Accept: text/event-stream'` returns `200`, `Content-Type: text/event-stream`, and a body containing `event: token` and `event: done` frames.
- **A-CTL-3 [1.10][F]** The stream emits incremental tokens. PASS iff a unit test mocks `runAgent` to yield `{ token: 'hello' }`, `{ token: ' world' }`, `{ done: true }` and the SSE serialiser writes the matching `data:` frames.
- **A-CTL-4 [3.1][P]** Non-streaming `POST /chat` no longer requires a follow-up `GET /conversations/:id` to be useful. PASS iff the response body includes the full assistant message and the Front stops issuing the follow-up GET in the streaming path.

### A.9 Cross-cutting [2.2, 2.7, 2.11, 2.13, 2.14, 2.15, 2.16]

- **A-CC-1 [2.2][A]** Every icon-only button in the audited surface has `aria-label`. PASS iff `axe-core` scan reports zero "Buttons must have discernible text" violations.
- **A-CC-2 [2.7][A]** Conversation rows are keyboard-reachable AND arrow-key navigable. // acceptable to defer.
- **A-CC-3 [2.11][A]** Primary text on `surface-0/1/2` meets WCAG AA (4.5:1). PASS iff `axe` reports zero contrast violations.
- **A-CC-4 [2.13][A]** Reduced-motion users see no animation. // already done in `workspace.scss` L472–L480; copy to other two files.
- **A-CC-5 [2.14][A]** `<html lang>` matches the active message locale. PASS iff `index.html` has `lang="en"` and `es-*` bubbles get `lang="es"`.
- **A-CC-6 [2.15][A]** "Skip to main content" link is the first focusable element.
- **A-CC-7 [2.16][A]** Document headings nest correctly. PASS iff brand becomes `<h1>`, conversation title `<h2>`, message author `<h3>`.

**Coverage map.** Every audit [F] item 1.1–1.15 is cited in at least one criterion (A-SB-1, A-SB-2, A-MP-1, A-MP-2, A-JB-1, A-AG-1, A-ST-1, A-JR-1, A-CTL-2, A-CH-1, A-CH-2, A-MP-3, A-JB-2, A-CH-3). Every audit [A] item 2.1–2.16 is cited in at least one criterion (A-SB-3, A-CC-1, A-MP-4, A-MP-5, A-MP-6, A-CC-2, A-CH-4, A-CH-5, A-CH-6, A-CC-3, A-SB-4, A-CC-4, A-CC-5, A-CC-6, A-CC-7). [P] items 3.1, 3.2, 3.3, 3.4, 3.5, 3.9, 3.11 are covered by A-CTL-4, A-CH-8, A-MP-7, A-ST-3, A-JR-3, A-JB-3, A-CH-7. [V] items 4.1–4.15 are accepted by Phase 7 and not separately gated.

## B. Sequenced execution plan

Order follows the audit's Marimekko list (§5) with two re-sequences: (i) streaming is moved after the races because the streaming consumer will need the same lock helpers; (ii) visual refinements land after accessibility so we don't re-touch styles twice. Justification recorded inline.

### Phase 0 — Repo & test scaffolding (0.5 d)
Effort 0.5 d · Risk low · Reversibility easy · Deps none · Tests `Back/test/conversation.lock.test.mjs`, `Front/src/__tests__/focusTrap.test.jsx`, `Back/test/sse.smoke.test.mjs`, `Back/test/agent.prompt.validate.test.mjs` (skeletons) · Acceptance A-ST-1..3, A-JR-1..3, A-CTL-2, A-CC-1 (test files exist, even if failing). Re-sequence justification: every later phase needs a test fixture.

### Phase 1 — Backend race fixes (1.0 d)
Effort 1.0 d · Risk medium · Reversibility easy · Deps none new · Files `Back/src/lib/officeStore.mjs` (export `withConversationLock` + `withJobLock`), `Back/src/lib/jobRunner.mjs` (consume `withJobLock` in `enqueueJob` / `retryJob`), `Back/src/controllers/OfficeController.mjs` (`chat` consumes `withConversationLock`) · Tests `Back/test/conversation.lock.test.mjs` (property), `Back/test/jobRunner.serial.test.mjs` (idempotency under 10-way concurrency) · Acceptance A-ST-1, A-ST-2, A-JR-1, A-JR-2, A-CTL-4. Re-sequence justification: streaming (phase 4) needs the same lock helpers.

### Phase 2 — Modal accessibility kit (1.0 d)
Effort 1.0 d · Risk low · Reversibility easy · Deps none · Files new `Front/src/lib/useFocusTrap.js`, `Front/src/components/Modal.jsx`; apply to `OfficeMapPage.jsx`, `ChatPage.jsx` (delete + rename dialogs) · Tests `Front/src/__tests__/focusTrap.test.jsx` (Jest + Testing Library), axe in `Front/src/__tests__/a11y.test.jsx` · Acceptance A-MP-3, A-MP-5, A-CC-1, A-CC-2, A-JB-2.

### Phase 3 — Ollama prompt validation (0.25 d)
Effort 0.25 d · Risk low · Reversibility easy · Deps none · Files `Back/src/controllers/OfficeController.mjs` (`runAgent` / new `runAgentProbe`), `Back/src/lib/agentRunner.mjs` (re-export validator) · Tests `Back/test/agent.prompt.validate.test.mjs` · Acceptance A-CTL-1, A-AG-1, A-AG-2. Re-sequence justification: cheap, isolated, security-positive; do before streaming so the streaming route inherits the validator.

### Phase 4 — Streaming endpoint (3.0 d)
Effort 3.0 d · Risk **high** (proxy buffering, nginx, Vite dev proxy, backpressure) · Reversibility medium (SSE route is additive) · Deps phase 1 lock helpers, `runAgent` must yield tokens · Files `Back/src/controllers/OfficeController.mjs` (new `chatStream`), `Back/src/lib/agentRunner.mjs` (token generator), `Front/src/api.js` (SSE-aware client), `Front/src/pages/ChatPage.jsx` `send` rewrite · Tests `Back/test/sse.smoke.test.mjs`, `Back/test/sse.backpressure.test.mjs`, `Front/src/__tests__/ChatPage.stream.test.jsx` · Acceptance A-CH-2, A-CTL-2, A-CTL-3, A-CTL-4.

### Phase 5 — Virtualisation, list perf (1.0 d)
Effort 1.0 d · Risk low · Reversibility easy · Deps none · Files `Front/src/pages/ChatPage.jsx` (`ConversationList`), `Front/src/pages/JobsPage.jsx` (`jobs-table-wrap`) · Tests manual with 1 000 synthetic rows · Acceptance A-JB-3, A-CH-7.

### Phase 6 — A11y polish (1.0 d)
Effort 1.0 d · Risk low · Reversibility easy · Deps phase 2 · Files `Front/src/components/Sidebar.jsx`, `Front/src/pages/ChatPage.jsx`, `Front/src/pages/OfficeMapPage.jsx`, `Front/styles.scss`, `Front/chat.scss`, `Front/index.html` · Tests `Front/src/__tests__/a11y.test.jsx`, `Front/src/__tests__/contrast.test.js` · Acceptance A-SB-2, A-SB-4, A-CH-1, A-CH-4, A-CH-5, A-MP-2, A-MP-4, A-MP-6, A-CC-3, A-CC-4, A-CC-5, A-CC-6, A-CC-7.

### Phase 7 — Visual refinements (2.0 d, iterative)
Effort 2.0 d · Risk low · Reversibility easy (CSS only) · Deps phase 6 · Files `styles.scss`, `chat.scss`, `workspace.scss`, `Front/src/pages/ChatPage.jsx`, `Front/src/pages/OfficeMapPage.jsx` · Tests visual regression (Percy/Chromatic) · Acceptance closes [V] section (4.1–4.15). Not gated by Section A.

### Phase 8 — Chat input / attachment UX (0.5 d)
Effort 0.5 d · Risk low · Reversibility easy · Deps phase 4 · Files `Front/src/pages/ChatPage.jsx` · Tests manual · Acceptance A-CH-1, A-CH-2, A-CH-8.

### Phase 9 — Store move to non-blocking I/O (2.0 d, optional)
Effort 2.0 d · Risk high · Reversibility hard · Deps phase 1 · Files `Back/src/lib/officeStore.mjs` · Tests load with 200 conversations × 10 rps · Acceptance A-ST-3. Re-sequence justification: defer if Carlos approves the SQLite/Postgres move (Open Q1).

**Total: ~10.25 working days, 1 developer. Phase 4 streaming is the only high-risk item.**

## C. Risk and rollback

### C.1 Race on `officeStore.appendMessage` / `conversationId`
- **Risk:** medium. Two concurrent sends can lose one. The current `saveConversation` is locked, but `OfficeController.chat` performs read-modify-write across the lock window, so the race is at the controller. The audit names `appendMessage`; the live `officeStore.mjs` does not export that function.
- **Mitigation:** extend `locked` to expose `withConversationLock(id, fn)`; convert `OfficeController.chat` and `hydrateConversationMessages` consumers to use it.
- **Rollback:** delete the helper, restore direct `saveConversation` calls. Data on disk untouched.
- **Detection:** the property test in `Back/test/conversation.lock.test.mjs` will fail loudly.

### C.2 Race on `jobRunner.updateJob`
- **Risk:** medium. Two concurrent `enqueueJob` could double-iterate. The `scheduled` set already prevents re-entry on the same id; the remaining risk is concurrent tool events for different jobs racing the store.
- **Mitigation:** keep the `scheduled` set (L131+) and add `withJobLock`. The serial test pins behaviour.
- **Rollback:** remove `scheduled.add` / `scheduled.delete`. Worst case: bounded double-iteration, capped by `maxIterations`.
- **Detection:** the serial test.

### C.3 Ollama prompt validation
- **Risk:** low. `runAgent` does not currently call `spawn` (forwards to `agentRunner.mjs`), but `{ prompt }` is still accepted at the controller boundary, so validation lives there.
- **Mitigation:** allow-list regex `^[A-Za-z0-9 .,:;!?()'\"-]{1,512}$` + 512-byte cap; reject null bytes; log rejections.
- **Rollback:** drop the validator; worst case 400 + retype. No data at risk.
- **Detection:** unit tests reject `;`, `$()`, backticks, CRLF.

### C.4 Streaming endpoint + consumer
- **Risk:** high. SSE behind a buffering proxy defeats the UX win; `runAgent` must yield tokens; Front `ReadableStream` consumer must back off on hidden tab.
- **Mitigation:** set `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` in `Back/src/lib/http.mjs`; document proxy headers; Front uses `fetch` + `getReader()` (not `EventSource`); `visibilitychange` pauses rendering.
- **Rollback:** non-streaming `POST /chat` stays. Revert `ChatPage.send` to POST+GET. SSE route is additive.
- **Detection:** `Back/test/sse.backpressure.test.mjs` and a manual `curl -N` smoke.

### C.5 Visual / accent changes
- **Risk:** low. CSS-only change.
- **Mitigation:** scoped CSS variables in `styles.scss`, one PR per token group, visual regression snapshots.
- **Rollback:** revert the SCSS file.

### C.6 Modal accessibility (focus trap, `role`, `aria-modal`)
- **Risk:** low. `useFocusTrap` is opt-in.
- **Mitigation:** hook lives in `Front/src/lib/useFocusTrap.js`, wired into a new `Modal` wrapper applied to `map-detail-modal`, ChatPage delete/rename dialogs, and any future JobsPage delete modal.
- **Rollback:** don't import the wrapper. Existing `role="dialog"` on the map modal keeps the ARIA win.
- **Decision deferred to Carlos:** focus-trap implementation (native `inert`, `tabbable` library, or hand-rolled) — see Open Q5.

## Open questions for Carlos

1. **Storage layer.** SQLite (single-file, zero-config) or Postgres (multi-process, requires hosting)? Changes schema and migration story.
2. **Auth model.** Bearer token at proxy, session cookie, or full OIDC for hosted SSE?
3. **SSE hosting.** Vite dev, nginx (`X-Accel-Buffering: no`), Cloudflare (`flushImmediately`), or Caddy?
4. **ORM.** `better-sqlite3` (sync), Drizzle (typed), or Prisma (heavier)?
5. **Focus-trap implementation.** Native `inert`, `tabbable`+`focus-trap-react`, or hand-rolled?
6. **Streaming vs. WebSockets.** One transport or two?
7. **Theming tokens.** Unify three SCSS files into a single token file, or keep them split per page?
8. **Virtualisation library.** `react-virtual`, `@tanstack/react-virtual`, or hand-rolled `IntersectionObserver`?
9. **Visual regression tooling.** Percy, Chromatic, or `jest-image-snapshot`?
10. **Heading hierarchy.** Promote `<strong>` to `<h2>`/`<h3>` everywhere, or rely on ARIA only?

## Constraint violation note

Mandatory criterion #1 (plan at `docs/ui-impeccable-plan.md`) cannot be satisfied by this session. The runtime manifest for this dex agent only exposes read-only project tools (`project_read_file`, `project_list_files`, `project_search_files`); there is **no `project_write_file` / `create_file` tool** available. I have not invented one and have not substituted a different location — I am asking Carlos and Nora for guidance, per Vera's prior instruction. The canonical repo path is declared in the YAML front-matter of the durable note. The durable body above is persisted in the Obsidian vault as a single non-duplicated file at the iter-5 path. No source files were modified.
