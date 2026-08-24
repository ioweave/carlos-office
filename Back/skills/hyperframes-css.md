---
name: hyperframes-css
description: Animations and interactions built with pure CSS (no JavaScript). Use for scroll-driven effects, hover micro-interactions, and motion that works without JS.
---

# Hyperframes (Pure CSS)

Create animations and interactions using only CSS — no JavaScript required.

## Techniques

- **CSS keyframes**: `@keyframes`, `animation` shorthand with duration/timing/fill-mode.
- **Transitions**: `transition` on transform/opacity for hover and state changes.
- **Scroll-driven animations**: use `animation-timeline: view()` or `scroll()` where supported.
- **Pseudo-elements**: `::before`/`::after` for layered effects.

## Principles

- Animate only composable properties (transform, opacity) for performance.
- Respect `prefers-reduced-motion: reduce`.
- Use cubic-bezier easing for natural movement; avoid excessive bounce.

## Checklist

- Runs with JS disabled.
- No layout thrash (no animating width/height/top/left where avoidable).
- Fallbacks provided for unsupported features.
- Clear focus and hover states.
.