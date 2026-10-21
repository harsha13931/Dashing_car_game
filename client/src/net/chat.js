import { useEffect, useState } from 'react';
import { socket } from './socket';

// ─── Room text chat: one shared message list for the room screen and the game ──
let messages = [];
let unread = 0;
let open = false;
const subs = new Set();
const notify = () => subs.forEach(fn => fn());

socket.on('chatHistory', (list) => { messages = Array.isArray(list) ? list.slice(-40) : []; unread = 0; notify(); });
socket.on('chat', (m) => {
    messages = messages.concat(m).slice(-40);
    if (!open && m.from !== socket.id) unread++;
    notify();
    newListeners.forEach(fn => fn(m));
});

const newListeners = new Set();
export function onChatMessage(fn) { newListeners.add(fn); return () => newListeners.delete(fn); }

export function sendChat(roomId, text) {
    const t = (text || '').trim();
    if (t) socket.emit('chat', { roomId, text: t.slice(0, 140) });
}
export function setChatOpen(v) { open = v; if (v) unread = 0; notify(); }
export function clearChat() { messages = []; unread = 0; notify(); }

export function useChat() {
    const [, force] = useState(0);
    useEffect(() => {
        const fn = () => force(n => n + 1);
        subs.add(fn);
        return () => subs.delete(fn);
    }, []);
    return { messages, unread };
}
