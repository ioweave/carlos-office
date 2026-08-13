import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cleanupSessionSources, knowledgeLifecycleStatus } from './knowledgeLifecycle.mjs';
import { cleanupProcessRetention } from './processEngine.mjs';
import { ensureVault, getVaultPath } from './memoryCore.mjs';
import { OFFICE_PLATFORM_CONFIG } from '../platform.config.mjs';

let timer = null;
let lastRunAt = '';
let nextRunAt = '';
const intervalMs = Math.max(60_000, Number(process.env.RETENTION_CLEANUP_INTERVAL_MS || OFFICE_PLATFORM_CONFIG.retention.cleanupIntervalMs));

const policyContent = `---
title: "Knowledge and Retention Conventions"
retention-policy-version: "2"
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
- Process jobs, attempts, assessments, and redacted summaries are durable until deletion. Verbose tool results and activity events expire after the configured retention window.
- Conversation history and job receipts are not ambient memory and must not be injected merely because they are Markdown.
- Nora governs promotion, supersession, archive, and deletion. Iris performs knowledge maintenance and may delete/archive curated knowledge only through an exact Nora-approved retention directive.
- Prefer retaining the smallest useful unit. Do not keep raw search snippets, transient tool traces, intermediate model responses, or temporary session attachments after their lifecycle ends.
- Prefer archive over deletion when future value is uncertain. Do not delete rare but important authoritative material solely because it has not been used recently.
`;

const ensureRetentionPolicy = async () => {
    await ensureVault();
    const target = path.join(getVaultPath(), '10-Shared', 'knowledge-retention-conventions.md');
    try {
        const current = await fs.readFile(target, 'utf8');
        if (current.includes('retention-policy-version: "2"')) return false;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, policyContent, 'utf8');
    return true;
};

export const runRetentionMaintenance = async () => {
    const sessionSourcesRemoved = cleanupSessionSources();
    const processRetention = cleanupProcessRetention();
    const result = {
        sessionSourcesRemoved,
        processRetention,
        knowledge: await knowledgeLifecycleStatus(),
        ranAt: new Date().toISOString(),
    };
    lastRunAt = result.ranAt;
    return result;
};

export const retentionManagerStatus = () => ({
    running: Boolean(timer),
    intervalMs,
    lastRunAt,
    nextRunAt,
});

export const startRetentionManager = async () => {
    const seededPolicy = await ensureRetentionPolicy();
    const firstRun = await runRetentionMaintenance();
    if (!timer) {
        timer = setInterval(() => {
            runRetentionMaintenance()
                .catch(error => console.error('[retention] maintenance failed:', error.message))
                .finally(() => { nextRunAt = new Date(Date.now() + intervalMs).toISOString(); });
        }, intervalMs);
        timer.unref?.();
        nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    }
    return { intervalMs, seededPolicy, ...firstRun };
};

export const stopRetentionManager = () => {
    if (timer) clearInterval(timer);
    timer = null;
    nextRunAt = '';
};
