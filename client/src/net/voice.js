import { useEffect, useState } from 'react';
import { socket } from './socket';

// ─── Voice chat ───────────────────────────────────────────────────────────
// Everyone in voice connects straight to everyone else (WebRTC, audio only);
// the game server just passes the connection handshake along. Up to 8 people.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

const state = { joined: false, muted: false, roomId: null, error: '', speaking: new Set(), joinedAt: 0 };
let stream = null;
const peers = new Map();          // socket id → { pc, audio, level }
const subs = new Set();
const notify = () => subs.forEach(fn => fn());
let meter = null;

function send(to, data) { socket.emit('voice:signal', { roomId: state.roomId, to, data }); }

function makePeer(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, audio: null, level: null };
    peers.set(id, peer);
    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => { if (e.candidate) send(id, { candidate: e.candidate }); };
    pc.ontrack = (e) => {
        if (peer.audio) return;
        const audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;
        audio.srcObject = e.streams[0];
        audio.play().catch(() => {});
        peer.audio = audio;
        peer.level = levelMeter(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') dropPeer(id);
        notify();
    };
    if (initiator) {
        pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => send(id, { sdp: pc.localDescription })).catch(() => {});
    }
    return peer;
}

function dropPeer(id) {
    const p = peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch (_) { /* ignore */ }
    if (p.audio) { p.audio.srcObject = null; }
    peers.delete(id);
    state.speaking.delete(id);
    notify();
}

// Who is talking right now (for the little speaker icons)
let actx = null;
function levelMeter(ms) {
    try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        const an = actx.createAnalyser();
        an.fftSize = 256;
        actx.createMediaStreamSource(ms).connect(an);
        return an;
    } catch (_) { return null; }
}
function startMeter() {
    if (meter) return;
    const buf = new Uint8Array(128);
    meter = setInterval(() => {
        let changed = false;
        const check = (id, an) => {
            if (!an) return;
            an.getByteTimeDomainData(buf);
            let peak = 0;
            for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
            const on = peak > 10;
            if (on !== state.speaking.has(id)) { on ? state.speaking.add(id) : state.speaking.delete(id); changed = true; }
        };
        for (const [id, p] of peers) check(id, p.level);
        check(socket.id, state.muted ? null : stream && stream._an);
        if (state.muted && state.speaking.delete(socket.id)) changed = true;
        if (changed) notify();
    }, 150);
}

socket.on('voice:peers', ({ peers: list }) => { for (const id of list || []) if (!peers.has(id)) makePeer(id, true); notify(); });
socket.on('voice:left', ({ id }) => dropPeer(id));
socket.on('voice:signal', async ({ from, data }) => {
    if (!state.joined || !data) return;
    const peer = peers.get(from) || makePeer(from, false);
    const pc = peer.pc;
    try {
        if (data.sdp) {
            await pc.setRemoteDescription(data.sdp);
            if (data.sdp.type === 'offer') {
                await pc.setLocalDescription(await pc.createAnswer());
                send(from, { sdp: pc.localDescription });
            }
        } else if (data.candidate) {
            await pc.addIceCandidate(data.candidate).catch(() => {});
        }
    } catch (_) { /* ignore a bad handshake message */ }
});
// Phones drop the connection when the app is in the background: rejoin after the seat is reclaimed
socket.on('roomUpdate', (r) => {
    if (state.joined && r && r.id === state.roomId && Date.now() - state.joinedAt > 3000 && !r.players?.some(p => p.id === socket.id && p.voice)) {
        state.joinedAt = Date.now();
        for (const id of [...peers.keys()]) dropPeer(id);
        socket.emit('voice:join', { roomId: state.roomId });
    }
});

export async function joinVoice(roomId) {
    if (state.joined) return true;
    state.error = '';
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
        state.error = 'Microphone blocked — allow it in your browser settings to talk';
        notify();
        return false;
    }
    stream._an = levelMeter(stream);
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    state.joined = true; state.muted = false; state.roomId = roomId; state.joinedAt = Date.now();
    socket.emit('voice:join', { roomId });
    startMeter();
    notify();
    return true;
}

export function leaveVoice() {
    if (!state.joined) return;
    socket.emit('voice:leave', { roomId: state.roomId });
    for (const id of [...peers.keys()]) dropPeer(id);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    state.joined = false; state.muted = false; state.roomId = null;
    state.speaking.clear();
    clearInterval(meter); meter = null;
    notify();
}

export function setMuted(m) {
    state.muted = !!m;
    if (stream) stream.getAudioTracks().forEach(t => { t.enabled = !state.muted; });
    socket.emit('voice:mute', { roomId: state.roomId, muted: state.muted });
    notify();
}

export function useVoice() {
    const [, force] = useState(0);
    useEffect(() => {
        const fn = () => force(n => n + 1);
        subs.add(fn);
        return () => subs.delete(fn);
    }, []);
    return { ...state, peerCount: peers.size, speaking: state.speaking };
}

// For tests / debugging
if (typeof window !== 'undefined') window.__dashVoice = { state, peers };
