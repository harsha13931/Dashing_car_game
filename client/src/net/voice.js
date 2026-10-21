import { useEffect, useState } from 'react';
import { socket } from './socket';

// ─── Voice chat ───────────────────────────────────────────────────────────
// 1. Everyone in voice tries to connect straight to everyone else (WebRTC,
//    audio only); the game server just passes the connection handshake along.
// 2. If two phones can't reach each other directly (strict mobile / office
//    networks), their audio is relayed through the game server instead:
//    small 8 kHz μ-law packets, only sent while you're actually talking.
const DIRECT_TIMEOUT_MS = 6000;
const FORCE_RELAY = (() => { try { return localStorage.getItem('dasharena.voiceRelay') === '1'; } catch (_) { return false; } })();

const state = { joined: false, muted: false, roomId: null, error: '', speaking: new Set(), joinedAt: 0, links: {} };
let stream = null;
let iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const peers = new Map();          // socket id → { pc, audio, level, relay, timer, nextTime, lastRx }
const subs = new Set();
const notify = () => {
    state.links = {};
    for (const [id, p] of peers) state.links[id] = p.relay ? 'relay' : p.pc && p.pc.connectionState === 'connected' ? 'direct' : 'connecting';
    subs.forEach(fn => fn());
};
let meter = null;
let actx = null;
let capture = null;

function send(to, data) { socket.emit('voice:signal', { roomId: state.roomId, to, data }); }

function useRelay(id, tell = true) {
    const peer = peers.get(id);
    if (!peer || peer.relay) return;
    peer.relay = true;
    clearTimeout(peer.timer);
    try { peer.pc && peer.pc.close(); } catch (_) { /* ignore */ }
    peer.pc = null;
    if (tell) send(id, { relay: true });
    startCapture();
    notify();
}

function makePeer(id, initiator) {
    const peer = { pc: null, audio: null, level: null, relay: false, timer: null, nextTime: 0, lastRx: 0 };
    peers.set(id, peer);
    if (FORCE_RELAY) { useRelay(id); return peer; }
    const pc = new RTCPeerConnection({ iceServers });
    peer.pc = pc;
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
        peer.level = analyser(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') clearTimeout(peer.timer);
        if (st === 'failed') useRelay(id);
        notify();
    };
    // No direct connection after a few seconds → go through the server
    peer.timer = setTimeout(() => { if (pc.connectionState !== 'connected') useRelay(id); }, DIRECT_TIMEOUT_MS);
    if (initiator) {
        pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => send(id, { sdp: pc.localDescription })).catch(() => {});
    }
    return peer;
}

function dropPeer(id) {
    const p = peers.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    try { p.pc && p.pc.close(); } catch (_) { /* ignore */ }
    if (p.audio) p.audio.srcObject = null;
    if (p.gain) { try { p.gain.disconnect(); } catch (_) { /* ignore */ } }
    peers.delete(id);
    state.speaking.delete(id);
    notify();
}

// ─── Audio helpers ──────────────────────────────────────────────────────
function ctx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
}
function analyser(ms) {
    try {
        const an = ctx().createAnalyser();
        an.fftSize = 256;
        ctx().createMediaStreamSource(ms).connect(an);
        return an;
    } catch (_) { return null; }
}

// G.711 μ-law: 8 bits a sample, good enough for voice and tiny on the wire
function encodeUlaw(x) {
    let s = Math.round(Math.max(-1, Math.min(1, x)) * 32767);
    const sign = s < 0 ? 0x80 : 0;
    if (sign) s = -s;
    s = Math.min(s, 32635) + 0x84;
    let exp = 7;
    for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1) { /* find the segment */ }
    return ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
}
function decodeUlaw(u) {
    u = ~u & 0xff;
    const exp = (u >> 4) & 7;
    const s = ((((u & 0x0f) << 3) + 0x84) << exp) - 0x84;
    return (u & 0x80 ? -s : s) / 32768;
}

