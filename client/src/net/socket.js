import { io } from "socket.io-client";

// Explicit server URL if provided; otherwise the page's own origin in prod
// (single service), or localhost:3000 in dev.
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (import.meta.env.PROD ? window.location.origin : `http://${window.location.hostname}:3000`);

export const socket = io(SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    timeout: 10000,
});
