import React from 'react';

function formatTime(ms) {
    if (!ms) return "00:00";
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function HUD({ snapshot, localId }) {
    const players = (snapshot.players || []);
    const me = players.find(p => p.id === localId);

    return (
        <div className="full-screen" style={{ pointerEvents: 'none' }}>
            {/* Top Center: Timer */}
            <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)' }}>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'white', textShadow: '0 0 10px #00f0ff' }}>
                    {formatTime(snapshot.elapsed)}
                </div>
            </div>

            {/* Top Left: Player List */}
            <div style={{ position: 'absolute', left: 20, top: 20 }}>
                <div style={{ background: 'rgba(15, 23, 36, 0.8)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <h4 className="text-dim" style={{ marginBottom: '0.5rem' }}>PLAYERS ALIVE: {players.filter(p => p.alive).length}</h4>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {players.map(p => (
                            <li key={p.id} className="flex-row" style={{ padding: '4px 0', opacity: p.alive ? 1 : 0.5 }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.alive ? (p.id === localId ? '#00f0ff' : '#ffb86b') : '#555' }}></div>
                                <span style={{ color: p.id === localId ? 'white' : '#aaa', textDecoration: p.alive ? 'none' : 'line-through' }}>
                                    {p.id.slice(0, 4)}...
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Bottom Center: Status */}
            {me && (
                <div style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
                    {!me.alive && <div style={{ color: '#ff0055', fontSize: '2rem', fontWeight: 'bold', textShadow: '0 0 20px red' }}>ELIMINATED</div>}
                    {me.alive && <div style={{ color: '#00f0ff', fontSize: '1.2rem' }}>YOU ARE ALIVE</div>}
                </div>
            )}
        </div>
    );
}
