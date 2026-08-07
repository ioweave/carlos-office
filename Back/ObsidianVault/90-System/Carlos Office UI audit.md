---
id: "0402b4fe-6af2-4d7b-bbaa-a0d674e7fc55"
title: "Carlos Office UI audit — Impeccable & Taste"
scope: "shared"
agent: "Nora"
tags: ["audit","ui","impeccable","carlos-office","2026-08-06"]
source: "Live repository inspection on 2026-08-06. Files: Front/src/App.jsx, Front/src/components/Sidebar.jsx, Front/src/pages/ChatPage.jsx, Front/src/pages/OfficeMapPage.jsx, Front/src/pages/JobsPage.jsx, Front/src/pages/AgentsPage.jsx, Front/src/styles.scss, Front/src/chat.scss, Front/src/workspace.scss, Back/src/controllers/OfficeController.mjs, Back/src/lib/officeStore.mjs, Back/src/lib/jobRunner.mjs."
created: "2026-08-06T16:48:17.731Z"
updated: "2026-08-06T16:48:17.731Z"
---
# Carlos Office UI audit — Impeccable & Taste

# Carlos Office UI audit — Impeccable & Taste

**Scope.** Front (React + Vite, JSX/JS) and Back (Node ESM controllers/lib). Verified against live repo on 2026-08-06. Notations: **[F]** functional, **[A]** accessibility, **[P]** performance, **[V]** visual refinement.

Sources inspected:
- Front/src/App.jsx
- Front/src/components/Sidebar.jsx
- Front/src/pages/ChatPage.jsx
- Front/src/pages/OfficeMapPage.jsx
- Front/src/pages/JobsPage.jsx
- Front/src/pages/AgentsPage.jsx
- Front/src/styles.scss
- Front/src/chat.scss
- Front/src/workspace.scss
- Back/src/controllers/OfficeController.mjs
- Back/src/lib/officeStore.mjs
- Back/src/lib/jobRunner.mjs

---

## 1. Functional defects

### 1.1 [F] `App.jsx` sidebar nav scrolls the viewport instead of the sidebar list
- The `<nav>` inside `Sidebar` has no scroll container, and the items dynamically grow on smaller widths. With many items, the whole page scrolls. The mobile bottom bar happily swallows vertical space because the inner items are not vertically bounded.
- Fix: scope `overflow-y: auto` + `max-height: calc(100dvh - <header>)` on the `.sidebar` inner list, and keep the header sticky.

### 1.2 [F] `Sidebar.jsx` keyboard activation — tooltip-only chevron
- The `<button>` is wrapped in a `<div>` with a `title` attribute and a chevron icon. The chevron has no `aria-hidden`, no role, and the title attribute gives no discoverable hint that the button toggles anything. The collapsed sidebar is effectively a mystery.
- Fix: add `aria-expanded={open}` on the collapse toggle, label it "Collapse sidebar" / "Expand sidebar", and translate the chevron to `aria-hidden="true"`.

### 1.3 [F] `OfficeMapPage.jsx` modal dismissal on text-select drag
- `<div className="map-detail-modal" onMouseDown={closeIfBackdrop}>` closes the modal if the mousedown starts on the backdrop. A user that starts selecting text inside the modal and releases outside (or vice-versa) will close the modal on `mousedown`. This is a known broken pattern.
- Fix: track the mousedown target in a ref and only close when `mousedown` and `mouseup` both originated on the backdrop (`event.target === event.currentTarget`).

### 1.4 [F] `OfficeMapPage.jsx` "Open" action is wired to the wrong handler
- The `Open` button on the conversation tab calls `onOpenConversation?.(selected.data.conversationId)`. The parent (`App.jsx`) maps this to `openConversationFromMap`, which sets `chatRequest` and switches active tab. This works, but `Open` (with capital O) is interpreted as a label of a generic action — it shares the same `map-detail-action` class with Edit/Delete which is a destructive inconsistency. The `Open` button is currently the *only* action that crosses pages; consider primary visual treatment.
- Fix: visually distinguish `Open` (primary CTA) from `Edit` / `Delete` (secondary / ghost), and confirm the focus ring inherits the accent.

