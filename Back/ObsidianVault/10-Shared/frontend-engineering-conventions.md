---
title: "Frontend Engineering Conventions"
scope: "shared"
tags: ["frontend", "css", "scss", "bem", "responsive", "architecture"]
source: "Carlos"
---

# Frontend Engineering Conventions

These conventions are authoritative for Carlos Office and should be reused in future projects unless Carlos explicitly overrides them.

## CSS and SCSS

- Use **BEM** naming for frontend component classes: `block`, `block__element`, `block--modifier`.
- Do not create cascading "fix", "override", or "v2" stylesheets as a normal maintenance strategy.
- Keep one explicit stylesheet entrypoint and organize SCSS into readable domain partials.
- Build styles **mobile first**. Base rules target the smallest supported viewport; expand behavior with `min-width` media queries.
- Prefer component blocks over deeply nested selectors.
- Avoid `!important` except when integrating unavoidable third-party styles.
- Shared tokens belong in a dedicated tokens layer.
- Prefer CSS custom properties for theme values and runtime-adjustable design tokens.
- Keep responsive layout behavior near the block it modifies.
- When a component is substantially edited, migrate any legacy class names in that component to BEM rather than adding another compatibility override.

## UI behavior

- Preserve functionality while refactoring visual presentation.
- Chat interfaces should prioritize readable message width, stable wrapping, keyboard access, attachments, voice controls, and visible execution metadata.
- Responsive changes must not hide functionality without providing an equivalent accessible control.
- Test horizontal overflow, focus states, long text, code blocks, tables, and narrow viewport behavior before accepting UI work.

## Source authority

This note is a durable engineering convention. Live repository source remains authoritative for implementation details.