// Microphone → 8 kHz μ-law packets for the players we can only reach through the server
function startCapture() {
    if (capture || !stream) return;
    const ac = ctx();
    const src = ac.createMediaStreamSource(stream);
    const proc = ac.createScriptProcessor(2048, 1, 1);
    const silent = ac.createGain();
    silent.gain.value = 0;
    src.connect(proc); proc.connect(silent); silent.connect(ac.destination);
    const ratio = ac.sampleRate / 8000;
    const FRAME = 480;                           // 60 ms at 8 kHz
    let frame = new Uint8Array(FRAME), n = 0, acc = 0, cnt = 0, pos = 0, energy = 0, hang = 0;
    proc.onaudioprocess = (e) => {
        const targets = [...peers].filter(([, p]) => p.relay).map(([id]) => id);
        if (!targets.length || state.muted) { n = 0; energy = 0; return; }
        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
            acc += input[i]; cnt++; pos++;
            if (pos >= ratio) {
                const v = acc / cnt;
                acc = 0; cnt = 0; pos -= ratio;
                frame[n++] = encodeUlaw(v * 1.6);
                energy += v * v;
                if (n === FRAME) {
                    // only send while you're talking (plus a short tail)
                    if (Math.sqrt(energy / FRAME) > 0.008) hang = 6;
                    if (hang > 0) {
                        hang--;
                        socket.emit('voice:pcm', { roomId: state.roomId, to: targets, data: frame.buffer });
                    }
                    frame = new Uint8Array(FRAME); n = 0; energy = 0;
                }
            }
        }
    };
    capture = { src, proc, silent };
}
function stopCapture() {
    if (!capture) return;
    try { capture.proc.disconnect(); capture.src.disconnect(); capture.silent.disconnect(); } catch (_) { /* ignore */ }
    capture.proc.onaudioprocess = null;
    capture = null;
}

// Relayed audio from another player: decode and queue it up gap-free
socket.on('voice:pcm', ({ from, data }) => {
    if (!state.joined || !data) return;
    let peer = peers.get(from);
    if (!peer) { peer = makePeer(from, false); }
    if (!peer.relay) useRelay(from, false);
    const bytes = new Uint8Array(data);
    const ac = ctx();
    const buf = ac.createBuffer(1, bytes.length, 8000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < bytes.length; i++) ch[i] = decodeUlaw(bytes[i]);
    if (!peer.gain) { peer.gain = ac.createGain(); peer.gain.gain.value = 1.4; peer.gain.connect(ac.destination); }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(peer.gain);
    const now = ac.currentTime;
    if (peer.nextTime < now + 0.03 || peer.nextTime > now + 0.6) peer.nextTime = now + 0.12;   // small jitter buffer
    src.start(peer.nextTime);
    peer.nextTime += buf.duration;
    peer.lastRx = Date.now();
});

function startMeter() {
    if (meter) return;
    const buf = new Uint8Array(128);
    meter = setInterval(() => {
        let changed = false;
        const set = (id, on) => {
            if (on !== state.speaking.has(id)) { on ? state.speaking.add(id) : state.speaking.delete(id); changed = true; }
        };
        const level = (an) => {
            an.getByteTimeDomainData(buf);
            let peak = 0;
            for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
            return peak;
        };
        for (const [id, p] of peers) {
            if (p.relay) set(id, Date.now() - p.lastRx < 300);
            else if (p.level) set(id, level(p.level) > 10);
        }
        set(socket.id, !state.muted && !!(stream && stream._an) && level(stream._an) > 10);
        if (state.muted) set(socket.id, false);
        if (changed) notify();
    }, 150);
}

socket.on('voice:peers', ({ peers: list }) => { for (const id of list || []) if (!peers.has(id)) makePeer(id, true); notify(); });
socket.on('voice:left', ({ id }) => dropPeer(id));
socket.on('voice:signal', async ({ from, data }) => {
    if (!state.joined || !data) return;
    if (data.relay) { if (!peers.has(from)) makePeer(from, false); useRelay(from, false); return; }
    const peer = peers.get(from) || makePeer(from, false);
    const pc = peer.pc;
    if (!pc) return;                                  // already relaying for this player
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
    ctx();                                           // unlock audio while we still have the tap
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
        state.error = 'Microphone blocked — allow it in your browser settings to talk';
        notify();
        return false;
    }
    try {
        const r = await fetch('/api/ice');
        if (r.ok) { const j = await r.json(); if (Array.isArray(j.iceServers)) iceServers = j.iceServers; }
    } catch (_) { /* keep the defaults */ }
    stream._an = analyser(stream);
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
    stopCapture();
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
