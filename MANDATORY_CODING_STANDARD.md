# Mandatory JavaScript and SCSS Coding Standard

## 1. Authority and scope

This document defines mandatory coding conventions for JavaScript projects using:

- `.mjs` for Node.js ECMAScript modules;
- `.js` for browser or shared JavaScript without JSX;
- `.jsx` for React components and pages;
- `.json` for static configuration when executable configuration is unnecessary.
- `.scss` for the single-entry, page-oriented styling architecture defined in this document.

TypeScript and TSX are intentionally excluded until explicitly adopted by the project owner.

When an agent's defaults conflict with this document, this document takes precedence. Existing project architecture and explicit task instructions remain authoritative.

The objective is readable, compact and maintainable code with high cohesion and low coupling. Code should be as simple as the behavior allows, without artificial abstraction, unnecessary indirection or excessive fragmentation.

## 2. File extensions and modules

| Extension | Required use |
| --- | --- |
| `.mjs` | Node.js backend modules and executable Node scripts |
| `.js` | Browser/shared logic without JSX |
| `.jsx` | React components, pages and JSX-rendering modules |
| `.json` | Static data or non-executable configuration |

Rules:

- All new backend modules use `.mjs`.
- Use ECMAScript modules exclusively.
- Do not introduce CommonJS, `require()` or `module.exports`.
- Import Node built-ins with the `node:` prefix.
- Backend relative imports include the complete extension.
- JSX must not appear in `.js` or `.mjs` files.
- Do not introduce `.ts` or `.tsx` files without explicit approval.

```js
import path from "node:path";

import axios from "axios";

import { recordRuntimeError } from "./runtimeErrors.mjs";
```

## 3. Formatting

- Use 2 spaces for indentation. Never use tabs.
- Use double quotes for JavaScript strings unless another delimiter avoids unnecessary escaping.
- End ordinary statements with semicolons. Block-bodied arrow-function declarations in backend controllers may omit the trailing semicolon after the closing brace, matching the established controller style.
- Keep lines at or below 120 characters when practical.
- Use the available horizontal space. Keep imports, function signatures, calls, short object literals and simple expressions on one line when they fit within 120 characters and remain readable.
- Do not vertically expand one argument, property, identifier or operator per line merely to make code look structured.
- Use trailing commas in multiline arrays, objects, imports and parameter lists.
- Keep opening braces on the declaration line.
- Use blank lines to separate distinct logical stages, not every sequential operation.
- Keep tightly related statements adjacent when their relationship is obvious.
- Avoid several unrelated statements on the same line.
- Conditions, guards and simple operations may use one line when the complete behavior remains immediately understandable.
- Expand code only when line length, branching, side effects or non-obvious structure make the compact form harder to read.

Preferred concise forms:

```js
if (!agentId) return null;
if (signal?.aborted) return null;

const label = agent.name || "Unknown agent";
const isActive = ["queued", "running"].includes(job.status);
```

Use a block when the condition performs multiple operations, has side effects or needs explanation:

```js
if (!response?.data) {
  console.error("[models] Provider returned an empty response.", { provider, model });
  recordRuntimeError({ provider, model, category: "empty-response" });
  return null;
}
```

## 4. Naming

### 4.1 Files

- React components: `AgentConfigurationForm.jsx`
- React pages: `OfficeMapPage.jsx`
- Hooks: `useRuntimeEvents.js`
- Backend and utility modules: `modelRouting.mjs`, `runtimeErrors.mjs`
- Tests: `modelRouting.test.mjs`, `AgentCard.test.jsx`
- Stylesheets follow the separate mandatory SCSS/BEM standard.

Avoid generic filenames such as `helpers.js`, `utils.js`, `common.js` or `misc.mjs`. Name files after the capability they own.

### 4.2 Identifiers

- Components and classes: `PascalCase`
- Variables and functions: `camelCase`
- Truly global immutable constants: `SCREAMING_SNAKE_CASE`
- Boolean values: `isActive`, `hasAccess`, `canRetry`, `shouldRefresh`
- Internal event handlers: `handleSave`, `handleModelChange`
- Callback props: `onSave`, `onModelChange`
- Hooks: `use` prefix
- Collections: plural nouns such as `agents`, `jobs`, `modelOptions`
- Maps and sets: names that explain their relationship, such as `agentById` or `allowedModelIds`

