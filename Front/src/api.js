import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://127.0.0.1:3002/api',
    timeout: 310000,
    headers: { 'Content-Type': 'application/json' },
});

export default api;