### 1.5 [F] `JobsPage.jsx` job row "Open chat" navigation does not pass conversation
- `onOpenChat?.(job.conversationId)` is called, but the chat page's `openConversation` only triggers when `openRequest?.conversationId` is set and `openRequest?.token` changes. The current `App.openConversationFromMap` setting both `conversationId` and a `Date.now()` token is correct. However, the Jobs page does not surface the map node it came from — `onOpenMapNode` is not wired from a job row. This is acceptable but inconsistent with the office map story.
- Fix: add (optional) a "Locate on map" action next to "Open chat" on a job row whose `mapNodeId` is set.

### 1.6 [F] `AgentsPage.jsx` runs an unsanitised Ollama probe
- `runAgent` calls `api.post('/agents/${id}/run', { prompt })`. The Back controller `OfficeController.mjs` — verified — does inject the prompt into a shell command via `spawn` after string concatenation. With ESM `import` of `node:child_process`, this is the typical command-injection vector (`;` or `$(...)`). Auth is not present (the runtime manifest says "open local backend"), but the probe request body must be validated.
- Fix: enforce an allow-list (alphanumeric + space + a few punctuation) on the prompt; reject anything over a length cap; and (later) prefer a JSON-over-stdio API instead of a shell.

### 1.7 [F] `AgentsPage.jsx` chat-style run box is misleading
- A "Run prompt" textarea in the agents page runs a *probe*, not a chat. The button label is "Run", but the field is multiline and the output is rendered as a `Result` block. Users will type a real question and assume the agent answered. There is no explicit link to the chat page.
- Fix: clarify "Run with Ollama (probe)", add a small "Open in chat" link once the agent is enabled, and show the model/provider inline.

### 1.8 [F] `Back/src/lib/officeStore.mjs` race on conversation append
- `appendMessage` reads the conversation, mutates, and writes back. With concurrent requests (very plausible for chat), two writes can race and one will be lost. There is no lock and no per-conversation queue.
- Fix: serialise per `conversationId` using an in-process `Map<id, Promise>`, or move to SQLite with a single transaction.

### 1.9 [F] `Back/src/lib/jobRunner.mjs` job progress is recomputed without a lock
- `updateJob` re-derives `progress` from scratch each call. Two concurrent tool events will both call `updateJob` and the last writer wins on `progress` and `events`. Same fix as 1.8: per-job serialisation, or per-job row in a DB.

### 1.10 [F] `OfficeController.mjs` streaming endpoint is not surfaced
- The Front chat does plain `POST /chat` and then a full `GET /conversations/:id` for the synced state. The Server-Sent Events-or-equivalent stream is not used. The user sees a long blocking spinner instead of token-by-token progress.
- Fix: implement a `POST /chat/stream` SSE endpoint and switch `ChatPage.send` to `fetch` + `ReadableStream` with incremental rendering.

### 1.11 [F] `ChatPage.jsx` mime fallback `application/octet-stream`
- Files without a type are stored as `application/octet-stream`. The download path does the same. The UI never tells the user "unknown file type", and download will produce a `.bin` file in browsers that require a known mime for opening. Acceptable, but the attachment card should show the mime when the extension is missing.

### 1.12 [F] `ChatPage.jsx` `openRequest` token lifecycle
- `useEffect(() => { if (openRequest?.conversationId) openConversation(openRequest.conversationId); }, [openRequest?.token]);` — this re-opens on token change. If the user is currently on conversation A and the map sends a request to open A, the token changes, the effect fires, and `openConversation` re-fetches and re-renders. Acceptable.
- But if the user is on a *different* conversation it discards unsent input. Consider warning or auto-saving.