Use complete, meaningful words. Abbreviations are acceptable only when universally understood, including `id`, `url`, `api`, `http`, `html` and `json`.

## 5. Imports and exports

Order imports as follows:

1. Node built-ins
2. External packages
3. Internal modules
4. Styles and other deliberate side-effect imports

Separate import groups with one blank line.

Use named exports for utilities, hooks, constants and services. A default export is acceptable when a file contains one principal React component or page.

Backend controller APIs use `const` arrow functions, including async APIs, to match the established controller style:

```js
export const getAgent = (id) => activeAgents.get(id) ?? null;

export const loadEvents = async () => {
  // ...
}
```

Keep named imports on one line when they fit comfortably within the line limit. Wrap them only when length or scanability genuinely requires it.

Do not create barrel files that only re-export an entire directory. A barrel is justified only when it defines a deliberate, stable public boundary.

## 6. File and module structure

Order module contents as follows when applicable:

1. Imports
2. Constants
3. Small shared helpers
4. Principal implementation
5. Secondary exports

Size guidance:

- The soft file limit is approximately 600 lines.
- Files reaching 700 lines require decomposition unless keeping them together clearly preserves cohesion.
- Line count alone must not cause fragmentation into unrelated or single-use modules.
- A larger cohesive module is preferable to many tiny, tightly coupled files.
- Decompose by capability, responsibility or stable boundary—not arbitrary line ranges.

Backend responsibilities should remain clear:

- **Controller:** HTTP input, validation, status selection and response mapping.
- **Service:** business policy and orchestration.
- **Store/repository:** persistence and data retrieval.
- **Provider/adapter:** external APIs and integration-specific behavior.
- **Utility:** deterministic transformations reusable in more than one place.

React pages may coordinate a feature, but reusable controls, substantial independent views and shared behavior belong in components or hooks.

## 7. Functions and abstraction

Functions should operate at one abstraction level, or at most two closely related levels.

Do not create a new function merely because a block of code can technically be extracted. Extraction is justified when at least one of these conditions applies:

- the behavior is reused;
- the function represents a stable domain operation;
- the logic needs independent testing;
- extraction materially improves comprehension;
- the operation forms a meaningful side-effect boundary;
- the function is required by a framework callback or public interface.

Avoid chains of single-use wrapper functions that only rename or forward arguments. Do not split a readable workflow into many tiny functions invoked from one place.

Prefer cohesive workflows:

```js
const saveAgentConfiguration = async ({ agentId, draft }) => {
  const validation = validateAgentConfiguration(draft);
  if (!validation.valid) return { saved: false, errors: validation.errors };

  const record = await agentStore.save(agentId, normalizeAgentConfiguration(draft));
  if (!record) return { saved: false, errors: ["Configuration could not be saved."] };

  return { saved: true, record };
}
```

Avoid unnecessary forwarding layers:

```js
const saveAgent = input => saveAgentConfiguration(input);
const executeSave = input => saveAgent(input);
const handleAgentSave = input => executeSave(input);
```

Other rules:

- Use `const` by default.
- Use `let` only for deliberate reassignment.
- Never use `var`.
- Prefer early returns over deeply nested control flow.
- Do not mutate function parameters.
- Use an options object when several parameters belong to one operation.
- Pure functions are preferred for calculations and transformations.
- Local mutation is acceptable when it is simpler, contained and immediately visible.

## 8. High cohesion and low coupling

Every module should own a coherent capability. Related data and behavior should remain together. Modules should depend on the smallest practical public interface of other modules.

Mandatory principles:

- Keep feature-specific behavior inside its feature.
- Keep provider-specific behavior inside its adapter.
- Do not allow UI components to know persistence details.
- Do not allow stores to contain presentation logic.
- Avoid global mutable state.
- Pass dependencies explicitly when doing so materially improves testability or separation.
- Do not introduce dependency injection frameworks or abstraction layers without a demonstrated need.
- Avoid circular dependencies.
- Do not duplicate a rule that should have one authoritative implementation.
- Prefer a direct dependency over an elaborate abstraction used by only one caller.

