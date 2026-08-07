import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export const runWithExecutionContext = (context, action) => storage.run({ ...context }, action);
export const getExecutionContext = () => storage.getStore() || {};
