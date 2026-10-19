// ─── Seat persistence ──────────────────────────────────────────────────────
// A random token identifies this browser to the server, and the room you are
// in is remembered, so closing the tab / switching apps / a dropped connection
// doesn't cost you your room — on return we ask the server to 'resume' it.

const TOKEN_KEY = 'dasharena.token';
const ROOM_KEY = 'dasharena.room';

function randomToken() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
    let t = '';
    for (let i = 0; i < 32; i++) t += Math.floor(Math.random() * 16).toString(16);
    return t;
}

export function getToken() {
    try {
        let t = localStorage.getItem(TOKEN_KEY);
        if (!t) { t = randomToken(); localStorage.setItem(TOKEN_KEY, t); }
        return t;
    } catch (_) {
        if (!getToken._mem) getToken._mem = randomToken();
        return getToken._mem;
    }
}

export function saveRoom(id) {
    try { localStorage.setItem(ROOM_KEY, JSON.stringify({ id, at: Date.now() })); } catch (_) { /* ignore */ }
}

export function clearRoom() {
    try { localStorage.removeItem(ROOM_KEY); } catch (_) { /* ignore */ }
}

// Rooms are kept ~10 minutes after you leave; don't bother after that
export function savedRoom() {
    try {
        const r = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null');
        if (r && r.id && Date.now() - r.at < 15 * 60 * 1000) return r.id;
    } catch (_) { /* ignore */ }
    return null;
}