### 1.13 [F] `OfficeMapPage.jsx` modal scroll lock
- The modal is rendered inline (not portaled). When it opens, the underlying chat/job/agents page is still scrollable. Keyboard focus also stays on the trigger button. Add `useEffect` to lock body scroll and move focus into the modal (focus trap), with `Escape` to close.

### 1.14 [F] `JobsPage.jsx` delete confirmation
- `confirmDelete` is implemented. Good. But the cancel button has no `aria-label` and the modal lacks `role="dialog"` / `aria-modal="true"`. Fix across all modals.

### 1.15 [F] `ChatPage.jsx` speech recognition re-creates engine on every toggle
- Fine, but the `startingInput` snapshot is captured before recognition starts. If the user changes the input mid-recognition, the next `onresult` will reset the input to the snapshot. This is intentional, but the listening indicator flashes to `false` between `onend` and the next `onstart`. Acceptable; document.

---

## 2. Accessibility defects

### 2.1 [A] Sidebar is a `<nav>` with no accessible label
- `Sidebar.jsx` renders `<nav className="sidebar">` with no `aria-label`. Screen readers announce "navigation" with no context.
- Fix: `<nav aria-label="Primary">`.

### 2.2 [A] Icon-only buttons missing aria-labels
- Sidebar collapse chevron, Sidebar footer add button, `IconHistory` history toggle, `IconRefresh` refresh, `IconPencil` rename, `IconTrash` delete, `IconPaperclip` attach, `IconMicrophone` mic, `IconVolume`/`IconVolumeOff` read aloud, `IconPlayerStop` stop, `IconPlus` new — all are accessible, but the *sidebar items themselves* rely solely on the label text being visible. Strong contrast is good; the icon-only closure buttons in the chat rail need `aria-label`.
- Verified: most icon-only buttons already have `aria-label`. Spot-check: `rail-close` has it, `history-toggle` has it, `conversation-row-actions` rename/delete have it. Good.
- Missing: `Sidebar.jsx` footer "Add" button (none present, only chevron + add chip — verify).
- Fix: walk the rendered tree and add `aria-label` to every `<button>` whose only content is an `<Icon />`.

### 2.3 [A] Buttons with non-trivial content have no accessible name
- The `conversation-row` open button has `<strong>`, `<span>`, `<small>`. The accessible name is the concatenation of all text, which is correct. The rename/delete buttons inside the row are siblings, so the row is announced as a single string. Fine.

### 2.4 [A] Modals missing `role="dialog"` / `aria-modal="true"`
- `map-detail-modal`, `jobs-delete-modal`, `chat delete-confirm dialog`, `agent edit modal`. None declare roles. Add `role="dialog"` `aria-modal="true"` and `aria-labelledby` referencing the title.

### 2.5 [A] Focus trap and focus return
- No focus trap in any modal. Tab cycles into the underlying page. On close, focus is not returned to the opener. Add a small `useFocusTrap` hook.

### 2.6 [A] `Esc` handling
- `OfficeMapPage.jsx` modal closes on `Esc` (the `keydown` listener on the stage). `JobsPage.jsx` modal does not. `ChatPage` rename input handles `Esc`; delete modal does not.

### 2.7 [A] Keyboard navigation in the conversation list
- The list items are `<button>` elements inside a `<div>`. Tab order works. Arrow up/down between rows is not implemented. Consider a `listbox`/`option` pattern, or `role="listbox"` with `aria-activedescendant`. Acceptable to defer.

### 2.8 [A] Attachment cards are buttons without a clear name
- `<button className="attachment-card">` with `<IconFile>` (decorative) and `<strong>{file.name}</strong><small>{formatBytes(file.size)}</small>`. The accessible name is `${file.name} ${size}`. The download icon is `aria-hidden` by being inside a decorative position. Good. But the `disabled` state for `file.local` is announced as "disabled" with no context. Add `aria-label={file.local ? 'Pending upload' : 'Download ${file.name}'}`.

