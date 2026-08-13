---
title: "Knowledge and Retention Conventions"
scope: "shared"
tags: ["knowledge", "memory", "retention", "sources", "conversations", "jobs"]
source: "Carlos"
status: "active"
---

# Knowledge and Retention Conventions

Carlos Office persists conversations by default and governs other knowledge by lifecycle.

- Every conversation and its retained attachments are saved to durable conversation storage as messages arrive.
- Session sources are temporary runtime context and expire automatically.
- Project sources and project knowledge are retained only for the relevant project lifecycle.
- Universal knowledge is deliberately curated for reuse across projects and chats.
- Nora may retain small stable facts in compact remembered-fact memory without treating the surrounding conversation as ambient memory.
- Agent-specific Markdown stores reusable procedural lessons, not routine execution traces.
- Active and recent job traces live in volatile memory. Persistent jobs are compact recovery records/receipts.
- Conversation history and job receipts are not ambient memory and must not be injected merely because they are Markdown.
- Nora governs promotion, supersession, archive, and deletion. Iris performs knowledge maintenance and may delete/archive curated knowledge only through an exact Nora-approved retention directive.
- Prefer retaining the smallest useful unit. Do not keep raw search snippets, transient tool traces, intermediate model responses, or temporary session attachments after their lifecycle ends.
- Prefer archive over deletion when future value is uncertain. Do not delete rare but important authoritative material solely because it has not been used recently.