## 9. Graceful failure and error handling

The default failure strategy is graceful termination of the affected operation, not application-wide interruption.

When recovery is possible:

1. Log the failure with `console.error` and useful context.
2. Record it in the project's runtime diagnostics when available.
3. Return a predictable neutral result such as `null`, `false`, `[]` or a structured failure object.
4. Allow the caller to decide how the UI or workflow continues.

```js
const readAgentConfiguration = async agentId => {
  try {
    return await agentStore.read(agentId);
  } catch (error) {
    console.error("[agents] Could not read agent configuration.", {
      agentId,
      message: error.message,
    });
    return null;
  }
};
```

Return values must be consistent. A function returning an object on success should normally return `null` or a documented failure object on failure, not several unrelated shapes.

Throwing is reserved for cases where continuing would be unsafe or misleading, including:

- invalid application startup configuration;
- corrupted state that cannot be safely interpreted;
- violated security or authorization boundaries;
- programmer errors or impossible internal invariants;
- framework boundaries that require rejected promises or thrown errors;
- transactions that must abort to prevent partial or inconsistent writes.

Even in these cases, throw the most specific available error and preserve the original cause.

Never:

- silently swallow an error;
- log credentials, tokens or complete sensitive provider responses;
- convert all failures into generic messages without context;
- return success after a failed required operation;
- continue an operation when doing so could corrupt data or create an unauthorized side effect.

Logs should include relevant identifiers such as `requestId`, `conversationId`, `agentId`, `provider`, `model` and duration.

## 10. Asynchronous code

- Prefer `async` and `await`.
- Every promise must be awaited, returned or deliberately detached with `void`.
- External calls must have a timeout.
- Long-running operations should support cancellation through `AbortSignal`.
- Retry only safe or idempotent operations.
- Retries must be bounded and use backoff.
- Do not retry validation, authentication or deterministic programming failures.
- Use `Promise.all` for independent parallel work.
- Keep work sequential when order, authorization, rate limits or data dependencies require it.
- Return a graceful failure result after retry exhaustion whenever the caller can safely continue.

## 11. React and JSX

- Components use functions.
- Components and hooks remain pure during rendering.
- Hooks are called only at the top level of React components or custom hooks.
- Effects synchronize with external systems; ordinary derived values should be calculated during render.
- Keep business policy out of JSX.
- API coordination belongs in the page or an actually reusable feature hook.
- Do not extract a custom hook used once unless it isolates substantial stateful behavior or materially improves testability.
- Do not declare components inside other components.
- Use semantic HTML before adding ARIA.
- Every form control requires an associated label.
- Buttons require an explicit `type`.
- List keys use stable identifiers when available.
- Avoid premature `useMemo` and `useCallback`.
- Inline event handlers are acceptable for one straightforward operation.
- Create a named handler when the event performs several operations, is reused or needs independent explanation.

Straightforward inline handler:

```jsx
<button type="button" onClick={() => onSelect(agent.agentId)}>
  Configure
</button>
```

Named handler for a workflow:

```jsx
const handleSave = async event => {
  event.preventDefault();
  if (!isValid || saving) return;

  const saved = await onSave(draft);
  if (!saved) console.error("[agents] Configuration was not saved.", { agentId: agent.agentId });
};
```

JSX may remain compact when the structure is short and obvious. Substantial sections, complex conditions and repeated markup should be formatted across lines for readability.

## 12. Conditions and concise code

Concise code is encouraged when it reduces noise without concealing behavior.

Appropriate uses include:

- guard clauses;
- null/default selection;
- direct property mapping;
- short predicates;
- compact lookup tables;
- simple JSX conditions;
- brief `map`, `filter` and `reduce` callbacks.

```js
const activeJobs = jobs.filter(job => ACTIVE_STATUSES.has(job.status));
const agentName = agent?.name || "Unknown agent";
if (!activeJobs.length) return [];
```

Expand the code when it contains multiple side effects, non-obvious precedence, substantial branching or behavior that would be difficult to debug in one line.

Avoid stair-step formatting where a simple call or lookup consumes many lines without adding clarity. Prefer:

