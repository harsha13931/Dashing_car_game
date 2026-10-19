import React, { useEffect, useState, useRef } from 'react';
import PhaserGame from './PhaserGame';
import { socket } from '../net/socket';
import { soundManager } from '../utils/SoundManager';

export default function Game({ room, player, onBack }) {
    const [snapshot, setSnapshot] = useState({ players: [], powerups: [], elapsed: 0 });
    const [rankings, setRankings] = useState([]);
    const [matchData, setMatchData] = useState(null);
    const [countdown, setCountdown] = useState(0);
    const [round, setRound] = useState(0);

    const inputRef = useRef({ forward: 0, steer: 0, dash: false, shoot: false });
    const seqRef = useRef(0);
    const activeKeys = useRef(new Set());
    const activeButtons = useRef(new Set());
    const joystickInput = useRef({ forward: 0, steer: 0 });

    // ─── Socket listeners ───────────────────────────────────────────────
    useEffect(() => {
        socket.on('snapshot', snap => setSnapshot(snap));

        socket.on('collision', ({ impact, x, y }) => {
            soundManager.playCrash(impact);
            // Forward to canvas for screen shake
            if (window.__dashArenaCollision) window.__dashArenaCollision({ impact });
        });

        socket.on('powerupCollected', ({ playerId, type }) => {
            if (playerId === socket.id) soundManager.playPowerup();
        });

        socket.on('playerEliminated', ({ id, name }) => {
            soundManager.playElimination();
        });

        socket.on('countdown', ({ count }) => {
            setCountdown(count);
            if (count > 0) soundManager.playCountdown();
            if (count === 0) soundManager.playGo();
        });

        socket.on('matchStart', ({ count, round: r }) => {
            setRankings([]);
            setMatchData(null);
            setCountdown(count);
            setRound(r);
        });

        socket.on('matchEnd', (data) => {
            setRankings(data.rankings || []);
            setMatchData(data);
            setCountdown(0);
            const myRank = (data.rankings || []).findIndex(r => r.id === socket.id);
            if (myRank === 0) soundManager.playWin();
            else soundManager.playLose();
        });

        return () => {
            socket.off('snapshot');
            socket.off('collision');
            socket.off('powerupCollected');
            socket.off('playerEliminated');
            socket.off('countdown');
            socket.off('matchStart');
            socket.off('matchEnd');
        };
    }, []);

    // ─── Input resolution ───────────────────────────────────────────────
    function resolveInput() {
        let forward = 0, steer = 0, dash = false, shoot = false;

        // Keyboard
        if (activeKeys.current.has('ArrowUp') || activeKeys.current.has('KeyW')) forward += 1;
        if (activeKeys.current.has('ArrowDown') || activeKeys.current.has('KeyS')) forward -= 0.4;
        if (activeKeys.current.has('ArrowLeft') || activeKeys.current.has('KeyA')) steer -= 1;
        if (activeKeys.current.has('ArrowRight') || activeKeys.current.has('KeyD')) steer += 1;
        if (activeKeys.current.has('Space')) dash = true;
        if (activeKeys.current.has('ShiftLeft') || activeKeys.current.has('ShiftRight') || activeKeys.current.has('KeyF')) shoot = true;

        // Joystick
        forward += joystickInput.current.forward;
        steer += joystickInput.current.steer;

        // Buttons
        if (activeButtons.current.has('nitro')) dash = true;
        if (activeButtons.current.has('shoot')) shoot = true;

        forward = Math.max(-1, Math.min(1, forward));
        steer = Math.max(-1, Math.min(1, steer));

        if (inputRef.current.forward !== forward || inputRef.current.steer !== steer ||
            inputRef.current.dash !== dash || inputRef.current.shoot !== shoot) {
            if (shoot && !inputRef.current.shoot) soundManager.playShoot();
            if (dash && !inputRef.current.dash) soundManager.playDash();
            inputRef.current = { forward, steer, dash, shoot };
            seqRef.current++;
            socket.emit('input', { roomId: room?.id, input: { ...inputRef.current }, seq: seqRef.current });
        }
    }

    // ─── Keyboard ───────────────────────────────────────────────────────
    useEffect(() => {
        const onDown = e => { if (!e.repeat) { activeKeys.current.add(e.code); resolveInput(); } };
        const onUp = e => { activeKeys.current.delete(e.code); resolveInput(); };
        window.addEventListener('keydown', onDown);
        window.addEventListener('keyup', onUp);
        return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
    }, []);

    // ─── Joystick ───────────────────────────────────────────────────────
    const joystickRef = useRef(null);
    const knobRef = useRef(null);

    useEffect(() => {
        const joystick = joystickRef.current;
        if (!joystick) return;

        let startX = 0, startY = 0;

        const handleMove = (clientX, clientY) => {
            const rect = joystick.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const maxR = 45;
            let dx = clientX - centerX;
            let dy = clientY - centerY;
            const mag = Math.hypot(dx, dy);
            if (mag > maxR) { dx = (dx / mag) * maxR; dy = (dy / mag) * maxR; }

            const steer = dx / maxR;
            const forward = -dy / maxR;

            joystickInput.current = { forward, steer };

            // Move knob visual
            if (knobRef.current) {
                knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            }
            resolveInput();
        };

        const resetKnob = () => {
            joystickInput.current = { forward: 0, steer: 0 };
            if (knobRef.current) knobRef.current.style.transform = 'translate(-50%, -50%)';
            resolveInput();
        };

        const onDown = (e) => {
            e.preventDefault();
            joystick.setPointerCapture(e.pointerId);
            handleMove(e.clientX, e.clientY);

            const onMove = (ev) => { ev.preventDefault(); handleMove(ev.clientX, ev.clientY); };
            const onUp = (ev) => { ev.preventDefault(); resetKnob(); joystick.removeEventListener('pointermove', onMove); joystick.removeEventListener('pointerup', onUp); };

            joystick.addEventListener('pointermove', onMove);
            joystick.addEventListener('pointerup', onUp);
        };

        joystick.addEventListener('pointerdown', onDown);
        return () => joystick.removeEventListener('pointerdown', onDown);
    }, []);

    // ─── Button helpers ─────────────────────────────────────────────────
    const handleBtn = (action, pressed) => {
        if (pressed) { activeButtons.current.add(action); soundManager.playClick(); }
        else activeButtons.current.delete(action);
        resolveInput();
    };

    const me = snapshot.players?.find(p => p.id === socket.id);
    const meAlive = me?.alive;

    const formatTime = (ms) => {
        const s = Math.max(0, Math.floor(ms / 1000));
        return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
    };

    // ─── Render ─────────────────────────────────────────────────────────
    return (
        <div className="full-screen" style={{ background: '#030308' }}>
            <PhaserGame snapshot={snapshot} localId={socket.id} />

            {/* ─── HUD Overlay ──────────────────────────────────────────── */}
            <div className="full-screen" style={{ pointerEvents: 'none', zIndex: 4 }}>

                {/* Top Center: Timer + Round */}
                <div style={{
                    position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
                    display: 'flex', gap: '12px', alignItems: 'center'
                }}>
                    {round > 0 && (
                        <div style={{
                            background: 'rgba(0,0,0,0.6)', padding: '6px 14px', borderRadius: '16px',
                            border: '1px solid rgba(0,200,255,0.2)', color: '#aaa', fontSize: '0.85rem',
                            fontWeight: '600'
                        }}>
                            R{round}/{matchData?.maxRounds || room?.maxRounds || 3}
                        </div>
                    )}
                    <div style={{
                        background: 'rgba(0,0,0,0.6)', padding: '8px 20px', borderRadius: '20px',
                        border: '1px solid rgba(0,200,255,0.2)', color: '#fff', fontSize: '1.3rem',
                        fontWeight: 'bold', fontVariantNumeric: 'tabular-nums',
                        textShadow: '0 0 8px rgba(0,200,255,0.4)'
                    }}>
                        {formatTime(snapshot.elapsed || 0)}
                    </div>
                </div>

                {/* Top Right: Alive count + leaderboard */}
                <div style={{
                    position: 'absolute', top: 12, right: 12, width: 180,
                    background: 'rgba(0,0,0,0.6)', padding: '12px', borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.08)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: '#888', fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>Players</span>
                        <span style={{ color: '#00ddff', fontSize: '0.85rem', fontWeight: 700 }}>
                            {snapshot.players?.filter(p => p.alive).length || 0} alive
                        </span>
                    </div>
                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                        {snapshot.players?.slice()
                            .sort((a, b) => (b.alive === a.alive ? 0 : b.alive ? 1 : -1))
                            .map(p => (
                                <div key={p.id} style={{
                                    display: 'flex', justifyContent: 'space-between', padding: '3px 0',
                                    opacity: p.alive ? 1 : 0.4,
                                    color: p.id === socket.id ? '#00ddff' : '#ccc',
                                    fontSize: '0.8rem'
                                }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '110px' }}>
                                        {p.id === socket.id ? '★ ' : ''}{p.name || p.id.slice(0, 4)}
                                        {p.isBot ? ' 🤖' : ''}
                                    </span>
                                    <span style={{ fontSize: '0.7rem', color: p.alive ? '#4f4' : '#f44' }}>
                                        {p.alive ? '●' : '✕'}
                                    </span>
                                </div>
                            ))}
                    </div>
                </div>

                {/* Status bar (my cooldowns) */}
                {me && meAlive && (
                    <div style={{
                        position: 'absolute', bottom: 160, left: '50%', transform: 'translateX(-50%)',
                        display: 'flex', gap: '8px'
                    }}>
                        {me.shield && <StatusPill label="SHIELD" color="#00ddff" />}
                        {me.speedMult > 1 && <StatusPill label="SPEED" color="#00ff88" />}
                        {me.scale > 1.1 && <StatusPill label="MEGA" color="#ff3366" />}
                        {me.slip > 0 && <StatusPill label="OIL!" color="#ff8800" />}
                        {me.magnetTimer > 0 && <StatusPill label="MAGNET" color="#ffaa00" />}
                    </div>
                )}

                {/* Eliminated overlay */}
                {me && !meAlive && rankings.length === 0 && (
                    <div style={{
                        position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)',
                        color: '#ff3344', fontSize: '2.5rem', fontWeight: 'bold',
                        textShadow: '0 0 30px rgba(255,0,0,0.5)',
                        pointerEvents: 'none'
                    }}>
                        ELIMINATED
                    </div>
                )}
            </div>

            {/* ─── Countdown Overlay ────────────────────────────────────── */}
            {countdown > 0 && (
                <div className="full-screen center" style={{ zIndex: 9, pointerEvents: 'none' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{
                            fontSize: '8rem', fontWeight: 'bold', color: '#00ddff',
                            textShadow: '0 0 60px rgba(0,200,255,0.7), 0 0 120px rgba(0,200,255,0.3)',
                            animation: 'countdownPulse 1s ease-out'
                        }}>
                            {countdown}
                        </div>
                        {round > 0 && (
                            <div style={{ fontSize: '1.2rem', color: '#888', marginTop: '-10px' }}>
                                Round {round}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ─── Round End / Match End Screen ─────────────────────────── */}
            {rankings.length > 0 && matchData && (
                <div className="full-screen center" style={{ background: 'rgba(0,0,0,0.85)', zIndex: 10, pointerEvents: 'auto' }}>
                    <div style={{
                        background: 'rgba(10, 15, 30, 0.95)', padding: '2rem 2.5rem',
                        borderRadius: '16px', border: '2px solid rgba(0,200,255,0.3)',
                        boxShadow: '0 0 60px rgba(0,200,255,0.15)',
                        maxWidth: '500px', width: '90vw', maxHeight: '90vh', overflowY: 'auto'
                    }}>
                        <h1 style={{
                            textAlign: 'center', fontSize: '2.5rem', margin: '0 0 0.5rem 0',
                            color: matchData.matchOver ? 'gold' : '#00ddff',
                            textShadow: matchData.matchOver ? '0 0 30px rgba(255,215,0,0.5)' : '0 0 30px rgba(0,200,255,0.4)'
                        }}>
                            {matchData.matchOver ? '🏆 MATCH OVER' : `ROUND ${matchData.round} COMPLETE`}
                        </h1>

                        {matchData.winnerName && (
                            <p style={{ textAlign: 'center', color: 'gold', fontSize: '1.1rem', margin: '0 0 1rem 0' }}>
                                Winner: {matchData.winnerName} {matchData.winnerId === socket.id ? '(You!)' : ''}
                            </p>
                        )}

                        {/* Rankings */}
                        <div style={{ marginBottom: '1.5rem' }}>
                            <h3 style={{ color: '#888', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '8px', borderBottom: '1px solid #222', paddingBottom: '6px' }}>
                                Rankings
                            </h3>
                            {rankings.map(r => (
                                <div key={r.id} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '6px 8px', borderRadius: '6px',
                                    background: r.id === socket.id ? 'rgba(0,200,255,0.1)' : 'transparent',
                                    borderBottom: '1px solid rgba(255,255,255,0.03)'
                                }}>
                                    <span style={{ color: r.rank === 1 ? 'gold' : r.rank === 2 ? '#ccc' : r.rank === 3 ? '#cd7f32' : '#888' }}>
                                        {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`}
                                        {' '}{r.name} {r.id === socket.id ? '(You)' : ''}
                                    </span>
                                    <span style={{ color: '#00ddff', fontSize: '0.85rem' }}>+{r.score} pts</span>
                                </div>
                            ))}
                        </div>

                        {/* Cumulative Scores */}
                        {matchData.scores && Object.keys(matchData.scores).length > 0 && (
                            <div style={{ marginBottom: '1.5rem' }}>
                                <h3 style={{ color: '#888', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '8px' }}>
                                    Total Scores
                                </h3>
                                {Object.entries(matchData.scores)
                                    .sort(([, a], [, b]) => b - a)
                                    .map(([id, score], i) => {
                                        const p = matchData.stats?.find(s => s.id === id);
                                        return (
                                            <div key={id} style={{
                                                display: 'flex', justifyContent: 'space-between',
                                                padding: '4px 8px',
                                                color: id === socket.id ? '#00ddff' : '#aaa',
                                                fontSize: '0.85rem'
                                            }}>
                                                <span>{i + 1}. {p?.name || id.slice(0, 6)} {p?.isBot ? '🤖' : ''}</span>
                                                <span style={{ fontWeight: 'bold' }}>{score} pts</span>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}

                        {/* Player Stats */}
                        {matchData.stats && (
                            <details style={{ marginBottom: '1rem' }}>
                                <summary style={{ color: '#888', fontSize: '0.8rem', cursor: 'pointer', textTransform: 'uppercase' }}>
                                    Stats
                                </summary>
                                <div style={{ marginTop: '8px' }}>
                                    {matchData.stats
                                        .filter(s => s.id === socket.id)
                                        .map(s => (
                                            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: '0.8rem', color: '#aaa' }}>
                                                <span>Survival</span><span style={{ color: '#fff' }}>{s.survivalTime}s</span>
                                                <span>Dashes</span><span style={{ color: '#fff' }}>{s.dashesUsed}</span>
                                                <span>Shots</span><span style={{ color: '#fff' }}>{s.shotsFired}</span>
                                                <span>Powerups</span><span style={{ color: '#fff' }}>{s.powerupsCollected}</span>
                                            </div>
                                        ))}
                                </div>
                            </details>
                        )}

                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                            {matchData.matchOver ? (
                                <>
                                    <button className="btn" onClick={() => { socket.emit('playAgain', { roomId: room?.id }); onBack(); }}>
                                        PLAY AGAIN
                                    </button>
                                    <button className="btn btn-secondary" onClick={onBack}>LOBBY</button>
                                </>
                            ) : (
                                <div style={{ color: '#666', fontSize: '0.9rem', padding: '8px' }}>
                                    Next round starting...
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Mobile Controls ──────────────────────────────────────── */}
            <div className="full-screen" style={{ pointerEvents: 'none', zIndex: 5 }}>
                {/* Joystick */}
                <div
                    ref={joystickRef}
                    style={{
                        position: 'absolute', bottom: 30, left: 30,
                        width: 110, height: 110,
                        background: 'rgba(255,255,255,0.06)',
                        borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.15)',
                        pointerEvents: 'auto', touchAction: 'none'
                    }}
                >
                    <div
                        ref={knobRef}
                        style={{
                            position: 'absolute', top: '50%', left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: 44, height: 44,
                            background: 'rgba(0, 200, 255, 0.3)',
                            borderRadius: '50%',
                            border: '2px solid rgba(0, 200, 255, 0.5)',
                            boxShadow: '0 0 10px rgba(0,200,255,0.3)',
                            transition: 'none'
                        }}
                    />
                </div>

                {/* Action Buttons */}
                <div style={{ position: 'absolute', bottom: 30, right: 20, pointerEvents: 'auto', display: 'flex', gap: '14px', alignItems: 'flex-end' }}>
                    <ActionButton
                        label="SHOOT"
                        color="#ff2255"
                        action="shoot"
                        onAction={handleBtn}
                        cooldown={me?.shootCooldown}
                        maxCooldown={0.8}
                    />
                    <ActionButton
                        label="NITRO"
                        color="#00ccff"
                        action="nitro"
                        onAction={handleBtn}
                        cooldown={me?.dashCooldown}
                        maxCooldown={1.5}
                        size={85}
                    />
                </div>
            </div>
        </div>
    );
}

// ─── Sub-components ─────────────────────────────────────────────────────
function StatusPill({ label, color }) {
    return (
        <div style={{
            background: `${color}22`, border: `1px solid ${color}66`,
            color, padding: '3px 10px', borderRadius: '12px',
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '1px'
        }}>
            {label}
        </div>
    );
}

function ActionButton({ label, color, action, onAction, cooldown = 0, maxCooldown = 1, size = 75 }) {
    const ready = !cooldown || cooldown <= 0;
    const pct = ready ? 0 : (cooldown / maxCooldown) * 100;

    return (
        <div
            onPointerDown={e => { e.preventDefault(); onAction(action, true); }}
            onPointerUp={e => { e.preventDefault(); onAction(action, false); }}
            onPointerLeave={e => { e.preventDefault(); onAction(action, false); }}
            style={{
                width: size, height: size,
                borderRadius: '50%',
                background: `${color}22`,
                border: `2px solid ${ready ? color : '#444'}`,
                color: ready ? color : '#555',
                fontSize: '0.8rem', fontWeight: 'bold',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                userSelect: 'none', touchAction: 'none',
                position: 'relative', overflow: 'hidden',
                transition: 'border-color 0.2s, color 0.2s',
                boxShadow: ready ? `0 0 15px ${color}33` : 'none'
            }}
        >
            {label}
            {pct > 0 && (
                <div style={{
                    position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${pct}%`,
                    background: 'rgba(0,0,0,0.5)', borderRadius: '50%', pointerEvents: 'none'
                }} />
            )}
        </div>
    );
}
