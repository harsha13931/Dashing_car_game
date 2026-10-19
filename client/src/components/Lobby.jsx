import React, { useState } from 'react';
import { socket } from '../net/socket';
import { soundManager } from '../utils/SoundManager';

const DIFFICULTIES = [
    { key: 'easy', label: 'Easy', color: '#4ade80', desc: 'Relaxed bots' },
    { key: 'medium', label: 'Medium', color: '#facc15', desc: 'Balanced' },
    { key: 'hard', label: 'Hard', color: '#f97316', desc: 'Aggressive' },
    { key: 'insane', label: 'Insane', color: '#ef4444', desc: 'No mercy' },
];

const CAR_TYPES = [
    { key: 'sports',   name: 'Venom GT',      emoji: '🏎️', color: '#00d4ff', speed: 4, handling: 3, power: 2, weight: 2, desc: 'Fast and agile' },
    { key: 'muscle',   name: 'Thunder V8',    emoji: '💪', color: '#ff4444', speed: 3, handling: 2, power: 4, weight: 3, desc: 'Heavy hitter' },
    { key: 'truck',    name: 'War Rig',       emoji: '🛻', color: '#ff8800', speed: 1, handling: 1, power: 5, weight: 5, desc: 'Unstoppable force' },
    { key: 'rally',    name: 'Dust Devil',    emoji: '🏁', color: '#44ff44', speed: 3, handling: 5, power: 2, weight: 2, desc: 'Best handling' },
    { key: 'kart',     name: 'Pocket Rocket', emoji: '🎮', color: '#ffff44', speed: 5, handling: 4, power: 1, weight: 1, desc: 'Tiny but fast' },
    { key: 'suv',      name: 'Iron Shield',   emoji: '🛡️', color: '#8888ff', speed: 2, handling: 2, power: 3, weight: 4, desc: 'Tank with style' },
    { key: 'drift',    name: 'Sidewinder',    emoji: '💨', color: '#ff44ff', speed: 3, handling: 5, power: 2, weight: 2, desc: 'Drift king' },
    { key: 'supercar', name: 'Phantom X',     emoji: '⚡', color: '#ffaa00', speed: 5, handling: 3, power: 1, weight: 1, desc: 'Pure speed' },
];

function StatBar({ value, max = 5, color }) {
    return (
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
            {Array.from({ length: max }, (_, i) => (
                <div key={i} style={{
                    width: '14px', height: '6px', borderRadius: '2px',
                    background: i < value ? color : 'rgba(255,255,255,0.1)',
                    transition: 'background 0.2s',
                }} />
            ))}
        </div>
    );
}