```js
const tool = availableTools.find((item) => item.name === toolCall.name);
const response = await provider.generate({ model, messages, tools: modelTools });
await setTaskStatus(workflowId, taskId, "completed");
```

over unnecessary vertical expansion of the same expressions. Multiline formatting is appropriate when the compact expression would exceed the line limit or hide meaningful structure.

## 13. Constants and configuration

- Replace unexplained repeated literals with descriptive constants.
- Keep timeouts, retry limits, status values, breakpoints and quality thresholds in one authoritative location.
- Do not create constants for obvious values used once when the name adds no meaning.
- Do not centralize every numeric value; local values may remain local.
- Use frozen objects or sets for related constant values when mutation would be unsafe.

```js
const ACTIVE_STATUSES = new Set(["queued", "running"]);
const CHAT_TIMEOUT_MS = 300_000;
```

## 14. Comments and documentation

Comments explain:

- why a decision exists;
- constraints and trade-offs;
- unusual algorithms;
- provider-specific behavior;
- security or authorization boundaries;
- behavior that appears unnecessary but is required.

Do not comment obvious syntax. Do not leave commented-out code.

Use JSDoc for exported JavaScript APIs when callers need to understand parameters, return values, side effects, neutral failure values or exceptional behavior.

```js
/**
 * Loads one agent configuration.
 * Returns null when the record cannot be read safely.
 */
export const getAgentConfiguration = async agentId => {
  // ...
};
```

Temporary work must be traceable:

```js
// TODO(#142): Remove the compatibility path after stored configs reach version 10.
```

## 15. Validation and data boundaries

Validate once at the boundary. Valid boundaries are:

- HTTP input;
- persisted external data being loaded;
- provider response;
- tool invocation;
- filesystem/network operation.

Do not repeatedly validate internal objects created by our own code. Do not build custom schema frameworks. Do not implement JSON Schema validation engines. Do not create validator functions for obvious internal assignments.

- Validate HTTP bodies, query parameters, stored JSON and provider responses at their boundary.
- Normalize external data before passing it into domain logic.
- Never trust browser input or third-party responses solely because the expected shape is documented.
- Apply defaults deliberately and visibly.
- Reject or gracefully stop operations with unsafe or incomplete required data.
- Avoid spreading unvalidated request objects directly into stored records.

## 16. Testing

Automated tests are opt-in. Carlos explicitly controls whether tests exist.

- Do not create automated tests for features or bug fixes unless Carlos explicitly asks for tests.
- Do not require unit or regression tests as part of the standard completion checklist.
- Do not add a mandatory `test` script to the recommended package scripts.
- Tests are created or run only when Carlos explicitly requests them.

When Carlos does request tests:

- Test observable behavior rather than implementation details.
- Follow Arrange, Act, Assert.
- Unit tests must not require live external services.
- Make time, randomness and provider responses controllable.
- Test graceful failure values as well as successful output.
- Test timeout, cancellation and retry exhaustion paths.
- Test that failed required operations are not reported as successful.

Linting, syntax validation, compilation/build validation and ordinary runtime inspection are not tests and remain appropriate for every change.

Validation for BACKEND-only work:

1. `npm run lint`
2. `npm run check`

A production frontend build is required only when frontend code was changed, or when Carlos explicitly asks for it. Do not require a frontend build for a backend-only change.

This is a local single-user application, not an enterprise distributed system. Do not create transaction/atomic-write machinery for ordinary local configuration files unless data loss would be materially harmful. Do not build rollback, journaling, or temp-write frameworks for local JSON or Markdown persistence without a demonstrated need.

## 17. Tooling and enforcement

Use ESLint flat configuration for `.mjs`, `.js` and `.jsx` files. Include:

- `@eslint/js` recommended rules;
- `eslint-plugin-react-hooks` for React projects;
- project-specific rules enforcing 2-space indentation, semicolons and double quotes;
- checks for undefined identifiers, unreachable code and unsafe promise handling where supported.

Use Prettier only when its configuration matches this document. Formatting tools must not override the separate mandatory SCSS structure and BEM rules.

