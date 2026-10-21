import React, { useEffect, useRef, useState } from 'react';
import { socket } from '../net/socket';
import { useChat, sendChat, setChatOpen } from '../net/chat';
import { useVoice, joinVoice, leaveVoice, setMuted } from '../net/voice';
import { soundManager } from '../utils/SoundManager';

// ─── Chat panel + voice controls (used in the room and during a match) ────

const teamColor = (t) => (t === 1 ? '#ff8a7e' : t === 2 ? '#8ab8ff' : '#ffd27a');

export function ChatPanel({ roomId, onClose }) {
    const { messages } = useChat();
    const [text, setText] = useState('');
    const listRef = useRef(null);
    useEffect(() => { setChatOpen(true); return () => setChatOpen(false); }, []);
    useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length]);
    const submit = (e) => {
        e && e.preventDefault();
        if (!text.trim()) return;
        sendChat(roomId, text);
        setText('');
    };
    return (
        <div className="full-screen" style={{ zIndex: 70, background: 'rgba(0,0,0,0.55)', pointerEvents: 'auto' }} onClick={onClose}>
            <div className="gpanel" onClick={e => e.stopPropagation()} style={{
                position: 'absolute', right: 'max(10px, env(safe-area-inset-right))', top: 'max(10px, env(safe-area-inset-top))',
                bottom: 'max(10px, env(safe-area-inset-bottom))', width: 'min(380px, 92vw)',
                display: 'flex', flexDirection: 'column', padding: 12, gap: 8, boxSizing: 'border-box', animation: 'popIn 0.2s ease-out',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="gtitle" style={{ color: '#ffd84d', fontSize: '1.05rem' }}>💬 ROOM CHAT</div>
                    <button onClick={onClose} aria-label="Close chat" style={{
                        width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)',
                        background: 'rgba(0,0,0,0.4)', color: '#fff', fontSize: '1rem', cursor: 'pointer',
                    }}>✕</button>
                </div>
                <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {messages.length === 0 && (
                        <div style={{ color: '#8fa1b8', fontSize: '0.8rem', textAlign: 'center', marginTop: 20 }}>No messages yet — say hi! 👋</div>
                    )}
                    {messages.map(m => {
                        const mine = m.from === socket.id;
                        return (
                            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                                {!mine && <div style={{ fontSize: '0.66rem', fontWeight: 800, color: teamColor(m.team), marginLeft: 6 }}>{m.name}</div>}
                                <div style={{
                                    padding: '6px 10px', borderRadius: 12, fontSize: '0.85rem', color: '#fff', wordBreak: 'break-word',
                                    background: mine ? 'rgba(79,216,255,0.22)' : 'rgba(255,255,255,0.08)',
                                    border: `1px solid ${mine ? 'rgba(79,216,255,0.45)' : 'rgba(255,255,255,0.1)'}`,
                                }}>{m.text}</div>
                            </div>
                        );
                    })}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['GG 👍', 'Let\'s go! 🔥', 'Wait ✋', 'Ready ✅', 'Nice one 😂'].map(q => (
                        <button key={q} onClick={() => sendChat(roomId, q)} style={{
                            padding: '4px 9px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.35)',
                            color: '#cfd8e3', fontSize: '0.72rem', fontFamily: 'inherit', cursor: 'pointer',
                        }}>{q}</button>
                    ))}
                </div>
                <form onSubmit={submit} style={{ display: 'flex', gap: 6 }}>
                    <input value={text} onChange={e => setText(e.target.value)} maxLength={140} placeholder="Type a message…" style={{
                        flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.35)', border: '2px solid rgba(255,255,255,0.12)', borderRadius: 12,
                        color: '#fff', fontSize: '0.95rem', padding: '9px 10px', outline: 'none', fontFamily: 'inherit',
                    }} />
                    <button type="submit" className="gbtn yellow" style={{ fontSize: '0.9rem', padding: '8px 14px' }}>SEND</button>
                </form>
            </div>
        </div>
    );
}

