import { PassThrough } from 'node:stream';

const subscribers = new Set();

const matches = (subscriber, event) => (
    (!subscriber.workflowId || subscriber.workflowId === event.workflowId)
    && (!subscriber.conversationId || subscriber.conversationId === event.conversationId)
    && (!subscriber.jobId || subscriber.jobId === event.jobId)
);

const send = (stream, eventName, data, eventId = '') => {
    if (stream.destroyed) return;
    if (eventId) stream.write(`id: ${eventId}\n`);
    stream.write(`event: ${eventName}\n`);
    stream.write(`data: ${JSON.stringify(data)}\n\n`);
};

export const publishRuntimeEvent = event => {
    for (const subscriber of subscribers) {
        if (matches(subscriber, event)) send(subscriber.stream, 'runtime', event, event.eventId);
    }
};

export const createRuntimeEventStream = ({ workflowId = '', conversationId = '', jobId = '' } = {}) => {
    const stream = new PassThrough();
    const subscriber = {
        stream,
        workflowId: String(workflowId || ''),
        conversationId: String(conversationId || ''),
        jobId: String(jobId || ''),
    };
    subscribers.add(subscriber);
    stream.write('retry: 1500\n\n');
    send(stream, 'ready', { connected: true, at: new Date().toISOString() });
    const heartbeat = setInterval(() => {
        if (!stream.destroyed) stream.write(`: heartbeat ${Date.now()}\n\n`);
    }, 20_000);
    heartbeat.unref?.();
    const cleanup = () => {
        clearInterval(heartbeat);
        subscribers.delete(subscriber);
    };
    stream.once('close', cleanup);
    stream.once('error', cleanup);
    return stream;
};

export const runtimeEventStreamStatus = () => ({ subscribers: subscribers.size });

