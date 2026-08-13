import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export const runWithExecutionContext = (context, action) => storage.run({ ...context }, action);
export const getExecutionContext = () => storage.getStore() || {};
export const mergeExecutionContext = input => ({
    ...getExecutionContext(),
    ...Object.fromEntries(Object.entries(input || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')),
});
