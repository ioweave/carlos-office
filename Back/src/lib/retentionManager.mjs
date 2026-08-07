import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cleanupTemporaryConversations, temporaryConversationStatus } from './temporaryConversations.mjs';
import { cleanupSessionSources, knowledgeLifecycleStatus } from './knowledgeLifecycle.mjs';
import { jobTraceStatus } from './jobLifecycle.mjs';
import { ensureVault, getVaultPath } from './memoryCore.mjs';

let timer = null;
const intervalMs = Math.max(60_000, Number(process.env.RETENTION_CLEANUP_INTERVAL_MS || 600_000));

const ensureRetentionPolicy = async () => {
    await ensureVault();
    const target = path.join(getVaultPath(), '10-Shared', 'knowledge-retention-conventions.md');
    try { await fs.access(target); return false; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `---
title: "Knowledge and Retention Conventions"
scope: "shared"
tags: ["knowledge", "memory", "retention", "sources", "conversations", "jobs"]
source: "Carlos"
status: "active"
---

# Knowledge and Retention Conventions

Carlos Office uses promotion-based persistence.

- New conversations are temporary. Persist a conversation only when Carlos explicitly saves it.
- Session sources are temporary runtime context and expire automatically.
- Project sources and project knowledge are retained only for the relevant project lifecycle.
- Universal knowledge is deliberately curated for reuse across projects and chats.
- Nora may retain small stable facts in compact remembered-fact memory without saving the surrounding conversation.
- Agent-specific Markdown stores reusable procedural lessons, not routine execution traces.
- Active and recent job traces live in volatile memory. Persistent jobs are compact recovery records/receipts.
- Saved chats and job receipts are not ambient memory and must not be injected merely because they are Markdown.
- Nora governs promotion, supersession, archive, and deletion. Iris performs knowledge maintenance and may delete/archive curated knowledge only through an exact Nora-approved retention directive.
- Prefer retaining the smallest useful unit. Do not keep raw search snippets, transient tool traces, intermediate model responses, or temporary attachments after their lifecycle ends.
- Prefer archive over deletion when future value is uncertain. Do not delete rare but important authoritative material solely because it has not been used recently.
`, 'utf8');
    return true;
};

export const runRetentionMaintenance = async () => {
    const temporaryConversationsRemoved = cleanupTemporaryConversations();
    const sessionSourcesRemoved = cleanupSessionSources();
    const traces = jobTraceStatus();
    return {
        temporaryConversationsRemoved,
        sessionSourcesRemoved,
        activeTemporaryConversations: temporaryConversationStatus().count,
        jobTraces: traces.traces,
        knowledge: await knowledgeLifecycleStatus(),
        ranAt: new Date().toISOString(),
    };
};

export const startRetentionManager = async () => {
    const seededPolicy = await ensureRetentionPolicy();
    const firstRun = await runRetentionMaintenance();
    if (!timer) {
        timer = setInterval(() => {
            runRetentionMaintenance().catch(error => console.error('[retention] maintenance failed:', error.message));
        }, intervalMs);
        timer.unref?.();
    }
    return { intervalMs, seededPolicy, ...firstRun };
};

export const stopRetentionManager = () => {
    if (timer) clearInterval(timer);
    timer = null;
};
