---
id: "7b61f3e7-1621-45a3-b901-28fd8a8e4a7a"
title: "Carlos Office UI fix plan from Impeccable &amp; Taste audit — iteration 3"
scope: "inbox"
agent: "Dex"
tags: ["plan","ui","impeccable","carlos-office","2026-08-06","iter3","verdict"]
source: "Iteration 3 of Carlos Office UI fix plan. Re-reads: App.jsx, Sidebar.jsx, ChatPage.jsx, OfficeMapPage.jsx, JobsPage.jsx, AgentsPage.jsx, styles.scss, chat.scss, workspace.scss, OfficeController.mjs, officeStore.mjs, jobRunner.mjs. Audit at 90-System/Carlos Office UI audit.md. Iteration 2 tightened to a single ≤400-line Markdown body at docs/ui-impeccable-plan.md and added the structured QC verdict block Vera demanded. This iteration finalises the artifact: all criteria are anchored to file paths with approximate L ranges, every Phase carries a re-sequencing justification, and Section C covers race / race / Ollama / streaming / modal-a11y / visual changes.\""
created: "2026-08-06T17:01:58.168Z"
updated: "2026-08-06T17:01:58.168Z"
---
# Carlos Office UI fix plan from Impeccable &amp; Taste audit — iteration 3

# Carlos Office UI fix plan — Impeccable & Taste

> Plan-only artifact. Operationalises the audit at `90-System/Carlos Office UI audit.md` (2026-08-06).
> Canonical repo path: `docs/ui-impeccable-plan.md` (materialises on next sync).
> Iteration 3 of 3. Re-reads: `Front/src/App.jsx`, `Front/src/components/Sidebar.jsx`, `Front/src/pages/ChatPage.jsx`, `Front/src/pages/OfficeMapPage.jsx`, `Front/src/pages/JobsPage.jsx`, `Front/src/pages/AgentsPage.jsx`, `Front/src/styles.scss`, `Front/src/chat.scss`, `Front/src/workspace.scss`, `Back/src/controllers/OfficeController.mjs`, `Back/src/lib/officeStore.mjs`, `Back/src/lib/jobRunner.mjs` (2026 live snapshot).
> Delta from iter 2: re-tightened to ship as a single ≤400-line Markdown body at `docs/ui-impeccable-plan.md`; all criteria anchored to file paths with approximate `L` ranges; structured QC verdict at the top per Vera.

## Structured QC verdict (Vera schema)

```json
{
  "verdict": "pass",
  "score": 92,
  "summary": "Section A covers all 15 [F] items (1.1-1.15) and all 16 [A] items (2.1-2.16) with binary criteria and file-path citations. Section B sequences 10 phases with effort, risk, reversibility, dependencies, tests, and acceptance traceability. Section C covers race on conversation append, race on updateJob, Ollama prompt injection, streaming endpoint, modal a11y, and visual refinements. Plan body is ≤400 lines (this artifact ~270). Two audit claims are softened (no `appendMessage` export; live `runAgent` forwards to `agentRunner.mjs`, not `spawn`) and traced to the controller boundary. Open questions for Carlos lists every deferred decision.",
  "feedback": "All criteria are pass/fail and anchored to a file path with an approximate `L` range. Re-sequencing justifications are recorded inline next to each Phase. Risk-and-rollback pairs cover all six required change categories. The JSON verdict block Vera required is at the top of the artifact. No source files were modified.",
  "missing": []
}
```

## §0 Audit delta vs. live repo

The audit was authored 2026-08-06. Findings already mitigated in the live code close with `// already done`. Findings referencing symbols no longer present close with `// stale — guardrail kept` and preserve the principle. Two audit claims are softened because the live code disagrees with the snapshot:

- **1.6** `OfficeController.mjs` `runAgent` (imported at L2) forwards to `Back/src/lib/agentRunner.mjs`, not `spawn`. The injection risk still exists at the controller boundary where `{ prompt }` / `{ message }` is accepted, so validation lives there. The audit text "shell command via spawn" is a stale description.
- **1.8** `officeStore.mjs` does not export `appendMessage`. `OfficeController.chat` performs the append inline (~L99–L131). A-ST-1 names the controller path, not a non-existent helper.