Recommended scripts:

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "check": "node --check server.mjs",
    "build": "vite build"
  }
}
```

A `test` script is not mandatory. Add one only when Carlos explicitly asks for automated tests.

## 18. SCSS entrypoint and file architecture

The frontend has exactly one stylesheet entrypoint: `main.scss`. The main JavaScript entry module imports that file once.

```js
import "./styles/main.scss";
```

Pages, components and feature modules must not import additional SCSS files directly. `main.scss` owns stylesheet assembly and load order.

Required structure:

```text
src/
├── main.mjs
└── styles/
    ├── main.scss
    ├── config.scss
    ├── themes.scss
    ├── chat.scss
    ├── office-map.scss
    ├── processes.scss
    ├── tools.scss
    ├── skills.scss
    ├── authorizations.scss
    ├── operations.scss
    └── settings.scss
```

Rules:

- `config.scss` contains compile-time constants and Sass variables.
- `themes.scss` contains complete runtime-selectable theme definitions.
- Every remaining SCSS file corresponds to one existing page.
- Every existing page has one corresponding SCSS file.
- Do not create SCSS files for pages that do not exist.
- Do not create separate component, utility, layout, reset or breakpoint SCSS files unless explicitly approved.
- A page stylesheet must not import another page stylesheet.
- The only non-page files assembled by `main.scss` are `config.scss` and `themes.scss`.

Example `main.scss`:

```scss
@use './config';
@use './themes';
@use './chat';
@use './office-map';
@use './processes';
@use './tools';
@use './skills';
@use './authorizations';
@use './operations';
@use './settings';
```

Use modern Sass `@use`; do not use deprecated Sass `@import`.

## 19. `config.scss`

`config.scss` is the authoritative source for compile-time styling configuration. It contains:

- mobile-first screen breakpoints;
- animation and transition durations;
- easing curves;
- z-index layers;
- overlay calculations and opacity constants;
- reusable numeric values required for Sass calculations;
- other global compile-time constants that do not change at runtime.

It must not contain page classes, component classes, theme selectors or page-specific dimensions.

Example:

```scss
$screen-sm: 36rem;
$screen-md: 48rem;
$screen-lg: 64rem;
$screen-xl: 80rem;

$transition-fast: 120ms;
$transition-standard: 200ms;
$transition-slow: 320ms;
$ease-standard: cubic-bezier(0.2, 0, 0, 1);

$layer-base: 0;
$layer-sticky: 20;
$layer-overlay: 100;
$layer-modal: 110;
$layer-toast: 120;

$overlay-light-opacity: 0.16;
$overlay-strong-opacity: 0.48;
```

Page stylesheets access these constants through an explicit namespace:

```scss
@use './config' as config;
```

Breakpoints must never be recreated or hardcoded inside page stylesheets.

## 20. `themes.scss` and dynamic themes

Every theme is a complete runtime-selectable set of:

- font families;
- font sizes and weights where theme-specific;
- spacing and padding density;
- foreground and background colors;
- border colors;
- accent and status colors;
- shadows and overlays;
- control and surface values required by every page.

Sass variables are compiled away and therefore cannot provide runtime theme switching. Dynamic theme values must use CSS custom properties defined by `themes.scss` and selected through one root attribute such as `data-theme`.

Each theme must define the complete required token contract. A theme must not depend on another theme for missing values.

```scss
:root,
[data-theme='light-comfortable'] {
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --density-xs: 0.25rem;
  --density-sm: 0.5rem;
  --density-md: 0.75rem;
  --density-lg: 1rem;
  --color-background: #f7f8fa;
  --color-surface: #ffffff;
  --color-text: #111827;
  --color-text-muted: #64748b;
  --color-border: #dbe2e8;
  --color-accent: #08a7bd;
  --color-danger: #dc3545;
  --overlay-modal: rgb(15 23 42 / 42%);
  --shadow-surface: 0 12px 32px rgb(15 23 42 / 12%);
}

