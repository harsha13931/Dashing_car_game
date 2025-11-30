import React, { useEffect, useState, useRef } from 'react';
import CanvasRenderer from './CanvasRenderer';
import HUD from './HUD';
import { socket } from '../net/socket';
import { soundManager } from '../utils/SoundManager';

// Game component – multiplayer via socket, with Joystick for mobile
export default function Game({ room, player, onBack }) {
    const [snapshot, setSnapshot] = useState({ players: [], powerups: [], elapsed: 0 });
    const [rankings, setRankings] = useState([]);

    // Input state
    const inputRef = useRef({ forward: 0, steer: 0, dash: false, shoot: false });
    const seqRef = useRef(0);
    const localId = useRef(null);

    // Track active inputs
    const activeKeys = useRef(new Set());
    const activeButtons = useRef(new Set()); // For Nitro
    const joystickInput = useRef({ forward: 0, steer: 0 }); // For Joystick

    // --- Socket listeners ---------------------------------------------------
    useEffect(() => {
        // receive periodic snapshots from server
        socket.on('snapshot', snap => setSnapshot(snap));
        // play sounds on events
        socket.on('collision', ({ impact }) => soundManager.playCrash(impact));
        socket.on('powerupCollected', ({ playerId }) => {
            if (playerId === socket.id) soundManager.playPowerup();
        });
        socket.on('playerEliminated', () => soundManager.playElimination());
        socket.on('matchEnd', ({ rankings }) => {
            setRankings(rankings || []);
            soundManager.playWin();
        });
        return () => {
            socket.off('snapshot');
            socket.off('collision');
            socket.off('powerupCollected');
            socket.off('playerEliminated');
            socket.off('matchEnd');
        };
    }, []);

    // --- Join room (once) ---------------------------------------------------
    useEffect(() => {
        if (room && room.id && !localId.current) {
            // ensure socket is connected
            if (!socket.connected) socket.connect();
            localId.current = socket.id;
        }
    }, [room]);

    // --- Input Resolution --------------------------------------------------
    function resolveInput() {
        let forward = 0;
        let steer = 0;
        let dash = false;
        let shoot = false;

        // 1. Keyboard Input
        if (activeKeys.current.has('ArrowUp') || activeKeys.current.has('KeyW')) forward += 1;
        if (activeKeys.current.has('ArrowDown') || activeKeys.current.has('KeyS')) forward -= 0.3;
        if (activeKeys.current.has('ArrowLeft') || activeKeys.current.has('KeyA')) steer -= 1;
        if (activeKeys.current.has('ArrowRight') || activeKeys.current.has('KeyD')) steer += 1;
        if (activeKeys.current.has('Space')) dash = true;
        if (activeKeys.current.has('ShiftLeft') || activeKeys.current.has('KeyF')) shoot = true;

        // 2. Joystick Input (Additive or Override)
        // We'll add them, so you can use both (e.g. keyboard for gas, joystick for steer)
        forward += joystickInput.current.forward;
        steer += joystickInput.current.steer;

        // 3. Buttons
        if (activeButtons.current.has('nitro')) dash = true;
        if (activeButtons.current.has('shoot')) shoot = true;

        // Clamp values
        forward = Math.max(-1, Math.min(1, forward));
        steer = Math.max(-1, Math.min(1, steer));

        // Update ref and send if changed
        if (inputRef.current.forward !== forward || inputRef.current.steer !== steer || inputRef.current.dash !== dash || inputRef.current.shoot !== shoot) {
            inputRef.current = { forward, steer, dash, shoot };
            sendInput();
        }
    }

    function sendInput() {
        seqRef.current++;
        socket.emit('input', { roomId: room?.id, input: { ...inputRef.current }, seq: seqRef.current });
    }

    // --- Keyboard input (desktop) ------------------------------------------
    useEffect(() => {
        const onKeyDown = e => {
            if (e.repeat) return;
            activeKeys.current.add(e.code);
            resolveInput();
        };
        const onKeyUp = e => {
            activeKeys.current.delete(e.code);
            resolveInput();
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, []);

    // --- Joystick Logic ----------------------------------------------------
    const joystickRef = useRef(null);
    useEffect(() => {
        const joystick = joystickRef.current;
        if (!joystick) return;

        const rect = joystick.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const maxRadius = 40;

        const handleMove = (clientX, clientY) => {
            const dx = clientX - centerX;
            const dy = clientY - centerY;

            // Normalize
            let steer = dx / maxRadius;
            let forward = -dy / maxRadius; // Up is negative Y in screen, but positive forward

            // Clamp magnitude to 1
            const mag = Math.hypot(steer, forward);
            if (mag > 1) {
                steer /= mag;
                forward /= mag;
            }

            joystickInput.current = { forward, steer };
            resolveInput();
        };

        const onPointerDown = (e) => {
            e.preventDefault();
            joystick.setPointerCapture(e.pointerId);
            handleMove(e.clientX, e.clientY);

            const onPointerMove = (ev) => {
                ev.preventDefault();
                handleMove(ev.clientX, ev.clientY);
            };

            const onPointerUp = (ev) => {
                ev.preventDefault();
                joystickInput.current = { forward: 0, steer: 0 };
                resolveInput();
                joystick.removeEventListener('pointermove', onPointerMove);
                joystick.removeEventListener('pointerup', onPointerUp);
            };

            joystick.addEventListener('pointermove', onPointerMove);
            joystick.addEventListener('pointerup', onPointerUp);
        };

        joystick.addEventListener('pointerdown', onPointerDown);
        return () => {
            joystick.removeEventListener('pointerdown', onPointerDown);
        };
    }, []);

    // --- Nitro Button Handler --------------------------------------------
    const handleBtn = (action, pressed) => {
        if (pressed) {
            activeButtons.current.add(action);
            soundManager.playClick();
        } else {
            activeButtons.current.delete(action);
        }
        resolveInput();
    };

    const btnProps = (action) => ({
        onPointerDown: (e) => { e.preventDefault(); handleBtn(action, true); },
        onPointerUp: (e) => { e.preventDefault(); handleBtn(action, false); },
        onPointerLeave: (e) => { e.preventDefault(); handleBtn(action, false); },
        style: {
            width: '90px',
            height: '90px',
            borderRadius: '50%',
            background: 'rgba(0, 240, 255, 0.2)',
            border: '2px solid var(--accent)',
            color: 'var(--accent)',
            fontSize: '1.2rem',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            touchAction: 'none',
            pointerEvents: 'auto'
        }
    });

    // Helper for cooldown overlay
    const CooldownOverlay = ({ remaining, total = 1.5 }) => {
        if (!remaining || remaining <= 0) return null;
        const pct = (remaining / total) * 100;
        return (
            <div style={{
                position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${pct}%`,
                background: 'rgba(0,0,0,0.6)', borderRadius: '50%', pointerEvents: 'none',
                transition: 'height 0.1s linear'
            }} />
        );
    };

    const me = snapshot.players?.find(p => p.id === socket.id);

    // Format time
    const formatTime = (ms) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const rs = s % 60;
        return `${m}:${rs.toString().padStart(2, '0')}`;
    };

    // --- Render ------------------------------------------------------------
    return (
        <div className="full-screen" style={{ background: '#050510' }}>
            {/* Canvas with arena & players */}
            <CanvasRenderer snapshot={snapshot} localId={socket.id} />

            {/* HUD Overlay */}
            <div className="full-screen" style={{ pointerEvents: 'none', zIndex: 4, padding: '20px' }}>
                {/* Top Center: Timer */}
                <div style={{
                    position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(0,0,0,0.5)', padding: '10px 20px', borderRadius: '20px',
                    border: '1px solid rgba(0,240,255,0.3)', color: '#fff', fontSize: '1.5rem', fontWeight: 'bold',
                    textShadow: '0 0 10px rgba(0,240,255,0.5)'
                }}>
                    {formatTime(snapshot.elapsed || 0)}
                </div>

                {/* Top Right: Leaderboard */}
                <div style={{
                    position: 'absolute', top: 20, right: 20, width: 200,
                    background: 'rgba(0,0,0,0.5)', padding: '15px', borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.1)'
                }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#aaa', fontSize: '0.8rem', textTransform: 'uppercase' }}>Leaderboard</h4>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {snapshot.players && snapshot.players
                            .sort((a, b) => (b.alive === a.alive) ? 0 : b.alive ? 1 : -1) // Alive first
                            .map(p => (
                                <li key={p.id} style={{
                                    display: 'flex', justifyContent: 'space-between', marginBottom: '5px',
                                    opacity: p.alive ? 1 : 0.5, color: p.id === socket.id ? '#00f0ff' : 'white'
                                }}>
                                    <span>{p.id === socket.id ? 'YOU' : p.id.slice(0, 4)}</span>
                                    <span style={{ fontSize: '0.8rem' }}>{p.alive ? 'ALIVE' : 'DEAD'}</span>
                                </li>
                            ))}
                    </ul>
                </div>
            </div>

            {/* Game Over Screen */}
            {rankings.length > 0 && (
                <div className="full-screen center" style={{ background: 'rgba(0,0,0,0.85)', zIndex: 10, pointerEvents: 'auto' }}>
                    <div className="panel flex-col center" style={{ padding: '3rem', border: '2px solid var(--accent)', boxShadow: '0 0 50px var(--accent-glow)' }}>
                        <h1 className="text-accent" style={{ fontSize: '4rem', marginBottom: '1rem' }}>GAME OVER</h1>
                        <div style={{ width: '100%', marginBottom: '2rem' }}>
                            <h3 className="text-dim" style={{ borderBottom: '1px solid #333', paddingBottom: '0.5rem' }}>RANKINGS</h3>
                            <ul style={{ listStyle: 'none', padding: 0 }}>
                                {rankings.map(r => (
                                    <li key={r.id} className="flex-row" style={{ justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <span style={{ color: r.rank === 1 ? 'gold' : 'white' }}>#{r.rank} {r.name}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <button className="btn" onClick={onBack}>BACK TO LOBBY</button>
                    </div>
                </div>
            )}

            {/* Mobile controls overlay */}
            <div className="full-screen" style={{ pointerEvents: 'none', zIndex: 5 }}>
                {/* Left: 2‑axis joystick */}
                <div
                    ref={joystickRef}
                    style={{
                        position: 'absolute',
                        bottom: 40,
                        left: 40,
                        width: 120,
                        height: 120,
                        background: 'rgba(255,255,255,0.1)',
                        borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.3)',
                        pointerEvents: 'auto',
                        touchAction: 'none'
                    }}
                >
                    {/* visual knob */}
                    <div
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            // Visual feedback for joystick position
                            transform: `translate(calc(-50% + ${inputRef.current.steer * 40}px), calc(-50% + ${-inputRef.current.forward * 40}px))`,
                            width: 40,
                            height: 40,
                            background: 'rgba(0, 240, 255, 0.5)',
                            borderRadius: '50%',
                            boxShadow: '0 0 10px #00f0ff'
                        }}
                    />
                </div>

                {/* Right: Action buttons */}
                <div style={{ position: 'absolute', bottom: 40, right: 40, pointerEvents: 'auto', display: 'flex', gap: '20px' }}>
                    {/* Shoot Button */}
                    <div {...btnProps('shoot')} style={{ ...btnProps('shoot').style, borderColor: '#ff0055', color: '#ff0055', background: 'rgba(255, 0, 85, 0.2)' }}>
                        SHOOT
                        <CooldownOverlay remaining={me?.shootCooldown} total={1.0} />
                    </div>

                    {/* Nitro Button */}
                    <div {...btnProps('nitro')}>
                        NITRO
                        <CooldownOverlay remaining={me?.dashCooldown} total={1.5} />
                    </div>
                </div>
            </div>
        </div>
    );
}