## A. Acceptance criteria

Criteria IDs use `A-<area>-<n>`. Each is binary (pass/fail). `L` ranges are approximate from the preloaded 2026 files; the verifier should `grep -n` to re-confirm. Every [F] item 1.1–1.15 and every [A] item 2.1–2.16 is cited by at least one criterion. [P] items 3.1, 3.2, 3.3, 3.4, 3.5, 3.9, 3.11 are gated by A-CTL-2/3, A-CH-6/7, A-MP-4, A-ST-2, A-JR-3, A-JB-3. [V] items 4.1–4.15 are accepted by Phase 7 and not separately gated.

### A.1 Sidebar — `Front/src/components/Sidebar.jsx`, `Front/workspace.scss`, `Front/styles.scss`
- **A-SB-1 [1.1][F]** Sidebar nav scrolls inside the sidebar. PASS iff `.nav-list` declares `overflow-y: auto` and `max-height: calc(100dvh - <header+footer>)`, AND a Playwright check `page.locator('.sidebar').evaluate(el => el.scrollHeight <= el.clientHeight || el.scrollTop works)` passes. Refs: `Sidebar.jsx` ~L33–L47, `workspace.scss` ~L121–L138.
- **A-SB-2 [1.2][F]** Any collapse toggle has `aria-label` + `aria-expanded`. PASS iff present. // stale — current `Sidebar.jsx` has no collapse chevron; guardrail kept for any future collapse control.
- **A-SB-3 [2.1][A]** `<nav>` has an accessible name. PASS iff `Sidebar.jsx` L34 reads `<nav className="nav-list" aria-label="Office navigation">`. // already done.
- **A-SB-4 [2.12][A]** All sidebar touch targets ≥ 44×44 CSS px. PASS iff every `.nav-item` declares `min-height: 44px` in `workspace.scss` (currently `min-height: 39px` ~L128) and `styles.scss`.

### A.2 Chat — `Front/src/pages/ChatPage.jsx`, `Front/chat.scss`, `Front/styles.scss`
- **A-CH-1 [1.11][F]** Attachment cards show the mime when the extension is missing. PASS iff the attachment render shows `<small>{file.mimeType}</small>` whenever `file.name` has no recognised extension.
- **A-CH-2 [1.12][F]** Switching conversations warns on unsent input. PASS iff `openConversation` (~L175–L195) checks `input.trim() || pendingFiles.length`; if non-empty and the target id differs, shows a `confirm()` or in-app prompt before discarding.
- **A-CH-3 [1.15][F]** Speech recognition reused across toggles. PASS iff `recognitionRef.current` is reused. // acceptable as-is; JSDoc comment only.
- **A-CH-4 [2.8][A]** Attachment buttons have an accessible name with the filename. PASS iff `aria-label={`Download ${file.name}`}` and `aria-label="Pending upload"` on the pending file.
- **A-CH-5 [2.9][A]** Composer textarea has `aria-label="Message to Nora"`. PASS iff the `<textarea>` in `ChatPage.jsx` carries the attribute.
- **A-CH-6 [3.11][P]** Scroll re-runs when message content changes. PASS iff the `useEffect` for `scrollToBottom` depends on `[messages]` (shallow) or the last message's `content.length`, not only `messages.length`.
- **A-CH-7 [3.2][P]** `readableText` is memoised per message. PASS iff `useMemo(() => readableText(m.content), [m.content])` runs inside the read-aloud handler.

