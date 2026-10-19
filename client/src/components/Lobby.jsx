import React, { useState } from 'react';
import { socket } from '../net/socket';
import { soundManager } from '../utils/SoundManager';

const DIFFICULTIES = [
    { key: 'easy', label: 'Easy', color: '#4ade80', desc: 'Relaxed bots' },
    { key: 'medium', label: 'Medium', color: '#facc15', desc: 'Balanced' },
    { key: 'hard', label: 'Hard', color: '#f97316', desc: 'Aggressive' },
    { key: 'insane', label: 'Insane', color: '#ef4444', desc: 'No mercy' },
];

export default function Lobby({ room, setRoom, setPlayer, player, connected }) {
    const [name, setName] = useState('Player');
    const [rid, setRid] = useState('');
    const [error, setError] = useState('');
    const [botCount, setBotCount] = useState(3);
    const [botDifficulty, setBotDifficulty] = useState('medium');
    const [tab, setTab] = useState('solo');

    function createRoom() {
        if (!name.trim()) return setError('Please enter a name');
        soundManager.playClick();
        socket.connect();
        socket.emit('createRoom', {
            name,
            botCount: tab === 'solo' ? botCount : 0,
            botDifficulty,
        }, (res) => {
            if (res.error) return setError(res.error);
            setRoom(res && res.roomId ? { id: res.roomId } : null);
            setPlayer(res.player);
            setError('');
        });
    }

    function joinRoom() {
        if (!name.trim()) return setError('Please enter a name');
        if (!rid.trim()) return setError('Please enter a Room ID');
        soundManager.playClick();
        socket.connect();
        socket.emit('joinRoom', { roomId: rid, name }, (res) => {
            if (res && res.error) { setError(res.error); return; }
            setRoom({ id: rid });
            setError('');
        });
    }

    function startMatch() {
        if (!room) return;
        soundManager.playClick();
        socket.emit('startMatch', { roomId: room.id });
    }

    function leaveRoom() {
        socket.emit('leaveRoom', { roomId: room.id });
        setRoom(null);
    }

    const diffInfo = DIFFICULTIES.find(d => d.key === botDifficulty);

    return (
        <div className="center full-screen">
            <div className="lobby-panel panel flex-col" style={{
                width: '100%', maxWidth: '440px', padding: '2rem',
                border: '1px solid rgba(0,240,255,0.1)',
                boxShadow: '0 0 60px rgba(0,0,0,0.5)',
                margin: '1rem',
            }}>
                <h1 className="text-accent" style={{
                    textAlign: 'center', fontSize: 'clamp(1.8rem,5vw,2.8rem)',
                    marginBottom: '0.25rem', letterSpacing: '3px',
                }}>DASH ARENA</h1>
                <p className="text-dim" style={{ textAlign: 'center', fontSize: '0.85rem', marginTop: 0 }}>
                    Knock opponents off the arena to win
                </p>

                {!connected && (
                    <div style={{
                        color: '#facc15', textAlign: 'center',
                        background: 'rgba(250,204,21,0.1)', padding: '0.5rem', borderRadius: '4px',
                    }}>Connecting to server...</div>
                )}

                {error && (
                    <div style={{
                        color: '#ff0055', textAlign: 'center',
                        background: 'rgba(255,0,85,0.1)', padding: '0.5rem', borderRadius: '4px',
                    }}>{error}</div>
                )}

                {!room ? (
                    <>
                        <div className="flex-col" style={{ gap: '0.5rem' }}>
                            <label className="text-dim" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Your Name</label>
                            <input
                                className="input"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Enter name..."
                                maxLength={16}
                            />
                        </div>

                        {/* Mode tabs */}
                        <div className="flex-row" style={{ gap: '0', marginTop: '0.5rem' }}>
                            {['solo', 'multi'].map(t => (
                                <button
                                    key={t}
                                    onClick={() => { setTab(t); soundManager.playClick(); }}
                                    style={{
                                        flex: 1, padding: '10px',
                                        background: tab === t ? 'rgba(0,240,255,0.15)' : 'transparent',
                                        border: `1px solid ${tab === t ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
                                        color: tab === t ? 'var(--accent)' : 'var(--text-dim)',
                                        cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                                        fontSize: '0.85rem', textTransform: 'uppercase',
                                        borderRadius: t === 'solo' ? '4px 0 0 4px' : '0 4px 4px 0',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    {t === 'solo' ? 'Solo + Bots' : 'Multiplayer'}
                                </button>
                            ))}
                        </div>

                        {tab === 'solo' && (
                            <div className="flex-col" style={{ gap: '0.75rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
                                {/* Bot count */}
                                <div>
                                    <label className="text-dim" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                        Bot Opponents: <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{botCount}</span>
                                    </label>
                                    <input
                                        type="range" min="1" max="7" value={botCount}
                                        onChange={e => setBotCount(Number(e.target.value))}
                                        style={{ width: '100%', accentColor: 'var(--accent)', marginTop: '4px' }}
                                    />
                                    <div className="flex-row text-dim" style={{ justifyContent: 'space-between', fontSize: '0.7rem' }}>
                                        <span>1</span><span>7</span>
                                    </div>
                                </div>

                                {/* Difficulty */}
                                <div>
                                    <label className="text-dim" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', display: 'block' }}>
                                        Difficulty
                                    </label>
                                    <div className="flex-row" style={{ gap: '6px', flexWrap: 'wrap' }}>
                                        {DIFFICULTIES.map(d => (
                                            <button
                                                key={d.key}
                                                onClick={() => { setBotDifficulty(d.key); soundManager.playClick(); }}
                                                style={{
                                                    flex: '1 1 0', minWidth: '60px', padding: '6px 4px',
                                                    background: botDifficulty === d.key ? `${d.color}22` : 'transparent',
                                                    border: `1px solid ${botDifficulty === d.key ? d.color : 'rgba(255,255,255,0.1)'}`,
                                                    color: botDifficulty === d.key ? d.color : 'var(--text-dim)',
                                                    borderRadius: '4px', cursor: 'pointer',
                                                    fontFamily: 'inherit', fontSize: '0.75rem', fontWeight: 600,
                                                    transition: 'all 0.2s',
                                                }}
                                            >
                                                {d.label}
                                            </button>
                                        ))}
                                    </div>
                                    {diffInfo && (
                                        <div style={{ fontSize: '0.7rem', color: diffInfo.color, marginTop: '4px', textAlign: 'center' }}>
                                            {diffInfo.desc}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {tab === 'multi' && (
                            <div className="flex-col" style={{ gap: '0.75rem' }}>
                                <div className="flex-row">
                                    <input
                                        className="input"
                                        placeholder="Room ID"
                                        value={rid}
                                        onChange={e => setRid(e.target.value)}
                                    />
                                    <button className="btn btn-secondary" onClick={joinRoom} style={{ whiteSpace: 'nowrap' }}>Join</button>
                                </div>
                                <div className="center text-dim" style={{ fontSize: '0.8rem' }}>- OR -</div>
                            </div>
                        )}

                        <button className="btn" onClick={createRoom} style={{ marginTop: '0.5rem' }}>
                            {tab === 'solo' ? 'START GAME' : 'CREATE ROOM'}
                        </button>
                    </>
                ) : (
                    <div className="flex-col">
                        <div className="center flex-col" style={{ gap: '4px' }}>
                            <div className="text-dim" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '2px' }}>Room ID</div>
                            <div className="text-accent" style={{
                                fontSize: 'clamp(1.2rem,4vw,2rem)', letterSpacing: '3px',
                                fontWeight: 'bold', fontFamily: 'monospace',
                            }}>{room.id}</div>
                            <div className="text-dim" style={{ fontSize: '0.7rem' }}>Share this code with friends</div>
                        </div>

                        <div style={{
                            background: 'rgba(0,0,0,0.3)', padding: '1rem',
                            borderRadius: '8px', minHeight: '120px',
                        }}>
                            <h4 className="text-dim" style={{ marginBottom: '0.5rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                Players ({room.players?.length || 0})
                            </h4>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                {room.players?.map(p => (
                                    <li key={p.id} className="flex-row" style={{
                                        padding: '6px 0',
                                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                                    }}>
                                        <div style={{
                                            width: '8px', height: '8px', borderRadius: '50%',
                                            background: p.isBot ? '#facc15' : (p.alive ? '#00f0ff' : '#555'),
                                            boxShadow: p.alive ? '0 0 6px currentColor' : 'none',
                                        }} />
                                        <span style={{ color: p.id === player?.id ? 'white' : '#aaa', fontSize: '0.9rem' }}>
                                            {p.name}
                                            {p.id === player?.id ? ' (You)' : ''}
                                            {p.isBot ? ' [BOT]' : ''}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <button className="btn" onClick={startMatch} style={{ marginTop: '0.5rem' }}>
                            START MATCH
                        </button>
                        <button className="btn btn-secondary" onClick={leaveRoom} style={{ fontSize: '0.8rem', padding: '8px' }}>
                            LEAVE ROOM
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