[data-theme='dark-compact'] {
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --density-xs: 0.1875rem;
  --density-sm: 0.375rem;
  --density-md: 0.625rem;
  --density-lg: 0.875rem;
  --color-background: #0f172a;
  --color-surface: #172033;
  --color-text: #f8fafc;
  --color-text-muted: #94a3b8;
  --color-border: #334155;
  --color-accent: #22d3ee;
  --color-danger: #fb7185;
  --overlay-modal: rgb(2 6 23 / 72%);
  --shadow-surface: 0 12px 32px rgb(0 0 0 / 36%);
}
```

The root theme attribute is changed by the frontend without loading another stylesheet:

```js
document.documentElement.dataset.theme = selectedTheme;
```

CSS custom properties intentionally inherit from the selected root theme. This is the only approved styling inheritance mechanism. Sass inheritance, class inheritance and structural selector dependence are prohibited.

## 21. Page stylesheet structure

Every page stylesheet follows this exact order:

1. `config.scss` namespace import
2. Mobile-first base BEM class list
3. Media queries at the bottom, ordered from the smallest breakpoint to the largest

```scss
@use './config' as config;

.chat {}
.chat__history {}
.chat__conversation-list {}
.chat__conversation {}
.chat__conversation--active {}
.chat__main {}
.chat__composer {}

@media (min-width: config.$screen-md) {
  .chat {}
  .chat__history {}
  .chat__main {}
}

@media (min-width: config.$screen-lg) {
  .chat__history {}
  .chat__composer {}
}
```

Mandatory rules:

- Base declarations target mobile screens first.
- Use `min-width` media queries for progressive enhancement.
- All media queries are placed after the complete base class list.
- Media queries are ordered by ascending breakpoint.
- Media queries may only modify classes already declared in the base class list.
- Do not introduce a new class for the first time inside a media query.
- Do not place media queries between base class definitions.
- Use breakpoint variables from `config.scss`.
- A page stylesheet owns only the classes belonging to that page.

## 22. Independent atomic BEM classes

Every styled class must use BEM:

- Block: `.office-map`
- Element: `.office-map__workspace`
- Block modifier: `.office-map--inspecting`
- Element modifier: `.office-map__node--active`

In this standard, "atomic" means that each BEM class has one clear styling responsibility and can be understood independently. It does not mean adopting a utility-class framework.

Mandatory selector rules:

- One BEM class selector per rule.
- Do not group multiple classes into one rule with commas.
- Do not use selector nesting.
- Do not use Sass `@extend`.
- Do not use Sass placeholder selectors.
- Do not create class inheritance chains.
- Do not make a class depend on a particular ancestor selector.
- Do not use descendant selectors such as `.chat .button`.
- Do not use compound class selectors such as `.button.primary`.
- Do not use standalone state classes such as `.active`, `.hidden` or `.selected`; use BEM modifiers.
- Do not define the same class in several separate base blocks.
- Do not combine several classes because they currently share declarations; each class owns its declarations independently.
- Elements may inherit theme custom properties from the root theme, but must not inherit presentation through Sass or selector structure.

Avoid:

```scss
.chat__conversation,
.processes__process {
  display: flex;
  align-items: center;
}

.chat {
  .chat__conversation {
    padding: 1rem;
  }
}

.chat .button {}
.chat__conversation.active {}
```

Required:

```scss
.chat__conversation {
  display: flex;
  align-items: center;
  padding: var(--density-lg);
}

.chat__conversation--active {
  border-inline-start: 2px solid var(--color-accent);
}