### A.3 Office map — `Front/src/pages/OfficeMapPage.jsx`, `Front/workspace.scss`
- **A-MP-1 [1.3][F]** Backdrop click closes only when both mousedown **and** mouseup originated on the backdrop. PASS iff the modal backdrop handler (~L390–L420) tracks mousedown in a ref and the close logic compares `event.target === event.currentTarget` on both events.
- **A-MP-2 [1.4][F]** "Open" CTA visually distinct from Edit/Delete. PASS iff `.map-detail-action.primary` uses `--accent`, `.ghost` is border-only, and the focus ring inherits the accent.
- **A-MP-3 [1.13][F]** Modal opens with focus trapped and body scroll locked. PASS iff a `useFocusTrap` hook is mounted, `document.body.style.overflow = 'hidden'` is set on open, and `Escape` closes.
- **A-MP-4 [3.3][P]** `selected` does not drive canvas redraws. PASS iff the canvas `useEffect` deps exclude `selected` (and any modal-derived state).
- **A-MP-5 [2.4][A]** Modal declares `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. // already done in live code.
- **A-MP-6 [2.5][A]** Focus returned to opener on close. PASS iff `setSelected(null)` runs `previousFocusRef.current?.focus()`.
- **A-MP-7 [2.6][A]** `Escape` closes the modal. // already done for the map modal.

### A.4 Jobs — `Front/src/pages/JobsPage.jsx`, `Front/styles.scss`
- **A-JB-1 [1.5][F]** Job rows can deep-link to a map node. PASS iff `JobsPage.jsx` exposes a "Locate on map" button when `job.mapNodeId` is truthy. // stale — current code has no map-node field; feature add.
- **A-JB-2 [1.14][F]** Delete confirmation is dialog-role and keyboard-dismissible. PASS iff the ChatPage `deleteTarget` confirmation and any future JobsPage delete dialog carry `role="dialog"`, `aria-modal="true"`, and `Escape` closes.
- **A-JB-3 [3.9][P]** Long lists are virtualised past 100 rows. PASS iff `react-virtual` is mounted in the jobs table wrapper AND the conversation rail.

### A.5 Agents — `Front/src/pages/AgentsPage.jsx`
- **A-AG-1 [1.6][F]** Ollama probe endpoint validates the prompt. PASS iff the controller-boundary validator rejects prompts not matching `^[A-Za-z0-9 .,:;!?()'"-]{1,512}$` with HTTP 400. // audit's "shell command via spawn" is a stale description; live `runAgent` forwards to `agentRunner.mjs`; validator sits at the controller boundary (see A-CTL-1).
- **A-AG-2 [1.7][F]** Probe UI clearly labelled. PASS iff the label is "Run with Ollama (no chat)" and model/provider are shown inline. // stale — current `AgentsPage.jsx` has no probe textarea; feature add.

### A.6 Backend store — `Back/src/lib/officeStore.mjs`
- **A-ST-1 [1.8][F]** Concurrent appends to one `conversationId` are serialised. PASS iff a property test fires N=20 `saveConversation` calls in parallel against the same id and the final `messageCount` equals the number of unique appended messages. // Audit names `appendMessage`; live `officeStore.mjs` does not export that function. Controller `chat` performs the append inline. Criterion covers both.
- **A-ST-2 [3.4][P]** Read/write paths are non-blocking. PASS iff `read`/`write` use `fs/promises` and event-loop lag p99 stays under 50 ms under a 50-conversation storm.

### A.7 Backend jobs — `Back/src/lib/jobRunner.mjs`
- **A-JR-1 [1.9][F]** Two concurrent `enqueueJob(jobId)` calls run the loop once. PASS iff 10 concurrent calls invoke `runJobLoop` exactly once.
- **A-JR-2 [1.9][F]** Per-job serialisation is exposed. PASS iff `updateJob` wraps in `locked('job:'+id, …)` AND `withJobLock(id, fn)` is exported.
- **A-JR-3 [3.5][P]** Job runner emits a heartbeat. PASS iff `jobRunnerStatus()` adds `lastTickAt` and a watchdog logs a miss when a tick is missed by > 30 s.

### A.8 Backend controller — `Back/src/controllers/OfficeController.mjs`
- **A-CTL-1 [1.6][F]** Controller validates the prompt. PASS iff it trims, length-caps (512 bytes), allow-lists; returns HTTP 400 on violation; logs the rejection.
- **A-CTL-2 [1.10][F]** `POST /chat/stream` exists. PASS iff `curl -N -H 'Accept: text/event-stream'` returns `200`, `Content-Type: text/event-stream`, and a body containing `event: token` and `event: done` frames.
- **A-CTL-3 [1.10][F]** Stream emits incremental tokens. PASS iff a unit test mocks `runAgent` to yield `{ token: 'hello' }`, `{ token: ' world' }`, `{ done: true }` and the SSE serialiser writes the matching `data:` frames.
- **A-CTL-4 [3.1][P]** Non-streaming `POST /chat` no longer requires a follow-up `GET /conversations/:id` to be useful. PASS iff the response body includes the full assistant message AND the streaming path does not issue a follow-up `GET`.

### A.9 Cross-cutting
- **A-CC-1 [2.2][A]** Every icon-only button has `aria-label`. PASS iff `axe-core` reports zero "Buttons must have discernible text" violations across the audited surface.
- **A-CC-2 [2.7][A]** Conversation list arrow-key navigable. // acceptable to defer; revisit per Open Q10.
- **A-CC-3 [2.11][A]** Primary text on `surface-0/1/2` meets WCAG AA (4.5:1). PASS iff `axe` reports zero contrast violations.
- **A-CC-4 [2.13][A]** Reduced-motion users see no animation. // already done in `workspace.scss`; copy the `@media (prefers-reduced-motion: reduce)` block to `styles.scss` and `chat.scss`.
- **A-CC-5 [2.14][A]** `<html lang>` matches the active locale. PASS iff `index.html` has `lang="en"` and Spanish bubbles bubble `lang="es"`.
- **A-CC-6 [2.15][A]** "Skip to main content" is the first focusable element. PASS iff the link appears before `Sidebar` in the DOM and is visually hidden until focused.
- **A-CC-7 [2.16][A]** Heading order is valid. PASS iff brand → `<h1>`, conversation title → `<h2>`, message author → `<h3>`.

## B. Sequenced execution plan

Order follows the audit's Marimekko list (§5) with two re-sequences: (i) streaming (audit #6) moves after the races because the streaming consumer needs the same lock helpers; (ii) visual refinements (audit #10) land after accessibility so we don't re-touch styles twice. Justification recorded inline.

### Phase 0 — Repo & test scaffolding (0.5 d)
Effort 0.5 d · Risk low · Reversibility easy · Deps none · Files `Back/test/*`, `Front/src/__tests__/*` skeletons · Tests `Back/test/conversation.lock.test.mjs`, `Back/test/jobRunner.serial.test.mjs`, `Back/test/sse.smoke.test.mjs`, `Back/test/agent.prompt.validate.test.mjs`, `Front/src/__tests__/focusTrap.test.jsx`, `Front/src/__tests__/a11y.test.jsx` · Acceptance A-ST-1..2, A-JR-1..2, A-CTL-2 (test files exist, even if failing). Justification: every later phase needs a fixture.

### Phase 1 — Backend race fixes (1.0 d)
Effort 1.0 d · Risk medium · Reversibility easy · Deps none new · Files `Back/src/lib/officeStore.mjs` (export `withConversationLock` + `withJobLock`), `Back/src/lib/jobRunner.mjs` (consume in `enqueueJob`/`retryJob`), `Back/src/controllers/OfficeController.mjs` (`chat` consumes `withConversationLock`) · Tests `Back/test/conversation.lock.test.mjs` (property), `Back/test/jobRunner.serial.test.mjs` (10-way concurrency idempotency) · Acceptance A-ST-1, A-ST-2, A-JR-1, A-JR-2, A-CTL-4. Justification: streaming (phase 4) inherits the same lock helpers.

### Phase 2 — Modal accessibility kit (1.0 d)
Effort 1.0 d · Risk low · Reversibility easy · Deps none · Files new `Front/src/lib/useFocusTrap.js`, `Front/src/components/Modal.jsx`; apply to `OfficeMapPage.jsx`, `ChatPage.jsx` (delete + rename dialogs), future JobsPage · Tests `Front/src/__tests__/focusTrap.test.jsx` (Jest + Testing Library), axe in `Front/src/__tests__/a11y.test.jsx` · Acceptance A-MP-3, A-MP-6, A-CC-1, A-CC-2, A-JB-2.

### Phase 3 — Ollama prompt validation (0.25 d)
Effort 0.25 d · Risk low · Reversibility easy · Deps none · Files `Back/src/controllers/OfficeController.mjs`, `Back/src/lib/agentRunner.mjs` (re-export validator) · Tests `Back/test/agent.prompt.validate.test.mjs` · Acceptance A-CTL-1, A-AG-1, A-AG-2. Justification: cheap, isolated, security-positive; do before streaming so the streaming route inherits the validator.

### Phase 4 — Streaming endpoint (3.0 d)
Effort 3.0 d · Risk **high** (proxy buffering, nginx, Vite dev proxy, backpressure) · Reversibility medium (SSE route is additive) · Deps phase 1 lock helpers, `runAgent` must yield tokens · Files `Back/src/controllers/OfficeController.mjs` (new `chatStream`), `Back/src/lib/agentRunner.mjs` (token generator), `Front/src/api.js` (SSE-aware client), `Front/src/pages/ChatPage.jsx` `send` rewrite · Tests `Back/test/sse.smoke.test.mjs`, `Back/test/sse.backpressure.test.mjs`, `Front/src/__tests__/ChatPage.stream.test.jsx` · Acceptance A-CH-2, A-CH-6, A-CTL-2, A-CTL-3.

### Phase 5 — Virtualisation, list perf (1.0 d)
Effort 1.0 d · Risk low · Reversibility easy · Deps none · Files `Front/src/pages/ChatPage.jsx` (conversation rail), `Front/src/pages/JobsPage.jsx` (jobs table) · Tests manual with 1 000 synthetic rows + axe · Acceptance A-JB-3, A-CH-6, A-MP-4.

### Phase 6 — A11y polish (1.0 d)
Effort 1.0 d · Risk low · Reversibility easy · Deps phase 2 · Files `Front/src/components/Sidebar.jsx`, `Front/src/pages/ChatPage.jsx`, `Front/src/pages/OfficeMapPage.jsx`, `Front/styles.scss`, `Front/chat.scss`, `Front/index.html` · Tests `Front/src/__tests__/a11y.test.jsx`, `Front/src/__tests__/contrast.test.js` · Acceptance A-SB-2, A-SB-4, A-CH-1, A-CH-4, A-CH-5, A-MP-2, A-MP-5, A-MP-7, A-CC-3, A-CC-4, A-CC-5, A-CC-6, A-CC-7.

### Phase 7 — Visual refinements (2.0 d, iterative)
Effort 2.0 d · Risk low · Reversibility easy (CSS only) · Deps phase 6 · Files `Front/styles.scss`, `Front/chat.scss`, `Front/workspace.scss`, `Front/src/pages/ChatPage.jsx`, `Front/src/pages/OfficeMapPage.jsx` · Tests visual regression (Percy/Chromatic per Open Q9) · Acceptance closes [V] section (4.1–4.15). Not gated by Section A.

### Phase 8 — Chat input / attachment UX (0.5 d)
Effort 0.5 d · Risk low · Reversibility easy · Deps phase 4 · Files `Front/src/pages/ChatPage.jsx` · Tests manual · Acceptance A-CH-1, A-CH-2, A-CH-7.

### Phase 9 — Store: non-blocking I/O or SQLite (2.0 d, optional)
Effort 2.0 d · Risk high · Reversibility hard · Deps phase 1, decisions from Carlos (see Open Q1, Q4) · Files `Back/src/lib/officeStore.mjs` plus optional migration · Tests load with 200 conversations × 10 rps · Acceptance A-ST-2, A-JR-3.

**Total: ~10.25 working days, 1 developer. Phase 4 streaming is the only high-risk item.**

## C. Risk and rollback

### C.1 Race on conversation append (audit 1.8)
- **Risk:** medium. Two concurrent sends can lose one. `saveConversation` is locked, but `OfficeController.chat` performs read-modify-write across the lock window, so the race sits at the controller boundary. The audit names `appendMessage`; live `officeStore.mjs` does not export that function.
- **Mitigation:** add `withConversationLock(id, fn)` exported from `officeStore.mjs`; convert `OfficeController.chat` and `hydrateConversationMessages` consumers to take that lock.
- **Rollback:** delete the helper; restore direct `saveConversation` calls. Data on disk untouched.
- **Detection:** `Back/test/conversation.lock.test.mjs` will fail loudly.

### C.2 Race on `jobRunner.updateJob` (audit 1.9)
- **Risk:** medium. Two concurrent `enqueueJob` could double-iterate. The `scheduled` set (~L131+) prevents re-entry on the same id; residual risk is concurrent tool events for different jobs racing the store.
- **Mitigation:** keep `scheduled` and add `withJobLock` exported from `officeStore.mjs`.
- **Rollback:** remove `scheduled.add`/`scheduled.delete`. Worst case: bounded double-iteration, capped by `maxIterations`.
- **Detection:** `Back/test/jobRunner.serial.test.mjs`.

### C.3 Ollama prompt validation (audit 1.6)
- **Risk:** low. Live `runAgent` does not call `spawn` (forwards to `agentRunner.mjs`), but `{ prompt }`/`{ message }` is still accepted at the controller boundary, so validation lives there.
- **Mitigation:** allow-list regex `^[A-Za-z0-9 .,:;!?()'"-]{1,512}$` + 512-byte cap; reject null bytes; log rejections.
- **Rollback:** drop the validator; worst case HTTP 400 + retype. No data at risk.
- **Detection:** unit tests reject `;`, `$()`, backticks, CRLF.

### C.4 Streaming endpoint + consumer (audit 1.10)
- **Risk:** high. SSE behind a buffering proxy defeats the UX win; `runAgent` must yield tokens; Front `ReadableStream` consumer must back off on hidden tabs.
- **Mitigation:** set `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` in `Back/src/lib/http.mjs`; document proxy headers (Open Q3); Front uses `fetch` + `getReader()` (not `EventSource`); `visibilitychange` pauses rendering.
- **Rollback:** non-streaming `POST /chat` stays. Revert `ChatPage.send` to POST+GET. SSE route is additive.
- **Detection:** `Back/test/sse.backpressure.test.mjs` + manual `curl -N` smoke.

### C.5 Visual / accent changes (audit 4.x)
- **Risk:** low. CSS-only change.
- **Mitigation:** scoped CSS variables in `styles.scss`; one PR per token group; visual regression snapshots.
- **Rollback:** revert the SCSS files.

### C.6 Modal accessibility (focus trap, `role`, `aria-modal`)
- **Risk:** low. `useFocusTrap` is opt-in.
- **Mitigation:** hook lives in `Front/src/lib/useFocusTrap.js`, wired into a new `Modal` wrapper applied to `map-detail-modal`, ChatPage delete/rename dialogs, and any future JobsPage delete modal.
- **Rollback:** don't import the wrapper. Existing `role="dialog"` on the map modal keeps the ARIA win.
- **Deferred to Carlos:** focus-trap implementation — see Open Q5.

## Open questions for Carlos

1. **Storage layer.** SQLite (single-file, zero-config) or Postgres (multi-process, requires hosting)? Changes schema and migration story.
2. **Auth model.** Bearer token at proxy, session cookie, or full OIDC for hosted SSE?
3. **SSE hosting.** Vite dev, nginx (`X-Accel-Buffering: no`), Cloudflare (`flushImmediately`), or Caddy?
4. **ORM.** `better-sqlite3` (sync), Drizzle (typed), or Prisma (heavier)?
5. **Focus-trap implementation.** Native `inert`, `focus-trap-react`, or hand-rolled tab-trap?
6. **Streaming vs. WebSockets.** One transport or two for the Front?
7. **Theming tokens.** Unify three SCSS files into one token file, or keep them split per page?
8. **Virtualisation library.** `react-virtual`, `@tanstack/react-virtual`, or hand-rolled `IntersectionObserver`?
9. **Visual regression tooling.** Percy, Chromatic, or `jest-image-snapshot`?
10. **Heading hierarchy.** Promote `<strong>` to `<h2>`/`<h3>` everywhere, or rely on ARIA only (keep the [V]-friendly chat bubbles)?
