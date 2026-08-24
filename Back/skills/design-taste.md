---
name: design-taste
description: Synthesis of the taste, impeccable, and emilkowalski skills for distinctive design systems, UI polish, and tasteful motion. Use when designing new interfaces, refining existing UI (types, fonts, spacing), or adding motion to sites.
---

# Design Taste

Apply when building or reshaping frontend UI. Follow a two-pass process: brainstorm, critique, build, critique.

## Aesthetic Direction

1. Choose a distinct design philosophy (e.g., brutalist, editorial, neo-brutalist, Swiss, organic) before writing markup.
2. Reject templated defaults (Bootstrap look, generic SaaS cards).
3. Pick 1-2 typefaces deliberately, a restrained palette (max 3-4 hues), and a clear spacing scale.

## UI Polish (impeccable)

Audit every interface against these dimensions:
- **Types**: consistent type scale, no orphan headers, proper line-height and letter-spacing.
- **Fonts**: correct weights, fallbacks, legible contrast.
- **Spacing**: consistent 4/8px grid, balanced whitespace, aligned edges.
- **Rendering**: no clipping, overflow, or layout shift.

## Motion (emilkowalski)

Motion should be purposeful, not decorative:
- Use tasteful transitions: fades, subtle scale, 150-300ms durations, cubic-bezier easing.
- Prefer transform/opacity for performance; respect `prefers-reduced-motion`.
- Motion should reinforce hierarchy and state change.

## Critique Loop

Before shipping, critique against: clarity, hierarchy, consistency, accessibility (contrast, focus states, reduced motion). Refine and repeat.