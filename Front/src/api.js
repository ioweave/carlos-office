import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://127.0.0.1:3002/api',
    timeout: 2700000,
    headers: { 'Content-Type': 'application/json' },
});

export const runtimeEventsUrl = (filters = {}) => {
    const base = String(api.defaults.baseURL || '/api').replace(/\/$/, '');
    const url = new URL(`${base}/events`, window.location.origin);
    Object.entries(filters).forEach(([key, value]) => {
        if (value) url.searchParams.set(key, String(value));
    });
    return url.toString();
};

export default api;