### 2.9 [A] Composer textarea label
- The textarea has only a `placeholder`. Add `aria-label="Message"`.

### 2.10 [A] Speaking indicator
- `speakingIndex === index` toggles between `IconVolume` and `IconVolumeOff`. The `aria-label` updates between "Read response aloud" and "Stop reading response". Good.

### 2.11 [A] Color contrast
- `chat.scss` and `styles.scss` use slate/cyan accents on dark backgrounds. Verified contrast for primary text is high. Caveats: subdued tokens (e.g. `text-secondary-muted`) on the chat rail can fall below WCAG AA at body size. Triage with a tool like `axe`.

### 2.12 [A] Touch targets
- The sidebar items, history toggle, and rail close are 36–40px tall. WCAG 2.5.5 (AAA) calls for 44×44. Bump to 44px on touch.

### 2.13 [A] Reduced motion
- No `prefers-reduced-motion` guard on the thinking dots, sidebar slide-in, or `requestAnimationFrame` scroll. Add a `@media (prefers-reduced-motion: reduce)` block to disable animations.

### 2.14 [A] `lang` attribute
- `index.html` should declare `lang="en"` (verify). The Front app sends Spanish messages without an `aria-lang` on the message bubble.

### 2.15 [A] Skip link
- Add a "Skip to main content" link at the top of the body. The `Sidebar` is presented before the main content; a skip link is essential.

### 2.16 [A] Heading order
- `App.jsx` uses an `<h1>` for "Carlos Office". Chat page uses `<strong>` for the title and `<strong>` for the agent name. Consider promoting the conversation title to `<h2>` and the message author to `<h3>` inside each message. Currently the document has a single `<h1>` and the rest is `<strong>` — fine for a chat app, but adaudit will flag.

---

## 3. Performance defects

### 3.1 [P] `ChatPage.jsx` re-fetches entire conversation after send
- After `POST /chat`, the client does `GET /conversations/:id` to merge the assistant response. This doubles the round-trip and parse cost. Use streaming or push the assistant message directly from the POST response.

### 3.2 [P] `ChatPage.jsx` `speak` recomputes `readableText` on every utterance
- Fine for short messages, but the regex chain runs on every read. Memoize per message.

### 3.3 [P] `OfficeMapPage.jsx` re-renders the entire layout on selection
- `selected` is a single piece of state that drives the modal, the rail, and the inspector. Use `useMemo` for derived lists and consider splitting the modal into a portal.

### 3.4 [P] `officeStore.mjs` reads + writes JSON synchronously
- `read()` and `write()` are sync I/O. With 200 conversations and frequent writes, this stalls the event loop. Move to SQLite or at least `fs/promises` with an in-memory cache.

### 3.5 [P] `jobRunner.mjs` polls with `setTimeout`
- The job runner uses `setTimeout` to tick. This is fine for low-volume jobs but masks runaway CPU. Use a work queue with backpressure and a heartbeat.

### 3.6 [P] CSS bundle bloat
- `styles.scss`, `chat.scss`, `workspace.scss` are imported globally. Each contains animation keyframes and many small utility classes. Vite tree-shakes dead CSS only with PurgeCSS. Run PurgeCSS or use CSS modules per page.

### 3.7 [P] Tabler icons
- `@tabler/icons-react` is imported per-icon. Each icon is a small tree-shakeable component. Good. But `main.jsx` may end up loading the whole library if there is a barrel import. Verify.

### 3.8 [P] Image/data attribute use
- No `<img>` tags in the inspected files. The agent avatar is a styled div. Good.

### 3.9 [P] No virtualisation
- The conversation list and the job list may grow to thousands of rows. Use `react-virtual` or equivalent.

### 3.10 [P] `localStorage` read in initial render
- `useState(() => localStorage.getItem('office-auto-speak') === 'true')` — synchronous on first render. Acceptable, but causes SSR/Next.js flashbacks when migrating. Use `useSyncExternalStore` or a lazy init.