.processes__process {
  display: flex;
  align-items: center;
  padding: var(--density-lg);
}
```

Repeated declarations are acceptable when independent BEM classes genuinely require the same presentation. Shared declarations must not be used as justification for grouped selectors, inheritance or an unrelated abstraction.

## 23. Layout and container policy

UI structure should use the fewest elements necessary for layout, semantics, accessibility and interaction.

Rules:

- Do not add wrapper elements solely to make styling easier when the parent or child can own the layout.
- Do not wrap every section in a card or container.
- Prefer open page composition, spacing and borders over nested surfaces.
- A container is justified when it owns layout, clipping, scrolling, positioning, a semantic section or an interactive boundary.
- Avoid nested containers with identical padding, backgrounds or borders.
- Prefer `display: flex` for primary layout.
- Use CSS Grid only when the layout is genuinely two-dimensional and Grid makes the relationship clearer.
- Do not use Grid for a simple row, column, toolbar, field pair or list.
- Set `min-width: 0` or `min-height: 0` on flex children when needed to prevent overflow.
- Apply overflow to the element that actually owns scrolling; do not add overflow defensively to unrelated ancestors.
- Avoid fixed heights unless the interface requires a bounded viewport region.
- Page-level vertical content must remain reachable and scrollable.

Preferred:

```scss
.operations__content {
  display: flex;
  flex-direction: column;
  gap: var(--density-lg);
  min-width: 0;
}
```

Use Grid only when justified:

```scss
.operations__metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--density-md);
}
```

## 24. SCSS declarations and theme usage

- Page styles consume runtime theme values through `var(--token-name)`.
- Do not hardcode theme colors, fonts or density values in page files.
- A page-specific measurement may remain local when it does not belong to the global theme or compile-time configuration.
- Use logical properties such as `margin-inline`, `padding-block` and `border-inline-start` when practical.
- Keep each class's declarations grouped by purpose: layout, box model, typography, appearance, interaction and animation.
- Do not use `!important` except to override an unavoidable third-party inline style, and document the reason.
- Avoid arbitrary z-index values; use the layers defined in `config.scss`.
- Animations and transitions use durations and easing from `config.scss`.
- Respect `prefers-reduced-motion` when animation is not essential.

```scss
.office-map__inspector {
  position: fixed;
  z-index: config.$layer-modal;
  display: flex;
  flex-direction: column;
  gap: var(--density-md);
  padding: var(--density-lg);
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: var(--shadow-surface);
  transition: transform config.$transition-standard config.$ease-standard;
}
```

## 25. Agent completion checklist

Before presenting or publishing code, the coding agent must verify:

- [ ] Only approved file types were introduced; no TypeScript or TSX was added.
- [ ] New backend modules use `.mjs` and explicit relative extensions.
- [ ] Indentation is 2 spaces.
- [ ] JavaScript strings use double quotes unless another delimiter is materially clearer.
- [ ] Straightforward imports, calls, guards, signatures and object literals use compact horizontal formatting instead of unnecessary vertical expansion.
- [ ] Backend controller APIs follow the established `const` arrow-function style.
- [ ] Naming communicates intent.
- [ ] The implementation is cohesive and does not introduce unnecessary abstraction.
- [ ] Single-use wrapper functions were not created without justification.
- [ ] Files at or above 700 lines were reviewed for capability-based decomposition.
- [ ] Straightforward logic is concise without becoming obscure.
- [ ] Recoverable failures log context and return a predictable neutral result.
- [ ] Exceptions are limited to unsafe, unrecoverable or framework-required cases.
- [ ] Required failures are not falsely reported as success.
- [ ] External calls have suitable timeout and cancellation behavior.
- [ ] React components and hooks remain pure.
- [ ] User input and external data are validated at their boundaries.
- [ ] Automated tests were not added unless Carlos explicitly requested them.
- [ ] Lint and backend syntax checks pass. A frontend build was run only if frontend code changed or Carlos requested it.
- [ ] Existing SCSS follows the mandatory mobile-first BEM standard in this document.
- [ ] `main.mjs` imports only `main.scss` for application styling.
- [ ] `main.scss` assembles `config.scss`, `themes.scss` and exactly one SCSS file per existing page.
- [ ] Breakpoints and compile-time styling constants come from `config.scss`.
- [ ] Each selectable theme defines a complete font, density and color token set in `themes.scss`.
- [ ] Page styles contain independent, non-nested BEM classes.
- [ ] No grouped class selectors, `@extend`, placeholders or structural class inheritance were introduced.
- [ ] Base styles are mobile-first and all media queries appear at the bottom in ascending order.
- [ ] Media queries only modify classes declared in the base class list.
- [ ] Containers and wrapper elements were minimized.
- [ ] Flexbox was preferred unless a genuinely two-dimensional layout justified Grid.
- [ ] Overflow is applied only to the element that owns scrolling.
- [ ] Theme colors, fonts and densities are not hardcoded in page files.

## References

- [Java Coding Standards and Best Practices](https://medium.com/@harikumarjogi333/java-coding-standards-and-best-practices-a-comprehensive-guide-8b74bbfe7f52)
- [Node.js ECMAScript modules](https://nodejs.org/api/esm.html)
- [React rules](https://react.dev/reference/rules)
- [ESLint configuration files](https://eslint.org/docs/latest/use/configure/configuration-files)