export function ChatButton({ onClick, style }) {
    const { unread } = useChat();
    return (
        <button className="gbtn dark" onClick={() => { soundManager.playClick(); onClick(); }} aria-label="Chat" style={{
            position: 'relative', padding: '8px 12px', fontSize: '0.8rem', borderRadius: 12, ...style,
        }}>
            💬 CHAT
            {unread > 0 && <span className="gtitle" style={{
                position: 'absolute', top: -6, right: -6, background: '#ff3b5c', color: '#fff', borderRadius: 9,
                minWidth: 18, height: 18, fontSize: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{unread}</span>}
        </button>
    );
}

// Join / mute / leave voice. `round` = small round buttons for the in-game HUD.
export function VoiceControls({ roomId, round = false }) {
    const v = useVoice();
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const join = async () => {
        soundManager.playClick();
        setBusy(true);
        const ok = await joinVoice(roomId);
        setBusy(false);
        if (!ok) { setErr('Microphone blocked — allow it in your browser settings'); setTimeout(() => setErr(''), 4000); }
    };
    const btn = (extra) => (round ? {
        width: 38, height: 38, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', fontSize: '1.05rem',
        cursor: 'pointer', ...extra,
    } : { padding: '8px 12px', fontSize: '0.8rem', borderRadius: 12, ...extra });

    if (!v.joined) {
        if (round) return null;               // in a match only show it if you're already in voice
        return (
            <span style={{ position: 'relative' }}>
                <button className="gbtn green" disabled={busy} onClick={join} aria-label="Join voice chat" style={btn({})}>
                    🎙 {busy ? '…' : 'VOICE'}
                </button>
                {err && <span style={{
                    position: 'absolute', top: '110%', left: 0, width: 220, zIndex: 5, fontSize: '0.7rem', color: '#ff8899',
                    background: 'rgba(0,0,0,0.85)', padding: '4px 8px', borderRadius: 8,
                }}>{err}</span>}
            </span>
        );
    }
    const talking = v.speaking.has(socket.id);
    return (
        <span style={{ display: 'inline-flex', gap: 6 }}>
            <button className={round ? '' : `gbtn ${v.muted ? 'dark' : 'green'}`} onClick={() => { soundManager.playClick(); setMuted(!v.muted); }}
                aria-label={v.muted ? 'Unmute microphone' : 'Mute microphone'} style={btn(round ? {
                    background: v.muted ? 'rgba(255,68,102,0.35)' : talking ? 'rgba(77,255,136,0.45)' : 'rgba(0,0,0,0.55)',
                    boxShadow: talking ? '0 0 12px rgba(77,255,136,0.7)' : 'none',
                } : { boxShadow: talking ? '0 0 12px rgba(77,255,136,0.8)' : undefined })}>
                {v.muted ? '🔇' : '🎤'}{round ? '' : (v.muted ? ' MUTED' : ' ON')}
            </button>
            {!round && (
                <button className="gbtn dark" onClick={() => { soundManager.playClick(); leaveVoice(); }} aria-label="Leave voice chat"
                    style={btn({})}>✕</button>
            )}
        </span>
    );
}

// Little mic badge on a player card: 🎙 in voice, 🔇 muted, glowing while talking
export function VoiceBadge({ p }) {
    const v = useVoice();
    if (!p.voice) return null;
    const talking = v.speaking.has(p.id) && !p.muted;
    const link = v.joined && p.id !== socket.id ? v.links[p.id] : null;
    if (link === 'connecting') {
        return <span title="Connecting voice…" style={{ fontSize: '0.7rem', marginLeft: 4, opacity: 0.7 }}>🎙⏳</span>;
    }
    return (
        <span title={p.muted ? 'Muted' : link === 'relay' ? 'In voice (through the server)' : 'In voice chat'} style={{
            fontSize: '0.75rem', marginLeft: 4, padding: '0 4px', borderRadius: 6,
            background: talking ? 'rgba(77,255,136,0.35)' : 'transparent', boxShadow: talking ? '0 0 8px rgba(77,255,136,0.8)' : 'none',
        }}>{p.muted ? '🔇' : '🎙'}</span>
    );
}