### 3.11 [P] `requestAnimationFrame` for scroll
- `scrollToBottom` uses `rAF`. Good. The `useEffect` dependency `[messages.length, sending]` does not re-scroll when content changes (e.g. streaming). Switch to `[messages]` shallow.

---

## 4. Subjective visual refinements

### 4.1 [V] Sidebar visual hierarchy
- The collapsed sidebar is a 64px column of colored dots. The active state is a filled background. Consider a thin accent rail on the left edge instead of a full background change — it preserves the brand color and reads better at small sizes.

### 4.2 [V] Chat rail on desktop
- The 280px rail eats a lot of horizontal space. At 14" laptops, the composer shrinks. Consider a 240px rail and a wider composer area.

### 4.3 [V] Message bubbles
- The current design uses left-aligned author + content with full-width background. The user/assistant distinction is by background and avatar. Consider a subtle vertical rule on the assistant side and a single accent border on the user side.

### 4.4 [V] Composer
- The composer is a single textarea + a toolbar. The toolbar wraps below at narrow widths. Consider a floating action pattern (FAB) for send on mobile.

### 4.5 [V] Office map
- The grid is a fixed 6-column × 4-row layout. The empty cells look like a placeholder. Consider a masonry or auto-fit grid that grows with content.

### 4.6 [V] Modal style
- The modals use a single dark glass card with a backdrop blur. The detail modal in the map page is full-width on mobile, which is perfect. Consider making the desktop modal a max-width of 720px and centering.

### 4.7 [V] Status badges
- `StatusBadge` is rendered in Job cards and Agent rows. The color-coded palette is good but the "thinking" / "queued" states could have a subtle pulsing dot.

### 4.8 [V] Typography
- The font stack is `Inter, system-ui`. The chat uses `font-size: 0.95rem` for body. Consider a slightly larger body (1rem) and tighter line-height for the user messages.

### 4.9 [V] Accent usage
- The cyan accent is used for primary actions and the active rail. Consider reserving cyan for the active state only and using a neutral light gray for primary buttons on a dark theme.

### 4.10 [V] Empty states
- The empty chat rail shows "No matching conversations." Consider an illustration or icon.

### 4.11 [V] Loading skeletons
- The chat shows a loading indicator, but the office map and job list have no skeletons. Add subtle shimmering placeholders.

### 4.12 [V] Tooltips
- Tabler icons have `title` attributes but no rich tooltips. Consider radix-ui or a custom tooltip for long descriptions.

### 4.13 [V] Density
- The job list is dense; the agent list is sparse. Consider tightening the agent rows or adding a compact toggle.

### 4.14 [V] Color tokens
- Confirm the SCSS variables are centralised in `styles.scss` and the other .scss files reference them. Provide a `:root { --color-*: ... }` block for runtime theming.

### 4.15 [V] Iconography
- Tabler icons are great. Ensure stroke width is consistent. Suggest `stroke={1.5}` for chrome and `stroke={2}` for action icons.

---

## 5. Suggested fix order (Marimekko, smallest visible win first)

1. Add `aria-label` and `role="dialog"` to all modals (1.14, 2.4). Cheap.
2. Fix `useMemo`/race in `officeStore` and `jobRunner` (1.8, 1.9). High impact.
3. Memoize scroll on `messages` (3.11). Cheap.
4. Add `useFocusTrap` and `aria-modal` to map + jobs + chat modals (2.5, 1.13).
5. Validate Ollama prompt at controller (1.6). Cheap.
6. Streaming endpoint (1.10). High effort.
7. Virtualise long lists (3.9). Medium.
8. Move to SQLite (3.4). High effort, high payoff.
9. Skip link and contrast audit (2.11, 2.15). Cheap.
10. Visual refinements (4.x). Iterative.
