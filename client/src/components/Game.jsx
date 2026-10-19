import React, { useEffect, useState, useRef } from 'react';
import PhaserGame from './PhaserGame';
import { socket } from '../net/socket';
import { soundManager } from '../utils/SoundManager';

// Screen-edge offsets that respect phone notches / home indicators
const EDGE_TOP = 'max(10px, env(safe-area-inset-top))';
const EDGE_RIGHT = 'max(12px, env(safe-area-inset-right))';
const EDGE_LEFT = 'max(12px, env(safe-area-inset-left))';
const EDGE_BOTTOM = 'max(16px, env(safe-area-inset-bottom))';

export default function Game({ room, player, onBack }) {
    const [snapshot, setSnapshot] = useState({ players: [], powerups: [], elapsed: 0 });
    const [rankings, setRankings] = useState([]);
    const [matchData, setMatchData] = useState(null);
    const [countdown, setCountdown] = useState(0);
    const [round, setRound] = useState(0);
    const [maxRounds, setMaxRounds] = useState(room?.maxRounds || 3);
    const [feed, setFeed] = useState([]);          // elimination feed
    const [banner, setBanner] = useState(null);    // big arena announcements
    const [myElim, setMyElim] = useState(null);
    const [nextIn, setNextIn] = useState(0);

    const inputRef = useRef({ forward: 0, steer: 0, dash: false, shoot: false });
    const seqRef = useRef(0);
    const activeKeys = useRef(new Set());
    const activeButtons = useRef(new Set());
    const joystickInput = useRef({ forward: 0, steer: 0 });

    const joyRef = useRef({ active: false, bx: 0, by: 0, maxR: 55 });
    const [joyView, setJoyView] = useState({ active: false, bx: 0, by: 0, kx: 0, ky: 0 });
    const [touchUI, setTouchUI] = useState(false);
    const [listOpen, setListOpen] = useState(false);

    useEffect(() => {
        const coarse = (navigator.maxTouchPoints || 0) > 0 ||
            (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        setTouchUI(!!coarse);
    }, []);

    // Control scheme: 'joystick' or 'buttons'
    const [ctrlMode, setCtrlMode] = useState(() => {
        try { return localStorage.getItem('dasharena.ctrlmode') || 'joystick'; } catch (_) { return 'joystick'; }
    });
    const switchCtrl = () => {
        setCtrlMode(m => {
            const next = m === 'joystick' ? 'buttons' : 'joystick';
            try { localStorage.setItem('dasharena.ctrlmode', next); } catch (_) { /* ignore */ }
            return next;
        });
        joystickInput.current = { forward: 0, steer: 0 };
        ['up', 'down', 'left', 'right'].forEach(a => activeButtons.current.delete(a));
        setJoyView({ active: false, bx: 0, by: 0, kx: 0, ky: 0 });
        resolveInput();
        soundManager.playClick();
    };

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

        socket.on('playerEliminated', ({ id, name, by, byId, reason }) => {
            soundManager.playElimination();
            const key = `${id}-${Date.now()}`;
            setFeed(f => [...f.slice(-3), { key, id, name, by, byId, reason }]);
            setTimeout(() => setFeed(f => f.filter(e => e.key !== key)), 4500);
            if (id === socket.id) setMyElim({ by, reason });
        });

        socket.on('arenaEvent', ({ type }) => {
            const b = type === 'suddenDeath'
                ? { title: 'SUDDEN DEATH', sub: 'The fence is electric — touch it and you\'re out!', color: '#4fd8ff' }
                : { title: 'ARENA SHRINKING', sub: 'Stay inside the fence', color: '#ffb347' };
            setBanner(b);
            soundManager.playCountdown();
            setTimeout(() => setBanner(cur => (cur === b ? null : cur)), 2800);
        });

        socket.on('countdown', ({ count }) => {
            setCountdown(count);
            if (count > 0) soundManager.playCountdown();
            if (count === 0) soundManager.playGo();
        });

        socket.on('matchStart', ({ count, round: r, maxRounds: mr }) => {
            setRankings([]);
            setMatchData(null);
            setCountdown(count);
            setRound(r);
            if (mr) setMaxRounds(mr);
            setFeed([]);
            setBanner(null);
            setMyElim(null);
        });

        socket.on('matchEnd', (data) => {
            setRankings(data.rankings || []);
            setMatchData(data);
            setCountdown(0);
            if (data.maxRounds) setMaxRounds(data.maxRounds);
            if (!data.matchOver) setNextIn(6);
            const myRank = (data.rankings || []).findIndex(r => r.id === socket.id);
            if (myRank === 0) soundManager.playWin();
            else soundManager.playLose();
        });

        return () => {
            socket.off('snapshot');
            socket.off('collision');
            socket.off('powerupCollected');
            socket.off('playerEliminated');
            socket.off('arenaEvent');
            socket.off('countdown');
            socket.off('matchStart');
            socket.off('matchEnd');
        };
    }, []);

    // "Next round in N" ticker on the results screen
    useEffect(() => {
        if (nextIn <= 0) return;
        const t = setTimeout(() => setNextIn(n => n - 1), 1000);
        return () => clearTimeout(t);
    }, [nextIn]);

    // ─── Input resolution ───────────────────────────────────────────────
    function resolveInput() {
        let forward = 0, steer = 0, dash = false, shoot = false, drop = false;

        // Keyboard
        if (activeKeys.current.has('ArrowUp') || activeKeys.current.has('KeyW')) forward += 1;
        if (activeKeys.current.has('ArrowDown') || activeKeys.current.has('KeyS')) forward -= 0.4;
        if (activeKeys.current.has('ArrowLeft') || activeKeys.current.has('KeyA')) steer -= 1;
        if (activeKeys.current.has('ArrowRight') || activeKeys.current.has('KeyD')) steer += 1;
        if (activeKeys.current.has('Space')) dash = true;
        if (activeKeys.current.has('ShiftLeft') || activeKeys.current.has('ShiftRight') || activeKeys.current.has('KeyF')) shoot = true;
        if (activeKeys.current.has('KeyQ') || activeKeys.current.has('KeyE')) drop = true;

        // Joystick
        forward += joystickInput.current.forward;
        steer += joystickInput.current.steer;

        // Buttons
        if (activeButtons.current.has('nitro')) dash = true;
        if (activeButtons.current.has('shoot')) shoot = true;
        if (activeButtons.current.has('drop')) drop = true;
        if (activeButtons.current.has('up')) forward += 1;
        if (activeButtons.current.has('down')) forward -= 0.5;
        if (activeButtons.current.has('left')) steer -= 1;
        if (activeButtons.current.has('right')) steer += 1;

        forward = Math.max(-1, Math.min(1, forward));
        steer = Math.max(-1, Math.min(1, steer));

        if (inputRef.current.forward !== forward || inputRef.current.steer !== steer ||
            inputRef.current.dash !== dash || inputRef.current.shoot !== shoot ||
            inputRef.current.drop !== drop) {
            if (shoot && !inputRef.current.shoot) soundManager.playShoot();
            if (dash && !inputRef.current.dash) soundManager.playDash();
            inputRef.current = { forward, steer, dash, shoot, drop };
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

    // ─── Floating joystick (appears where you touch the left half) ───────
    const zoneRef = useRef(null);
    useEffect(() => {
        if (!touchUI || ctrlMode !== 'joystick') return;
        const zone = zoneRef.current;
        if (!zone) return;
        const computeMaxR = () => Math.max(42, Math.min(70, window.innerWidth * 0.11));

        const onDown = (e) => {
            e.preventDefault();
            try { zone.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            const maxR = computeMaxR();
            joyRef.current = { active: true, bx: e.clientX, by: e.clientY, maxR };
            setJoyView({ active: true, bx: e.clientX, by: e.clientY, kx: e.clientX, ky: e.clientY });
            joystickInput.current = { forward: 0, steer: 0 };
            resolveInput();
        };
        const onMove = (e) => {
            const j = joyRef.current;
            if (!j.active) return;
            e.preventDefault();
            let dx = e.clientX - j.bx, dy = e.clientY - j.by;
            const mag = Math.hypot(dx, dy);
            if (mag > j.maxR) { dx = (dx / mag) * j.maxR; dy = (dy / mag) * j.maxR; }
            joystickInput.current = { forward: -dy / j.maxR, steer: dx / j.maxR };
            setJoyView({ active: true, bx: j.bx, by: j.by, kx: j.bx + dx, ky: j.by + dy });
            resolveInput();
        };
        const onUp = (e) => {
            if (!joyRef.current.active) return;
            e.preventDefault();
            joyRef.current = { active: false, bx: 0, by: 0, maxR: computeMaxR() };
            setJoyView({ active: false, bx: 0, by: 0, kx: 0, ky: 0 });
            joystickInput.current = { forward: 0, steer: 0 };
            resolveInput();
        };
        zone.addEventListener('pointerdown', onDown);
        zone.addEventListener('pointermove', onMove);
        zone.addEventListener('pointerup', onUp);
        zone.addEventListener('pointercancel', onUp);
        return () => {
            zone.removeEventListener('pointerdown', onDown);
            zone.removeEventListener('pointermove', onMove);
            zone.removeEventListener('pointerup', onUp);
            zone.removeEventListener('pointercancel', onUp);
        };
    }, [touchUI, ctrlMode]);

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
        <div className="full-screen" style={{
            background: '#030308', touchAction: 'none',
            userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
        }}>
            <PhaserGame snapshot={snapshot} localId={socket.id} />

            {/* ─── HUD Overlay ──────────────────────────────────────────── */}
            <div className="full-screen" style={{ pointerEvents: 'none', zIndex: 4 }}>

                <Minimap snapshot={snapshot} localId={socket.id} size={touchUI ? 84 : 116} />

                {/* Top Center: Timer + Round */}
                <div style={{
                    position: 'absolute', top: EDGE_TOP, left: '50%', transform: 'translateX(-50%)',
                    display: 'flex', gap: '8px', alignItems: 'center'
                }}>
                    {round > 0 && (
                        <div style={{
                            background: 'rgba(0,0,0,0.6)', padding: touchUI ? '4px 10px' : '6px 14px', borderRadius: '16px',
                            border: '1px solid rgba(232,160,48,0.25)', color: '#aaa',
                            fontSize: touchUI ? '0.72rem' : '0.85rem', fontWeight: '600'
                        }}>
                            ROUND {round}/{maxRounds}
                        </div>
                    )}
                    <div style={{
                        background: 'rgba(0,0,0,0.6)', padding: touchUI ? '5px 14px' : '8px 20px', borderRadius: '20px',
                        border: '1px solid rgba(232,160,48,0.25)', color: '#fff',
                        fontSize: touchUI ? '1.05rem' : '1.3rem',
                        fontWeight: 'bold', fontVariantNumeric: 'tabular-nums',
                    }}>
                        {formatTime(snapshot.elapsed || 0)}
                    </div>
                </div>

                {/* Arena phase: shrink warning / sudden death */}
                {countdown <= 0 && !matchData && (snapshot.suddenDeath || (snapshot.shrinkIn > 0 && snapshot.shrinkIn <= 10)) && (
                    <div style={{
                        position: 'absolute', top: `calc(${EDGE_TOP} + ${touchUI ? 70 : 88}px)`,
                        left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap',
                        padding: '4px 12px', borderRadius: 14, fontWeight: 800, letterSpacing: 1,
                        fontSize: touchUI ? '0.7rem' : '0.8rem',
                        color: snapshot.suddenDeath ? '#4fd8ff' : '#ffb347',
                        background: 'rgba(0,0,0,0.6)',
                        border: `1px solid ${snapshot.suddenDeath ? '#4fd8ff88' : '#ffb34788'}`,
                    }}>
                        {snapshot.suddenDeath ? '⚡ SUDDEN DEATH — ELECTRIC FENCE' : `ARENA SHRINKS IN ${Math.ceil(snapshot.shrinkIn)}`}
                    </div>
                )}

                {/* Elimination feed */}
                <div style={{
                    position: 'absolute', left: EDGE_LEFT, top: `calc(${EDGE_TOP} + ${touchUI ? 136 : 130}px)`,
                    display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '46vw',
                }}>
                    {feed.map(e => (
                        <div key={e.key} style={{
                            background: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: '3px 8px',
                            fontSize: touchUI ? '0.68rem' : '0.78rem', color: '#ddd',
                            borderLeft: `3px solid ${e.id === socket.id ? '#ff3344' : e.byId === socket.id ? '#4f4' : '#e8a030'}`,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                            {e.by ? <><b style={{ color: e.byId === socket.id ? '#4f4' : '#fff' }}>{e.byId === socket.id ? 'You' : e.by}</b> knocked out </> : ''}
                            <b style={{ color: e.id === socket.id ? '#ff5566' : '#fff' }}>{e.id === socket.id ? 'you' : e.name}</b>
                            {!e.by && (e.reason === 'electric' ? ' got zapped ⚡' : ' crashed out')}
                        </div>
                    ))}
                </div>

                {/* Big arena announcements */}
                {banner && (
                    <div style={{
                        position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
                        textAlign: 'center', pointerEvents: 'none', animation: 'bannerIn 0.4s ease-out',
                    }}>
                        <div style={{
                            fontSize: touchUI ? '1.9rem' : '2.8rem', fontWeight: 900, letterSpacing: 2,
                            color: banner.color, textShadow: `0 0 30px ${banner.color}aa, 0 3px 0 #000`, whiteSpace: 'nowrap',
                        }}>{banner.title}</div>
                        <div style={{ color: '#ddd', fontSize: touchUI ? '0.85rem' : '1rem', textShadow: '0 2px 4px #000' }}>{banner.sub}</div>
                    </div>
                )}

                {/* Top Right: Alive count + leaderboard (folds into a chip on touch) */}
                <div style={{
                    position: 'absolute', top: EDGE_TOP, right: EDGE_RIGHT,
                    width: touchUI ? (listOpen ? 150 : 'auto') : 180,
                    background: 'rgba(0,0,0,0.6)', padding: touchUI ? '6px 10px' : '12px', borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    pointerEvents: touchUI ? 'auto' : 'none',
                }}>
                    <div
                        onClick={touchUI ? () => setListOpen(o => !o) : undefined}
                        style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
                            marginBottom: touchUI && !listOpen ? 0 : '8px', cursor: touchUI ? 'pointer' : 'default',
                        }}
                    >
                        <span style={{ color: '#888', fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 600 }}>
                            {touchUI ? '👥' : 'Players'}
                        </span>
                        <span style={{ color: '#e8a030', fontSize: touchUI ? '0.78rem' : '0.85rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {snapshot.players?.filter(p => p.alive).length || 0} alive{touchUI ? (listOpen ? ' ▴' : ' ▾') : ''}
                        </span>
                    </div>
                    {(!touchUI || listOpen) && <div style={{ maxHeight: touchUI ? '40vh' : '200px', overflowY: 'auto' }}>
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
                    </div>}
                </div>

                {/* Status pills (active effects) — under the timer, away from thumbs */}
                {me && meAlive && (
                    <div style={{
                        position: 'absolute', top: `calc(${EDGE_TOP} + ${touchUI ? 40 : 52}px)`,
                        left: '50%', transform: 'translateX(-50%)',
                        display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '60vw',
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
                        color: '#ff3344', fontSize: touchUI ? '2rem' : '2.5rem', fontWeight: 'bold',
                        textShadow: '0 0 30px rgba(255,0,0,0.5)', textAlign: 'center',
                        pointerEvents: 'none'
                    }}>
                        ELIMINATED
                        <div style={{ fontSize: '0.9rem', color: '#ccc', fontWeight: 600, textShadow: '0 2px 4px #000' }}>
                            {myElim?.by ? `Knocked out by ${myElim.by}` : myElim?.reason === 'electric' ? 'Zapped by the electric fence' : 'You left the arena'}
                            {' · spectating'}
                        </div>
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
                            <div style={{ fontSize: '1.4rem', color: '#fff', fontWeight: 800, letterSpacing: 3, marginTop: '-10px', textShadow: '0 2px 6px #000' }}>
                                {round >= maxRounds && maxRounds > 1 ? 'FINAL ROUND' : `ROUND ${round} OF ${maxRounds}`}
                            </div>
                        )}
                        <div style={{ fontSize: '0.85rem', color: '#9ab', marginTop: 6, textShadow: '0 2px 4px #000' }}>
                            Push rivals through the fence · last car standing wins
                        </div>
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
                            {matchData.matchOver ? '🏆 MATCH OVER' : `ROUND ${matchData.round} OF ${matchData.maxRounds} DONE`}
                        </h1>
                        {matchData.matchOver && (
                            <p style={{ textAlign: 'center', color: '#9ab', fontSize: '0.85rem', margin: '0 0 0.5rem 0' }}>
                                {matchData.maxRounds} rounds played — final standings below
                            </p>
                        )}

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
                                    <button className="btn btn-secondary" onClick={() => { socket.emit('leaveRoom', { roomId: room?.id }); onBack(); }}>LOBBY</button>
                                </>
                            ) : (
                                <div style={{ color: '#666', fontSize: '0.9rem', padding: '8px' }}>
                                    {matchData.round + 1 >= matchData.maxRounds ? 'Final round' : `Round ${matchData.round + 1} of ${matchData.maxRounds}`} starts in {Math.max(1, nextIn)}…
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Touch Controls (touch devices only) ──────────────────── */}
            {touchUI && (
                <>
                    {ctrlMode === 'joystick' ? (
                        <>
                            {/* Dynamic joystick zone: left half of the screen */}
                            <div
                                ref={zoneRef}
                                style={{
                                    position: 'absolute', left: 0, top: '28%', bottom: 0, width: '48%',
                                    zIndex: 5, touchAction: 'none', pointerEvents: 'auto',
                                }}
                            />
                            {!joyView.active && (
                                <div style={{
                                    position: 'absolute', zIndex: 5, pointerEvents: 'none',
                                    left: `calc(${EDGE_LEFT} + 14px)`, bottom: `calc(${EDGE_BOTTOM} + 14px)`,
                                    width: 'clamp(96px, 28vmin, 120px)', height: 'clamp(96px, 28vmin, 120px)',
                                    borderRadius: '50%', border: '2px dashed rgba(232,160,48,0.3)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'rgba(232,160,48,0.55)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '1px',
                                }}>STEER</div>
                            )}
                            {joyView.active && (
                                <div style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}>
                                    <div style={{
                                        position: 'absolute', left: joyView.bx, top: joyView.by,
                                        width: 120, height: 120, marginLeft: -60, marginTop: -60,
                                        borderRadius: '50%', background: 'rgba(255,255,255,0.08)',
                                        border: '2px solid rgba(232,160,48,0.35)',
                                        boxShadow: '0 0 20px rgba(0,0,0,0.4)',
                                    }} />
                                    <div style={{
                                        position: 'absolute', left: joyView.kx, top: joyView.ky,
                                        width: 54, height: 54, marginLeft: -27, marginTop: -27,
                                        borderRadius: '50%', background: 'rgba(232,160,48,0.35)',
                                        border: '2px solid rgba(232,160,48,0.7)',
                                        boxShadow: '0 0 14px rgba(232,160,48,0.4)',
                                    }} />
                                </div>
                            )}
                        </>
                    ) : (
                        /* Directional button pad (left side) */
                        <div style={{
                            position: 'absolute', left: EDGE_LEFT, bottom: EDGE_BOTTOM,
                            zIndex: 6, pointerEvents: 'auto', display: 'grid',
                            gridTemplateColumns: 'repeat(3, clamp(44px, 13vmin, 58px))',
                            gridTemplateRows: 'repeat(2, clamp(44px, 13vmin, 58px))', gap: '6px',
                        }}>
                            <DirButton label="▲" action="up" grid="1 / 2 / 2 / 3" onAction={handleBtn} />
                            <DirButton label="◀" action="left" grid="2 / 1 / 3 / 2" onAction={handleBtn} />
                            <DirButton label="▼" action="down" grid="2 / 2 / 3 / 3" onAction={handleBtn} />
                            <DirButton label="▶" action="right" grid="2 / 3 / 3 / 4" onAction={handleBtn} />
                        </div>
                    )}

                    {/* Right-thumb cluster: NITRO in the corner, SHOOT arcs up-left, DROP above */}
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none',
                        '--n': 'clamp(68px, 21vmin, 96px)',
                        '--s': 'clamp(54px, 16vmin, 74px)',
                        '--d': 'clamp(46px, 13vmin, 62px)',
                    }}>
                        <ActionButton label="NITRO" color="#00ccff" action="nitro" onAction={handleBtn}
                            cooldown={me?.dashCooldown} maxCooldown={2} size="var(--n)" fontSize="0.9rem"
                            style={{ right: EDGE_RIGHT, bottom: EDGE_BOTTOM }} />
                        <ActionButton label="SHOOT" color="#ff2255" action="shoot" onAction={handleBtn}
                            cooldown={me?.shootCooldown} maxCooldown={0.8} size="var(--s)"
                            style={{
                                right: `calc(${EDGE_RIGHT} + var(--n) + 10px)`,
                                bottom: `calc(${EDGE_BOTTOM} + var(--n) * 0.32)`,
                            }} />
                        {me?.weapon && (
                            <ActionButton label={me.weapon === 'oil' ? 'OIL' : 'FLIP'} color="#b24aff"
                                action="drop" onAction={handleBtn} size="var(--d)" fontSize="0.72rem"
                                style={{
                                    right: `calc(${EDGE_RIGHT} + var(--n) * 0.35)`,
                                    bottom: `calc(${EDGE_BOTTOM} + var(--n) + 12px)`,
                                }} />
                        )}
                    </div>

                    {/* Control-scheme toggle (under the minimap) */}
                    <button
                        onClick={switchCtrl}
                        style={{
                            position: 'absolute', top: `calc(${EDGE_TOP} + 92px)`, left: EDGE_LEFT,
                            zIndex: 7, pointerEvents: 'auto',
                            background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(232,160,48,0.5)',
                            color: '#e8a030', borderRadius: 16, padding: '5px 10px',
                            fontSize: '0.66rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                        }}
                    >
                        {ctrlMode === 'joystick' ? '⇄ Buttons' : '⇄ Joystick'}
                    </button>
                </>
            )}

            {/* Desktop keyboard hint */}
            {!touchUI && (
                <div style={{
                    position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 5, pointerEvents: 'none',
                    background: 'rgba(0,0,0,0.45)', borderRadius: 10, padding: '6px 14px',
                    color: '#9fb0c3', fontSize: '0.72rem', letterSpacing: '0.3px',
                }}>
                    WASD / Arrows to drive · Space: Nitro · Shift / F: Shoot · Q: Drop trap
                </div>
            )}

            {/* Held trap indicator (desktop) */}
            {!touchUI && me?.weapon && (
                <div style={{
                    position: 'absolute', bottom: 44, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 6, pointerEvents: 'none',
                    background: 'rgba(178,74,255,0.18)', border: '1px solid #b24aff',
                    color: '#d9b3ff', borderRadius: 10, padding: '5px 12px',
                    fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.3px',
                }}>
                    Trap ready: {me.weapon === 'oil' ? 'OIL SLICK' : 'REVERSE'} — press Q to drop
                </div>
            )}
        </div>
    );
}

// ─── Sub-components ─────────────────────────────────────────────────────
function Minimap({ snapshot, localId, size = 116 }) {
    const ref = useRef(null);
    useEffect(() => {
        const cv = ref.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        const S = size, dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (cv.width !== S * dpr) { cv.width = S * dpr; cv.height = S * dpr; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, S, S);
        const R = (snapshot.arenaBase || snapshot.arenaRadius || 1000);
        const cur = (snapshot.arenaRadius || R) / R;
        const cx = S / 2, cy = S / 2, rad = S / 2 - 6;

        // Original arena (faint) and the live fence
        ctx.fillStyle = 'rgba(255,255,255,0.03)';
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath(); ctx.arc(cx, cy, rad * cur, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = snapshot.suddenDeath ? 'rgba(79,216,255,0.9)' : 'rgba(232,160,48,0.6)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, rad * cur, 0, Math.PI * 2); ctx.stroke();

        for (const p of (snapshot.players || [])) {
            if (!p.alive) continue;
            const px = cx + (p.x / R) * rad;
            const py = cy + (p.y / R) * rad;
            const me = p.id === localId;
            ctx.fillStyle = me ? '#8fe3ff' : (p.isBot ? '#e8a030' : '#4ade80');
            ctx.beginPath(); ctx.arc(px, py, me ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
            if (me) {
                ctx.strokeStyle = '#8fe3ff'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.stroke();
            }
        }
    }, [snapshot, localId, size]);

    return (
        <div style={{
            position: 'absolute', top: EDGE_TOP, left: EDGE_LEFT, width: size, height: size,
            borderRadius: '50%', overflow: 'hidden',
            background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
        }}>
            <canvas ref={ref} style={{ width: size, height: size }} />
        </div>
    );
}

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

function DirButton({ label, action, onAction, grid }) {
    return (
        <div
            onPointerDown={e => { e.preventDefault(); onAction(action, true); }}
            onPointerUp={e => { e.preventDefault(); onAction(action, false); }}
            onPointerLeave={e => { e.preventDefault(); onAction(action, false); }}
            onPointerCancel={e => { e.preventDefault(); onAction(action, false); }}
            style={{
                gridArea: grid, borderRadius: 12,
                background: 'rgba(255,255,255,0.06)', border: '2px solid rgba(232,160,48,0.5)',
                color: '#e8a030', fontSize: '1.3rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                userSelect: 'none', touchAction: 'none',
            }}
        >{label}</div>
    );
}

function ActionButton({ label, color, action, onAction, cooldown = 0, maxCooldown = 1, size = 75, fontSize = '0.8rem', style }) {
    const ready = !cooldown || cooldown <= 0;
    const pct = ready ? 0 : (cooldown / maxCooldown) * 100;

    return (
        <div
            onPointerDown={e => { e.preventDefault(); onAction(action, true); }}
            onPointerUp={e => { e.preventDefault(); onAction(action, false); }}
            onPointerLeave={e => { e.preventDefault(); onAction(action, false); }}
            onPointerCancel={e => { e.preventDefault(); onAction(action, false); }}
            style={{
                position: 'absolute', pointerEvents: 'auto',
                width: size, height: size,
                borderRadius: '50%',
                background: `radial-gradient(circle at 50% 35%, ${color}40, ${color}14)`,
                border: `2px solid ${ready ? color : '#444'}`,
                color: ready ? color : '#555',
                fontSize, fontWeight: 'bold', letterSpacing: '0.5px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
                overflow: 'hidden',
                transition: 'border-color 0.2s, color 0.2s',
                boxShadow: ready ? `0 0 16px ${color}40, inset 0 0 12px ${color}22` : 'none',
                ...style,
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
