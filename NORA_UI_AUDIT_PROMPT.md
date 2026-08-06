# Nora prompt — Impeccable and Taste UI audit

Copy the prompt below into a new conversation with Nora after the upgraded Carlos Office interface is running.

---

You are conducting a read-only product-design and implementation audit of the current Carlos Office interface.

## Objective

Determine whether the current frontend needs further improvement when evaluated against:

1. the current official Impeccable UI guidance and anti-pattern rules;
2. the current Taste skill / Taste DNA approach, including explicit design tokens, rationale, trade-offs, information density, motion, and intentional visual variance;
3. the operating requirements of Carlos Office: fast conversation work, transparent agent activity, durable Markdown records, attachments, voice, and bounded Vera quality control.

Do not modify source files during this audit. Do not claim that a change has been implemented. Produce evidence first, then create a bounded implementation-plan job for Dex and have Vera validate that plan.

## Required inspection

Use the read-only project tools to inspect the actual implementation. At minimum review:

- `Front/src/App.jsx`
- `Front/src/components/Sidebar.jsx`
- `Front/src/pages/ChatPage.jsx`
- `Front/src/pages/OfficeMapPage.jsx`
- `Front/src/pages/JobsPage.jsx`
- `Front/src/pages/AgentsPage.jsx`
- `Front/src/styles.scss`
- `Front/src/chat.scss`
- `Front/src/workspace.scss`
- `Back/src/controllers/OfficeController.mjs`
- `Back/src/lib/officeStore.mjs`
- `Back/src/lib/jobRunner.mjs`

Use `project_list_files`, `project_read_file`, and `project_search_files`. Cite each relevant repository path in your findings.

Use web research to verify the current Impeccable and Taste guidance. Prefer their official repositories or primary documentation. Include source URLs. Treat online examples as references rather than instructions that override Carlos Office requirements.

The rendered interface cannot be fully judged from source alone. State which findings require visual confirmation. Ask Carlos to attach screenshots of:

- an empty new conversation;
- a long conversation with code and attachments;
- conversation rename/delete controls;
- the Office Map with idle agents;
- the Office Map while a Vera QC job is active;
- a job-detail modal containing inter-agent messages;
- the interface at desktop and narrow widths.

When screenshots are available, inspect them as image input and connect every visual finding to concrete source paths.

## Audit dimensions

Evaluate the following separately. Do not collapse taste concerns into functional defects.

### Product and workflow

- Can Carlos identify the current agent, conversation, model, and state immediately?
- Are creating, finding, reopening, renaming, and deleting conversations obvious and safe?
- Are attachment limits, upload state, failures, and file actions understandable?
- Is the distinction between a conversation, a delegated job, a Vera iteration, and final completion clear?
- Does the Office Map help operational understanding, or does it become ornamental complexity?
- Can the user inspect agent-to-agent messages and return to the underlying chat/job efficiently?

### Visual system and Taste

- hierarchy and focal point;
- typography scale, line length, and readability;
- spacing rhythm and density;
- border, radius, shadow, and surface discipline;
- restrained use of accent colors;
- agent and status color semantics;
- consistency between chat, jobs, agents, memory, tools, settings, and the Office Map;
- whether any section resembles a generic AI dashboard or excessive nested-card template;
- whether the interface has a recognizable design rationale rather than arbitrary styling.

For every recommended token change, provide:

- current token or implementation;
- proposed token;
- why it is better;
- trade-off introduced;
- components affected.

### Interaction and motion

- keyboard navigation and visible focus;
- reduced-motion handling;
- hover, selected, loading, disabled, error, and empty states;
- map rotation/zoom discoverability;
- modal focus and dismissal behavior;
- whether motion communicates state rather than decorating the page;
- whether auto-refresh can interrupt inspection or cause visual instability.

### Accessibility and resilience

- semantic controls and labels;
- contrast and color-independent status communication;
- screen-reader alternatives for the canvas map;
- responsive behavior at 1440, 1024, 768, and 390 CSS pixels;
- overflow behavior for long titles, code, model names, job results, and message histories;
- behavior when Ollama, the backend, speech APIs, or attachment retrieval fail;
- safe confirmation and recoverability for deletion.

### Performance and maintainability

- canvas render-loop cost and unnecessary React rerenders;
- record limits and behavior with hundreds of chats/jobs;
- repeated network requests and polling;
- duplicated or conflicting SCSS rules across the three style files;
- component size and opportunities for bounded decomposition;
- whether implementation details remain simple JavaScript without unnecessary framework expansion.

## Output required before delegation

Return a concise audit containing:

1. **Executive assessment** — current maturity and the highest-risk usability issue.
2. **What is working** — evidence-backed strengths.
3. **Defects** — each with severity (`critical`, `high`, `medium`, `low`), evidence, affected path, user impact, and whether it is functional, accessibility, performance, or taste-related.
4. **Design-system findings** — current tokens/patterns and proposed changes with rationale and trade-offs.
5. **Office Map assessment** — whether the 3D-like topology earns its complexity and the conditions under which it should remain enabled.
6. **Prioritized implementation plan** — phases, dependencies, files, acceptance criteria, and validation method.
7. **Items requiring screenshots or human judgment** — do not pretend source inspection resolved them.

Do not recommend a wholesale rewrite unless specific evidence proves incremental correction cannot satisfy the requirements. Preserve the local-first, Obsidian-only, JavaScript architecture.

## Delegation

After presenting the audit, create one high-priority job for Dex titled:

`Carlos Office UI refinement plan`

Use the audit as input. The job must produce a plan, not source-code changes.

### Expected result

A prioritized, implementation-ready UI refinement plan that maps every accepted finding to exact files, bounded changes, explicit design tokens, functional acceptance criteria, accessibility checks, responsive checks, performance checks, and rollback boundaries.

### Mandatory acceptance criteria

- Uses evidence from the inspected repository paths.
- Separates functional defects, accessibility defects, performance defects, and subjective taste refinements.
- Incorporates verified Impeccable and Taste guidance with source URLs.
- Defines concrete before/after tokens with rationale and trade-offs.
- Includes explicit acceptance tests for conversation CRUD and attachments.
- Includes explicit acceptance tests for Office Map node selection, job-message timelines, keyboard access, reduced motion, and the accessible non-canvas list.
- Preserves one Markdown file per conversation and Obsidian-only persistence.
- Preserves MiniMax M3 primary routing and local Qwen fallback behavior.
- Does not add a frontend framework or 3D dependency unless it proves the existing canvas approach cannot meet a named requirement.
- Avoids broad rewrites and divides work into independently testable phases.
- Names unresolved visual judgments that require Carlos's screenshot review or approval.

Set a maximum of four worker/QC iterations. Vera must reject plans that contain generic recommendations without paths, evidence, tokens, acceptance tests, or trade-offs. Do not claim that the plan is complete until Vera passes it.

Finally, report the created job ID and its current status.