function CarCard({ car, selected, onSelect }) {
    const active = selected === car.key;
    return (
        <button
            onClick={() => onSelect(car.key)}
            style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '10px 8px', gap: '4px',
                background: active ? `${car.color}18` : 'rgba(255,255,255,0.03)',
                border: `2px solid ${active ? car.color : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '10px', cursor: 'pointer',
                transition: 'all 0.2s', fontFamily: 'inherit',
                minWidth: '90px', position: 'relative',
                boxShadow: active ? `0 0 20px ${car.color}33` : 'none',
            }}
        >
            <span style={{ fontSize: '1.8rem' }}>{car.emoji}</span>
            <span style={{
                color: active ? car.color : '#ccc', fontWeight: 700,
                fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>{car.name}</span>
            {active && (
                <div style={{
                    position: 'absolute', top: '-6px', right: '-6px',
                    background: car.color, borderRadius: '50%',
                    width: '16px', height: '16px', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', color: '#000', fontWeight: 900,
                }}>✓</div>
            )}
        </button>
    );
}

function CarStats({ carKey }) {
    const car = CAR_TYPES.find(c => c.key === carKey);
    if (!car) return null;
    return (
        <div style={{
            background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '10px 12px',
            display: 'grid', gridTemplateColumns: '70px 1fr', gap: '4px 8px', alignItems: 'center',
        }}>
            <span className="text-dim" style={{ fontSize: '0.7rem' }}>SPEED</span>
            <StatBar value={car.speed} color="#00ff88" />
            <span className="text-dim" style={{ fontSize: '0.7rem' }}>HANDLING</span>
            <StatBar value={car.handling} color="#00ddff" />
            <span className="text-dim" style={{ fontSize: '0.7rem' }}>POWER</span>
            <StatBar value={car.power} color="#ff4444" />
            <span className="text-dim" style={{ fontSize: '0.7rem' }}>WEIGHT</span>
            <StatBar value={car.weight} color="#ffaa00" />
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: car.color, fontSize: '0.75rem', fontStyle: 'italic', marginTop: '2px' }}>
                {car.desc}
            </div>
        </div>
    );
}

export default function Lobby({ room, setRoom, setPlayer, player, connected }) {
    const [name, setName] = useState('Player');
    const [rid, setRid] = useState('');
    const [error, setError] = useState('');
    const [botCount, setBotCount] = useState(3);
    const [botDifficulty, setBotDifficulty] = useState('medium');
    const [carType, setCarType] = useState('sports');
    const [tab, setTab] = useState('solo');
    const [step, setStep] = useState('name');

    function createRoom() {
        soundManager.playClick();
        socket.connect();
        socket.emit('createRoom', {
            name,
            botCount: tab === 'solo' ? botCount : 0,
            botDifficulty,
            carType,
        }, (res) => {
            if (res.error) return setError(res.error);
            setRoom(res && res.roomId ? { id: res.roomId } : null);
            setPlayer(res.player);
            setError('');
        });
    }

    function joinRoom() {
        if (!rid.trim()) return setError('Please enter a Room ID');
        soundManager.playClick();
        socket.connect();
        socket.emit('joinRoom', { roomId: rid, name, carType }, (res) => {
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
        setStep('name');
    }

    function goToCarSelect() {
        if (!name.trim()) return setError('Please enter a name');
        setError('');
        soundManager.playClick();
        setStep('car');
    }

    return (
        <div className="center full-screen" style={{ overflow: 'auto', padding: '1rem' }}>
            <div className="lobby-panel panel flex-col" style={{
                width: '100%', maxWidth: room ? '440px' : '520px', padding: '1.5rem 1.5rem 2rem',
                border: '1px solid rgba(0,240,255,0.1)',
                boxShadow: '0 0 60px rgba(0,0,0,0.5)',
            }}>
                <h1 className="text-accent" style={{
                    textAlign: 'center', fontSize: 'clamp(1.6rem,5vw,2.5rem)',
                    marginBottom: '0.15rem', letterSpacing: '3px',
                }}>DASH ARENA</h1>
                <p className="text-dim" style={{ textAlign: 'center', fontSize: '0.8rem', margin: 0 }}>
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
                        {step === 'name' && (
                            <>
                                <div className="flex-col" style={{ gap: '0.5rem' }}>
                                    <label className="text-dim" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Your Name</label>
                                    <input
                                        className="input"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        placeholder="Enter name..."
                                        maxLength={16}
                                        onKeyDown={e => e.key === 'Enter' && goToCarSelect()}
                                    />
                                </div>

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

                                {tab === 'multi' && (
                                    <div className="flex-row" style={{ marginTop: '0.5rem' }}>
                                        <input
                                            className="input"
                                            placeholder="Room ID"
                                            value={rid}
                                            onChange={e => setRid(e.target.value)}
                                        />
                                    </div>
                                )}

                                <button className="btn" onClick={goToCarSelect} style={{ marginTop: '0.75rem' }}>
                                    CHOOSE YOUR CAR
                                </button>
                            </>
                        )}

                        {step === 'car' && (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.25rem' }}>
                                    <button
                                        onClick={() => { setStep('name'); soundManager.playClick(); }}
                                        style={{
                                            background: 'none', border: 'none', color: 'var(--text-dim)',
                                            cursor: 'pointer', fontSize: '1.2rem', padding: '4px',
                                            fontFamily: 'inherit',
                                        }}
                                    >←</button>
                                    <span className="text-dim" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                        Select Your Vehicle
                                    </span>
                                </div>

                                {/* Car grid */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(4, 1fr)',
                                    gap: '8px',
                                }}>
                                    {CAR_TYPES.map(car => (
                                        <CarCard key={car.key} car={car} selected={carType} onSelect={k => { setCarType(k); soundManager.playClick(); }} />
                                    ))}
                                </div>

                                <CarStats carKey={carType} />

                                {tab === 'solo' && (
                                    <div className="flex-col" style={{ gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: '8px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <label className="text-dim" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                                Bots: <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{botCount}</span>
                                            </label>
                                            <input
                                                type="range" min="1" max="7" value={botCount}
                                                onChange={e => setBotCount(Number(e.target.value))}
                                                style={{ width: '120px', accentColor: 'var(--accent)' }}
                                            />
                                        </div>
                                        <div className="flex-row" style={{ gap: '4px', flexWrap: 'wrap' }}>
                                            {DIFFICULTIES.map(d => (
                                                <button
                                                    key={d.key}
                                                    onClick={() => { setBotDifficulty(d.key); soundManager.playClick(); }}
                                                    style={{
                                                        flex: '1 1 0', minWidth: '55px', padding: '5px 2px',
                                                        background: botDifficulty === d.key ? `${d.color}22` : 'transparent',
                                                        border: `1px solid ${botDifficulty === d.key ? d.color : 'rgba(255,255,255,0.1)'}`,
                                                        color: botDifficulty === d.key ? d.color : 'var(--text-dim)',
                                                        borderRadius: '4px', cursor: 'pointer',
                                                        fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600,
                                                        transition: 'all 0.2s',
                                                    }}
                                                >
                                                    {d.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <button className="btn" onClick={tab === 'multi' && rid.trim() ? joinRoom : createRoom} style={{ marginTop: '0.25rem' }}>
                                    {tab === 'solo' ? 'START GAME' : (rid.trim() ? 'JOIN ROOM' : 'CREATE ROOM')}
                                </button>
                            </>
                        )}
                    </>
                ) : (
                    <div className="flex-col">
                        <div className="center flex-col" style={{ gap: '4px' }}>
                            <div className="text-dim" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '2px' }}>Room ID</div>
                            <div className="text-accent" style={{
                                fontSize: 'clamp(1.2rem,4vw,2rem)', letterSpacing: '3px',
                                fontWeight: 'bold', fontFamily: 'monospace',
                            }}>{room.id}</div>
                            <div className="text-dim" style={{ fontSize: '0.65rem' }}>Share this code with friends</div>
                        </div>

                        <div style={{
                            background: 'rgba(0,0,0,0.3)', padding: '0.75rem',
                            borderRadius: '8px', minHeight: '100px',
                        }}>
                            <h4 className="text-dim" style={{ marginBottom: '0.5rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                Players ({room.players?.length || 0})
                            </h4>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                {room.players?.map(p => {
                                    const carInfo = CAR_TYPES.find(c => c.key === p.carType);
                                    return (
                                        <li key={p.id} className="flex-row" style={{
                                            padding: '5px 0',
                                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                                            gap: '8px',
                                        }}>
                                            <div style={{
                                                width: '8px', height: '8px', borderRadius: '50%',
                                                background: p.isBot ? '#facc15' : (p.alive ? '#00f0ff' : '#555'),
                                                boxShadow: p.alive ? '0 0 6px currentColor' : 'none',
                                            }} />
                                            <span style={{ color: p.id === player?.id ? 'white' : '#aaa', fontSize: '0.85rem', flex: 1 }}>
                                                {p.name}
                                                {p.id === player?.id ? ' (You)' : ''}
                                                {p.isBot ? ' [BOT]' : ''}
                                            </span>
                                            {carInfo && (
                                                <span style={{ fontSize: '0.75rem', color: carInfo.color }}>
                                                    {carInfo.emoji} {carInfo.name}
                                                </span>
                                            )}
                                        </li>
                                    );
                                })}
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
