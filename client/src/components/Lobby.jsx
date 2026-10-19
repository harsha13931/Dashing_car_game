import React, { useState } from 'react';
import { socket } from '../net/socket';

export default function Lobby({ room, setRoom, setPlayer, player, connected }) {
    const [name, setName] = useState('Player');
    const [rid, setRid] = useState('');
    const [error, setError] = useState('');

    function createRoom() {
        if (!name.trim()) return setError('Please enter a name');
        socket.connect();
        socket.emit('createRoom', { name }, (res) => {
            if (res.error) return setError(res.error);
            setRoom(res && res.roomId ? { id: res.roomId } : null);
            setPlayer(res.player);
            setError('');
        });
    }

    function joinRoom() {
        if (!name.trim()) return setError('Please enter a name');
        if (!rid.trim()) return setError('Please enter a Room ID');
        socket.connect();
        socket.emit('joinRoom', { roomId: rid, name }, (res) => {
            if (res && res.error) { setError(res.error); return; }
            setRoom({ id: rid });
            setError('');
        });
    }

    function startMatch() {
        if (!room) return;
        socket.emit('startMatch', { roomId: room.id });
    }

    function leaveRoom() {
        // Tell the server so this player stops counting toward the match
        socket.emit('leaveRoom', { roomId: room.id });
        setRoom(null);
    }

    return (
        <div className="center full-screen">
            <div className="panel flex-col" style={{ width: '400px', padding: '2rem', background: 'rgba(15, 23, 36, 0.95)', border: '1px solid rgba(0, 240, 255, 0.1)', boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}>
                <h1 className="text-accent" style={{ textAlign: 'center', fontSize: '2.5rem', marginBottom: '1rem' }}>CAR DASH</h1>

                {!connected && <div style={{ color: 'red', textAlign: 'center' }}>Connecting to server...</div>}

                {error && <div style={{ color: '#ff0055', textAlign: 'center', background: 'rgba(255,0,85,0.1)', padding: '0.5rem', borderRadius: '4px' }}>{error}</div>}

                {!room ? (
                    <>
                        <div className="flex-col">
                            <label className="text-dim">Your Name</label>
                            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Enter name..." />
                        </div>

                        <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '1rem 0' }}></div>

                        <div className="flex-col">
                            <button className="btn" onClick={createRoom}>Create New Room</button>

                            <div className="center text-dim" style={{ fontSize: '0.9rem' }}>- OR -</div>

                            <div className="flex-row">
                                <input className="input" placeholder="Room ID" value={rid} onChange={e => setRid(e.target.value)} />
                                <button className="btn btn-secondary" onClick={joinRoom}>Join</button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-col">
                        <div className="center flex-col">
                            <div className="text-dim">ROOM ID</div>
                            <div className="text-accent" style={{ fontSize: '2rem', letterSpacing: '2px', fontWeight: 'bold' }}>{room.id}</div>
                        </div>

                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', minHeight: '150px' }}>
                            <h4 className="text-dim" style={{ marginBottom: '0.5rem' }}>PLAYERS ({room.players?.length || 0})</h4>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                {room.players?.map(p => (
                                    <li key={p.id} className="flex-row" style={{ padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.alive ? '#00f0ff' : '#555' }}></div>
                                        <span style={{ color: p.id === player?.id ? 'white' : '#aaa' }}>{p.name} {p.id === player?.id ? '(You)' : ''}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <button className="btn" onClick={startMatch} style={{ marginTop: '1rem' }}>START MATCH</button>
                        <button className="btn btn-secondary" onClick={leaveRoom} style={{ fontSize: '0.8rem', padding: '8px' }}>LEAVE ROOM</button>
                    </div>
                )}
            </div>
        </div>
    );
}
