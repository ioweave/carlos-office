const errorText = error => [
    error?.message,
    error?.code,
    error?.response?.status,
    typeof error?.response?.data === 'string' ? error.response.data : error?.response?.data?.error,
].filter(Boolean).join(' ').toLowerCase();

const connectivityCodes = new Set([
    'EAI_AGAIN', 'ENETDOWN', 'ENETUNREACH', 'EHOSTDOWN', 'EHOSTUNREACH',
    'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND',
]);

export const connectivityErrorText = error => errorText(error);

export const isConnectivityFailure = error => {
    const requestUrl = String(error?.config?.url || '').toLowerCase();
    if (!error?.response && error?.code === 'ECONNREFUSED' && /localhost|127\.0\.0\.1|\[::1\]/.test(requestUrl)) {
        return false;
    }
    if (connectivityCodes.has(error?.code)) return true;
    if ([502, 503, 504].includes(error?.response?.status)) return true;

    const text = errorText(error);
    return [
        'network is unreachable',
        'no such host',
        'temporary failure in name resolution',
        'failed to connect',
        'unable to connect',
        'connection reset',
        'connection timed out',
        'i/o timeout',
        'context deadline exceeded',
        'cloud request failed',
        'upstream unavailable',
        'server disconnected',
        'offline',
    ].some(fragment => text.includes(fragment));
};
