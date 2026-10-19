import { io } from "socket.io-client";

// Prefer an explicit server URL; otherwise same-origin in prod (single service),
// or localhost:3000 in dev.
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (import.meta.env.PROD ? '/' : `http://${window.location.hostname}:3000`);
export const socket = io(SERVER_URL);
