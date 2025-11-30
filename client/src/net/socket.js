import { io } from "socket.io-client";

// Use environment variable in production, fallback to current hostname in development
const SERVER_URL = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`;
export const socket = io(SERVER_URL);
