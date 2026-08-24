---
name: find-skills
description: Discover and evaluate other Agent Skills (Vercel Labs approach). Use when Carlos needs to find, evaluate, or install community or official skills beyond the current registry.
---

# Find Skills

Locate and evaluate Agent Skills to extend capability.

## Approach

1. **Search sources**: official `anthropics/skills` repository, GitHub, and Vercel Labs skill catalogs.
2. **Evaluate**: confirm it is a folder with a `SKILL.md` containing YAML frontmatter (`name`, `description`) plus markdown instructions.
3. **Verify origin**: prefer official Anthropic, well-starred maintained repos, and MIT/clear licenses.
4. **Install**: bring the `SKILL.md` (and any bundled resources) into the local skills registry.
5. **Validate**: test the skill's guidance with a small representative task.

## Selection Criteria

- Purpose matches the use case.
- Maintained and documented.
- Avoids redundant or over-engineered layers.
- Does not require capabilities we cannot support.

## Reporting

Summarize discovered skills by origin, purpose, and operating mechanism, as was done for the Carlos Office skills catalog research.
.