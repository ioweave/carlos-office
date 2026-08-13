import { randomUUID } from 'node:crypto';
import { completeOperationalWork, extendOperationalLease, failOperationalWork, leaseNextOperationalWork } from './operationalStore.mjs';

const owner = `office-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const active = new Map();
let timer = null;
let pumping = false;
const concurrency = Math.max(1, Math.min(Number(process.env.OPERATIONAL_WORKER_CONCURRENCY || 4), 16));
const leaseMs = Math.max(30_000, Number(process.env.OPERATIONAL_WORKER_LEASE_MS || 180_000));

const handleRequest = async work => {
    const payload = work.payload || {}; const scheduled = work.kind === 'scheduled-request';
    const { bindConversationDelivery, queueOutboundForConversation } = await import('./channelGateway.mjs');
    const { markScheduleResult } = await import('./scheduleManager.mjs');
    if (scheduled && payload.delivery?.channel && payload.delivery.channel !== 'none') bindConversationDelivery(payload.conversationId, payload.delivery);
    const { default: OfficeController } = await import('../controllers/OfficeController.mjs');
    const response = await OfficeController.chat({ body: { conversationId: payload.conversationId, channel: scheduled ? 'schedule' : payload.channel, message: scheduled ? payload.prompt : payload.message } });
    if (Number(response?.statusCode || 500) >= 400) throw new Error(response?.body?.error || `Nora returned HTTP ${response?.statusCode || 500}.`);
    const delivery = queueOutboundForConversation(payload.conversationId, response?.body?.message?.content, { dedupeKey: scheduled ? `schedule-ack:${payload.scheduleId}:${payload.dueAt}` : `channel-ack:${payload.channel}:${payload.destination}:${payload.externalMessageId}` });
    if (scheduled) markScheduleResult(payload.scheduleId, { status: delivery.waitingAuthorization ? 'waiting_authorization' : response.statusCode === 202 ? 'running' : delivery.queued ? 'queued_delivery' : 'conversation_only' });
};

const handle = async work => {
    if (['channel-request', 'scheduled-request'].includes(work.kind)) return handleRequest(work);
    if (work.kind === 'channel-delivery') { const { deliverOutbound } = await import('./channelGateway.mjs'); return deliverOutbound(work.payload || {}); }
    if (work.kind === 'skill-review') { const { reviewVerifiedJobForSkill } = await import('./skillEvolution.mjs'); return reviewVerifiedJobForSkill(work.payload?.jobId); }
    // Retired queue kinds are completed rather than allowed to block the canonical queue.
    return { ignored: true, retiredKind: work.kind };
};

const run = work => {
    const heartbeat = setInterval(() => extendOperationalLease(work.workId, owner, leaseMs), Math.max(10_000, Math.floor(leaseMs / 3))); heartbeat.unref?.();
    const promise = Promise.resolve().then(() => handle(work)).then(() => completeOperationalWork(work.workId, owner)).catch(error => {
        if (work.kind === 'scheduled-request') void import('./scheduleManager.mjs').then(({ markScheduleResult }) => markScheduleResult(work.payload?.scheduleId, { status: 'failed', error: error.message })).catch(() => {});
        failOperationalWork(work, owner, error); console.error(`[operational-worker] ${work.kind}:`, error.message);
    }).finally(() => { clearInterval(heartbeat); active.delete(work.workId); setImmediate(pump); });
    active.set(work.workId, promise);
};

const pump = () => {
    if (pumping) return; pumping = true;
    try { while (active.size < concurrency) { const work = leaseNextOperationalWork({ owner, leaseMs }); if (!work) break; run(work); } }
    finally { pumping = false; }
};

export const startOperationalWorker = () => { if (!timer) { timer = setInterval(pump, Math.max(500, Number(process.env.OPERATIONAL_WORKER_POLL_MS || 1_000))); timer.unref?.(); pump(); } return operationalWorkerStatus(); };
export const stopOperationalWorker = async () => { if (timer) clearInterval(timer); timer = null; await Promise.allSettled([...active.values()]); };
export const operationalWorkerStatus = () => ({ running: Boolean(timer), active: active.size, concurrency });
