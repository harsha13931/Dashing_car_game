import { io } from "socket.io-client";

// Use relative path if served from same origin, otherwise fallback to dev defaults
const SERVER_URL = import.meta.env.PROD ? '/' : (import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`);
export const socket = io(SERVER_URL);
