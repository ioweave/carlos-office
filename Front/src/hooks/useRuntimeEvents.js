import { useEffect, useRef } from 'react';
import { runtimeEventsUrl } from '../api';

export default function useRuntimeEvents(onEvent, { conversationId = '', workflowId = '', jobId = '', fallbackMs = 5_000 } = {}) {
    const callbackRef = useRef(onEvent);
    callbackRef.current = onEvent;

    useEffect(() => {
        let fallback = null;
        let closed = false;
        const invoke = event => {
            if (closed) return;
            let payload = null;
            try { payload = event?.data ? JSON.parse(event.data) : null; } catch {}
            callbackRef.current?.(payload);
        };
        const startFallback = () => {
            if (fallback || !fallbackMs) return;
            fallback = window.setInterval(() => callbackRef.current?.({ type: 'runtime.fallback' }), fallbackMs);
        };
        const stopFallback = () => {
            if (fallback) window.clearInterval(fallback);
            fallback = null;
        };

        if (!window.EventSource) {
            startFallback();
            return () => { closed = true; stopFallback(); };
        }

        const source = new EventSource(runtimeEventsUrl({ conversationId, workflowId, jobId }));
        source.addEventListener('runtime', invoke);
        source.addEventListener('ready', invoke);
        source.onopen = stopFallback;
        source.onerror = startFallback;
        return () => {
            closed = true;
            stopFallback();
            source.close();
        };
    }, [conversationId, workflowId, jobId, fallbackMs]);
}
