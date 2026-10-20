import React, { useEffect, useState, useRef } from 'react';
import PhaserGame from './PhaserGame';
import { socket } from '../net/socket';
import { soundManager } from '../utils/SoundManager';
import { net } from '../net/netcode';
import { NITRO_COOLDOWN } from '../../../shared/physics.mjs';

// Screen-edge offsets that respect phone notches / home indicators
const EDGE_TOP = 'max(10px, env(safe-area-inset-top))';
const EDGE_RIGHT = 'max(12px, env(safe-area-inset-right))';
const EDGE_LEFT = 'max(12px, env(safe-area-inset-left))';
const EDGE_BOTTOM = 'max(16px, env(safe-area-inset-bottom))';

export default function Game({ room, player, onBack, onToRoom, startInfo }) {
    // A matchStart that fired just before this screen mounted (only if fresh)
    const early = startInfo && Date.now() - startInfo.at < 1500 ? startInfo : null;
    const [snapshot, setSnapshot] = useState({ players: [], powerups: [], elapsed: 0 });
    const [rankings, setRankings] = useState([]);
    const [matchData, setMatchData] = useState(null);
    const [countdown, setCountdown] = useState(early ? early.count : 0);
    const [round, setRound] = useState(early ? early.round : (room?.round || 0));
    const [maxRounds, setMaxRounds] = useState(early?.maxRounds || room?.maxRounds || 3);
    const [feed, setFeed] = useState([]);          // elimination feed
    const [banner, setBanner] = useState(null);    // big arena announcements
    const [myElim, setMyElim] = useState(null);
    const [nextIn, setNextIn] = useState(0);
    const [goFlash, setGoFlash] = useState(false);
    const [spectateId, setSpectateId] = useState(null);
    const [soloOut, setSoloOut] = useState(null);     // solo run ended → heading back to lobby
    const followRef = useRef(null);

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
        try { return localStorage.getItem('dasharena.ctrlmode') || 'buttons'; } catch (_) { return 'buttons'; }
    });
    const switchCtrl = () => {
        setCtrlMode(m => {
            const next = m === 'joystick' ? 'buttons' : 'joystick';
            try { localStorage.setItem('dasharena.ctrlmode', next); } catch (_) { /* ignore */ }
            return next;
        });
        joystickInput.current = { forward: 0, steer: 0 };
        ['gas', 'brake', 'left', 'right'].forEach(a => activeButtons.current.delete(a));
        setJoyView({ active: false, bx: 0, by: 0, kx: 0, ky: 0 });
        resolveInput();
        soundManager.playClick();
    };

    // ─── Socket listeners ───────────────────────────────────────────────
    useEffect(() => {
        soundManager.playMusic('race');

        net.reset();
        // HUD state comes from the netcode module (20 updates/s)
        const unsub = net.subscribe(snap => setSnapshot(snap));
        if (net.snap) setSnapshot(net.snap);

        // Engine + tyre audio follow your own (predicted) car every 50 ms
        const audioTimer = setInterval(() => {
            const me = net.snap?.players?.find(p => p.id === socket.id);
            const local = net.local;
            if (!me || !me.alive || !local) { soundManager.stopEngine(); soundManager.setBladeWhine(false); return; }
            soundManager.startEngine(me.carType);
            const v = net.localSpeed();
            soundManager.updateEngine(v, inputRef.current.forward, local.nitro > 0 || me.speedMult > 1);
            soundManager.setSkid(local.skid ? Math.min(1, 0.35 + v / 500) : 0);
            soundManager.setBladeWhine(!!me.blades);
        }, 50);

        socket.on('airdrop', () => soundManager.playPlane());

        // Rockets + explosions: full volume for yours, quieter the further away
        const distToFocus = (x, y) => {
            const f = net.snap?.players?.find(p => p.id === (followRef.current || socket.id));
            return f ? Math.hypot(f.x - x, f.y - y) : 9999;
        };
        socket.on('rocketFired', ({ id }) => {
            const p = net.snap?.players?.find(q => q.id === id);
            soundManager.playRocket(id === socket.id ? 1 : p ? Math.max(0, 0.5 - distToFocus(p.x, p.y) / 2000) : 0);
        });
        socket.on('explosion', ({ x, y, big, ids }) => {
            const focus = followRef.current || socket.id;
            const vol = ids && ids.includes(focus) ? 1 : Math.max(0.1, 1 - distToFocus(x, y) / 1200);
            soundManager.playExplosion(vol, !!big);
            if (ids && ids.includes(socket.id)) soundManager.vibrate(big ? [120, 60, 220] : 140);
        });

        socket.on('collision', ({ impact, ids, type }) => {
            // Only your own car's hits (or the car you're watching) make noise
            const focus = followRef.current || socket.id;
            if (!Array.isArray(ids) || !ids.includes(focus)) return;
            soundManager.playCrash(impact, type);
            if (ids.includes(socket.id)) soundManager.vibrate(Math.min(250, 30 + impact / 4));
        });

        socket.on('soloOut', (data) => {
            setSoloOut(data);
            soundManager.stopEngine();
            soundManager.playLose();
            setTimeout(() => (onToRoom || onBack)(), 2800);
        });

        socket.on('powerupCollected', ({ playerId, type }) => {
            if (playerId === socket.id) soundManager.playPowerup();
        });

        socket.on('playerEliminated', ({ id, name, by, byId, reason }) => {
            if (id === socket.id) { soundManager.playElimination(); soundManager.vibrate([80, 60, 160]); }
            else if (byId === socket.id) soundManager.playPowerup();   // your knock-out!
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
            soundManager.playArenaWarning();
            setTimeout(() => setBanner(cur => (cur === b ? null : cur)), 2800);
        });

        socket.on('countdown', ({ count }) => {
            setCountdown(count);
            if (count > 0) soundManager.playCountdown();
            if (count === 0) {
                soundManager.playGo();
                setGoFlash(true);
                setTimeout(() => setGoFlash(false), 800);
            }
        });

        socket.on('matchStart', ({ count, round: r, maxRounds: mr }) => {
            setRankings([]);
            net.reset();
            setMatchData(null);
            setCountdown(count);
            setRound(r);
            if (mr) setMaxRounds(mr);
            setFeed([]);
            setBanner(null);
            setMyElim(null);
            setSpectateId(null);
            // Controls were hidden while out — make sure nothing is stuck "held"
            activeButtons.current.clear();
            joystickInput.current = { forward: 0, steer: 0 };
            resolveInput();
        });

        socket.on('matchEnd', (data) => {
            soundManager.stopEngine();
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
            unsub();
            clearInterval(audioTimer);
            socket.off('airdrop');
            socket.off('rocketFired');
            socket.off('explosion');
            socket.off('collision');
            socket.off('powerupCollected');
            socket.off('playerEliminated');
            socket.off('arenaEvent');
            socket.off('soloOut');
            socket.off('countdown');
            socket.off('matchStart');
            socket.off('matchEnd');
            soundManager.stopEngine();
            soundManager.setBladeWhine(false);
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
        if (activeButtons.current.has('gas')) forward += 1;
        if (activeButtons.current.has('brake')) forward -= 1;   // brakes, then reverses
        if (activeButtons.current.has('left')) steer -= 1;
        if (activeButtons.current.has('right')) steer += 1;

        forward = Math.max(-1, Math.min(1, forward));
        steer = Math.max(-1, Math.min(1, steer));

        if (inputRef.current.forward !== forward || inputRef.current.steer !== steer ||
            inputRef.current.dash !== dash || inputRef.current.shoot !== shoot ||
            inputRef.current.drop !== drop) {
            if (dash && !inputRef.current.dash) soundManager.playDash();
            inputRef.current = { forward, steer, dash, shoot, drop };
            seqRef.current++;
            net.setInput(inputRef.current);         // your car reacts right away (prediction)
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

    // ─── Spectating (multiplayer): watch other players once you're out ───
    const alivePlayers = (snapshot.players || []).filter(p => p.alive && p.id !== socket.id)
        .sort((a, b) => (a.isBot - b.isBot) || a.name.localeCompare(b.name));   // humans first
    const spectating = !!me && !meAlive && !soloOut && !matchData;
    const target = spectating
        ? (alivePlayers.find(p => p.id === spectateId) || alivePlayers[0] || null)
        : null;
    const followId = target ? target.id : socket.id;
    followRef.current = followId;
    const cycleSpectate = (dir) => {
        if (!alivePlayers.length) return;
        const i = Math.max(0, alivePlayers.findIndex(p => p.id === followId));
        setSpectateId(alivePlayers[(i + dir + alivePlayers.length) % alivePlayers.length].id);
        soundManager.playClick();
    };
    useEffect(() => {
        if (!spectating) return;
        const onKey = (e) => {
            if (e.code === 'ArrowLeft' || e.code === 'KeyA') cycleSpectate(-1);
            if (e.code === 'ArrowRight' || e.code === 'KeyD') cycleSpectate(1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

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
            <PhaserGame snapshot={snapshot} localId={socket.id} followId={followId} />

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
                            {e.by ? <><b style={{ color: e.byId === socket.id ? '#4f4' : '#fff' }}>{e.byId === socket.id ? 'You' : e.by}</b>{e.reason === 'wrecked' ? ' wrecked ' : ' knocked out '}</> : ''}
                            <b style={{ color: e.id === socket.id ? '#ff5566' : '#fff' }}>{e.id === socket.id ? 'you' : e.name}</b>
                            {!e.by && (e.reason === 'electric' ? ' got zapped ⚡' : e.reason === 'wrecked' ? ' blew up' : ' crashed out')}
                            {e.reason === 'wrecked' ? ' 💥' : ''}
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
                        {me.blades && <StatusPill label={`⚙ BLADES ${Math.ceil(me.bladeLeft || 0)}s`} color="#ff6a3d" />}
                    </div>
                )}

                {/* Eliminated overlay */}
                {me && !meAlive && rankings.length === 0 && !soloOut && (
                    <div style={{
                        position: 'absolute', top: '24%', left: '50%', transform: 'translate(-50%, -50%)',
                        animation: 'fadeOutLate 4s forwards',
                        color: '#ff3344', fontSize: touchUI ? '2rem' : '2.5rem', fontWeight: 'bold',
                        textShadow: '0 0 30px rgba(255,0,0,0.5)', textAlign: 'center',
                        pointerEvents: 'none'
                    }}>
                        ELIMINATED
                        <div style={{ fontSize: '0.9rem', color: '#ccc', fontWeight: 600, textShadow: '0 2px 4px #000' }}>
                            {outReason(myElim)}

                        </div>
                    </div>
                )}
            </div>

            {/* GO! flash when the lights go out */}
            {goFlash && (
                <div className="full-screen center" style={{ zIndex: 9, pointerEvents: 'none' }}>
                    <div className="gtitle" style={{
                        fontSize: '6rem', color: '#4dff88', animation: 'goPop 0.8s ease-out forwards',
                        textShadow: '0 6px 0 rgba(0,0,0,0.45), 0 0 50px rgba(60,255,120,0.6)',
                    }}>GO!</div>
                </div>
            )}

            {/* ─── Countdown Overlay ────────────────────────────────────── */}
            {countdown > 0 && (
                <div className="full-screen center" style={{ zIndex: 9, pointerEvents: 'none' }}>
                    <div style={{ textAlign: 'center' }}>
                        {/* Start lights: one more lights up each second */}
                        <div className="gpanel" style={{ display: 'inline-flex', gap: 12, padding: '10px 16px', borderRadius: 40, marginBottom: 10 }}>
                            {[0, 1, 2].map(i => {
                                const lit = i < 4 - countdown;
                                return <div key={i} style={{
                                    width: 34, height: 34, borderRadius: '50%',
                                    background: lit ? 'radial-gradient(circle at 40% 35%, #ff8a8a, #e01e2e 60%)' : '#2a1416',
                                    boxShadow: lit ? '0 0 22px #ff2b3d, inset 0 -3px 6px rgba(0,0,0,0.4)' : 'inset 0 2px 6px rgba(0,0,0,0.6)',
                                }} />;
                            })}
                        </div>
                        <div key={countdown} className="gtitle" style={{
                            fontSize: '6.5rem', color: '#fff', lineHeight: 1,
                            textShadow: '0 6px 0 rgba(0,0,0,0.45), 0 0 50px rgba(255,60,60,0.55)',
                            animation: 'countdownNum 1s ease-out'
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
                    <div className="gpanel" style={{
                        padding: touchUI ? '1.1rem 1.2rem' : '2rem 2.5rem',
                        maxWidth: '500px', width: '90vw', maxHeight: '90dvh', overflowY: 'auto', boxSizing: 'border-box',
                    }}>
                        <h1 className="gtitle" style={{
                            textAlign: 'center', fontSize: touchUI ? '1.7rem' : '2.3rem', margin: '0 0 0.5rem 0',
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
                                    <button className="gbtn yellow" onClick={() => { socket.emit('playAgain', { roomId: room?.id }); (onToRoom || onBack)(); }}>
                                        PLAY AGAIN
                                    </button>
                                    <button className="gbtn dark" onClick={() => { socket.emit('leaveRoom', { roomId: room?.id }); onBack(); }}>LOBBY</button>
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

            {/* ─── Solo knock-out: straight back to the lobby ───────────── */}
            {soloOut && (
                <div className="full-screen center" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 11, pointerEvents: 'auto' }}>
                    <div style={{ textAlign: 'center', padding: '0 16px' }}>
                        <div style={{
                            fontSize: touchUI ? '2.2rem' : '3rem', fontWeight: 900, color: '#ff3344', letterSpacing: 2,
                            textShadow: '0 0 30px rgba(255,0,0,0.5)', animation: 'bannerIn 0.4s ease-out',
                        }}>ELIMINATED</div>
                        <div style={{ color: '#fff', fontSize: '1.15rem', fontWeight: 700, marginTop: 6 }}>
                            You finished #{soloOut.rank} of {soloOut.total}
                        </div>
                        <div style={{ color: '#aab', fontSize: '0.85rem', marginTop: 4 }}>
                            {outReason(soloOut)}
                        </div>
                        <div style={{ color: '#e8a030', fontSize: '0.8rem', marginTop: 18, letterSpacing: 1 }}>Returning to lobby…</div>
                    </div>
                </div>
            )}

            {/* ─── Spectator bar (multiplayer, after you're knocked out) ── */}
            {spectating && target && (
                <div style={{
                    position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                    bottom: `calc(${EDGE_BOTTOM} + 6px)`, zIndex: 8, pointerEvents: 'auto',
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,210,122,0.4)',
                    borderRadius: 30, padding: '6px 8px',
                }}>
                    <SpecButton label="◀" onClick={() => cycleSpectate(-1)} />
                    <div style={{ textAlign: 'center', minWidth: 120 }}>
                        <div style={{ fontSize: '0.62rem', color: '#9ab', letterSpacing: 2, fontWeight: 700 }}>SPECTATING</div>
                        <div style={{ color: '#ffd27a', fontWeight: 800, fontSize: '1rem', whiteSpace: 'nowrap' }}>
                            {target.name}{target.isBot ? ' 🤖' : ''}
                        </div>
                    </div>
                    <SpecButton label="▶" onClick={() => cycleSpectate(1)} />
                    <button onClick={() => { socket.emit('leaveRoom', { roomId: room?.id }); onBack(); }} style={{
                        marginLeft: 4, padding: '8px 12px', borderRadius: 20, border: '1px solid rgba(255,68,102,0.6)',
                        background: 'rgba(255,68,102,0.12)', color: '#ff6680', fontWeight: 700, fontSize: '0.72rem',
                        fontFamily: 'inherit', cursor: 'pointer',
                    }}>LEAVE</button>
                </div>
            )}

            {/* ─── Touch Controls (touch devices only, while you're driving) ─ */}
            {touchUI && (!me || meAlive) && !matchData && !soloOut && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none',
                    '--lift': 'clamp(20px, 7vh, 40px)',      /* raised off the bottom edge */
                    '--side': 'clamp(18px, 3.5vw, 40px)',    /* and in from the sides */
                }}>
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
                        /* Steering buttons (left thumb), lifted off the screen edge */
                        <div style={{
                            position: 'absolute', zIndex: 6, pointerEvents: 'auto', display: 'flex',
                            left: `calc(${EDGE_LEFT} + var(--side))`, bottom: `calc(${EDGE_BOTTOM} + var(--lift))`,
                            gap: 'clamp(16px, 5vmin, 26px)',
                        }}>
                            <SteerButton dir={-1} action="left" onAction={handleBtn} />
                            <SteerButton dir={1} action="right" onAction={handleBtn} />
                        </div>
                    )}

                    {/* Right thumb: GAS + BRAKE pedals, NITRO / FIRE / trap above them */}
                    {ctrlMode !== 'joystick' ? (
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none',
                        '--pw': 'clamp(62px, 18vmin, 84px)',
                        '--ph': 'calc(var(--pw) * 1.5)',
                        '--g': 'clamp(14px, 4.5vmin, 24px)',
                        '--R': `calc(${EDGE_RIGHT} + var(--side))`,
                        '--B': `calc(${EDGE_BOTTOM} + var(--lift))`,
                    }}>
                        <PedalButton kind="gas" action="gas" onAction={handleBtn}
                            style={{ right: 'var(--R)', bottom: 'var(--B)', height: 'var(--ph)' }} />
                        <PedalButton kind="brake" action="brake" onAction={handleBtn}
                            style={{ right: 'calc(var(--R) + var(--pw) + var(--g))', bottom: 'var(--B)', height: 'calc(var(--pw) * 1.12)' }} />
                        <PowerButton kind="nitro" action="nitro" onAction={handleBtn} size="calc(var(--pw) * 1.05)"
                            cooldown={net.local ? net.local.dashCooldown : me?.dashCooldown} maxCooldown={NITRO_COOLDOWN}
                            active={net.local ? net.local.nitro > 0 : me?.isDashing}
                            style={{ right: 'calc(var(--R) - var(--pw) * 0.025)', bottom: 'calc(var(--B) + var(--ph) + var(--g))' }} />
                        <PowerButton kind="fire" action="shoot" onAction={handleBtn} size="calc(var(--pw) * 0.95)"
                            cooldown={me?.shootCooldown} maxCooldown={1.1}
                            style={{
                                right: 'calc(var(--R) + var(--pw) + var(--g) + var(--pw) * 0.025)',
                                bottom: 'calc(var(--B) + var(--pw) * 1.12 + var(--g) * 1.3)',
                            }} />
                        {me?.weapon && (
                            <PowerButton kind={me.weapon === 'oil' ? 'oil' : 'flip'} action="drop" onAction={handleBtn} size="calc(var(--pw) * 0.8)"
                                style={{
                                    right: 'calc(var(--R) + var(--pw) * 2 + var(--g) * 2.2)',
                                    bottom: 'calc(var(--B) + var(--pw) * 0.2)',
                                }} />
                        )}
                    </div>
                    ) : (
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none',
                        '--n': 'clamp(70px, 21vmin, 96px)',
                        '--g': 'clamp(16px, 5vmin, 26px)',
                        '--R': `calc(${EDGE_RIGHT} + var(--side))`,
                        '--B': `calc(${EDGE_BOTTOM} + var(--lift))`,
                    }}>
                        <PowerButton kind="nitro" action="nitro" onAction={handleBtn} size="var(--n)"
                            cooldown={net.local ? net.local.dashCooldown : me?.dashCooldown} maxCooldown={NITRO_COOLDOWN}
                            active={net.local ? net.local.nitro > 0 : me?.isDashing}
                            style={{ right: 'var(--R)', bottom: 'var(--B)' }} />
                        <PowerButton kind="fire" action="shoot" onAction={handleBtn} size="calc(var(--n) * 0.82)"
                            cooldown={me?.shootCooldown} maxCooldown={1.1}
                            style={{ right: 'calc(var(--R) + var(--n) + var(--g))', bottom: 'calc(var(--B) + var(--n) * 0.3)' }} />
                        {me?.weapon && (
                            <PowerButton kind={me.weapon === 'oil' ? 'oil' : 'flip'} action="drop" onAction={handleBtn} size="calc(var(--n) * 0.68)"
                                style={{ right: 'calc(var(--R) + var(--n) * 0.16)', bottom: 'calc(var(--B) + var(--n) + var(--g))' }} />
                        )}
                    </div>
                    )}

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
                        {ctrlMode === 'joystick' ? '⇄ Pedals' : '⇄ Joystick'}
                    </button>
                </div>
            )}

            {/* ─── Your health ──────────────────────────────────────────── */}
            {me && meAlive && !matchData && <HealthHud hp={me.hp ?? 100} touchUI={touchUI} />}

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

function outReason(e) {
    if (!e) return 'You left the arena';
    if (e.reason === 'wrecked') return e.by ? `Wrecked by ${e.by} 💥` : 'Your car blew up 💥';
    if (e.by) return `Knocked out by ${e.by}`;
    return e.reason === 'electric' ? 'Zapped by the electric fence' : 'You left the arena';
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

// Press-and-hold control that lights up while held
function useHold(action, onAction) {
    const [down, setDown] = useState(false);
    const set = (v) => (e) => { e.preventDefault(); setDown(v); onAction(action, v); };
    return [down, {
        onPointerDown: set(true), onPointerUp: set(false),
        onPointerLeave: set(false), onPointerCancel: set(false),
    }];
}

function SteerButton({ dir, action, onAction }) {
    const [down, handlers] = useHold(action, onAction);
    return (
        <div {...handlers} style={{
            width: 'clamp(70px, 20vmin, 92px)', height: 'clamp(64px, 18vmin, 84px)', borderRadius: 22,
            background: down
                ? 'linear-gradient(180deg, #ffb84d, #e8860c)'
                : 'linear-gradient(180deg, rgba(58,66,82,0.92), rgba(24,29,39,0.92))',
            border: '2px solid rgba(255,190,90,0.75)',
            boxShadow: down
                ? '0 1px 0 #8a4f00, 0 0 22px rgba(255,170,40,0.6), inset 0 2px 6px rgba(255,255,255,0.35)'
                : '0 6px 0 rgba(0,0,0,0.55), 0 10px 18px rgba(0,0,0,0.35), inset 0 2px 0 rgba(255,255,255,0.12)',
            transform: down ? 'translateY(5px)' : 'none', transition: 'transform 0.05s, background 0.05s',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
        }}>
            <svg width="46%" height="46%" viewBox="0 0 24 24" style={{ transform: dir < 0 ? 'scaleX(-1)' : 'none', pointerEvents: 'none' }}>
                <path d="M7 3 L18 12 L7 21 Z" fill={down ? '#3b2300' : '#ffb84d'} stroke={down ? '#3b2300' : '#ffd99a'} strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
        </div>
    );
}

// Metal pedal with grip ridges (GAS / BRAKE)
function PedalButton({ kind, action, onAction, style }) {
    const [down, handlers] = useHold(action, onAction);
    const color = kind === 'gas' ? '#37d67a' : '#ff4d5e';
    return (
        <div {...handlers} style={{
            position: 'absolute', pointerEvents: 'auto', width: 'var(--pw)', borderRadius: '16px 16px 20px 20px',
            background: `linear-gradient(180deg, #59616e 0%, #3a414c 45%, #262b33 100%)`,
            border: `2px solid ${color}`,
            boxShadow: down
                ? `0 1px 0 rgba(0,0,0,0.6), 0 0 26px ${color}, inset 0 0 18px ${color}66`
                : `0 6px 0 rgba(0,0,0,0.55), 0 0 12px ${color}55, inset 0 2px 0 rgba(255,255,255,0.18)`,
            transform: down ? 'translateY(5px) scale(0.98)' : 'none',
            transformOrigin: '50% 100%', transition: 'transform 0.05s, box-shadow 0.05s',
            overflow: 'hidden', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
            ...style,
        }}>
            {/* rubber grip ridges */}
            <div style={{
                position: 'absolute', left: '14%', right: '14%', top: '12%', bottom: '30%', borderRadius: 8,
                background: `repeating-linear-gradient(180deg, rgba(0,0,0,0.45) 0 5px, rgba(255,255,255,0.10) 5px 7px, rgba(0,0,0,0) 7px 11px)`,
            }} />
            <div className="gtitle" style={{
                position: 'absolute', left: 0, right: 0, bottom: 8, textAlign: 'center',
                fontSize: '0.78rem', color, textShadow: `0 0 8px ${color}aa, 0 2px 0 #000`,
            }}>{kind === 'gas' ? 'GAS' : 'BRAKE'}</div>
        </div>
    );
}

const POWER_LOOK = {
    nitro: { color: '#25c6ff', label: 'NITRO', icon: 'M12 2 C13 7 18 8 17 14 C16.5 18 14 21 12 22 C10 21 7.5 18 7 14 C6.6 10.5 9 9 9.5 6 C11 8 11.5 9.5 11 11 C13 9.5 13 5.5 12 2 Z' },
    fire: { color: '#ff3d5a', label: 'FIRE', icon: 'M20 4 L14 5 L6 13 L5 17 L3 19 L5 21 L7 19 L11 18 L19 10 Z M8.5 15.5 L7 17 M14.5 7 L17 9.5' },
    oil: { color: '#c08a4a', label: 'OIL', icon: 'M12 3 C15 8 18 11 18 15 A6 6 0 0 1 6 15 C6 11 9 8 12 3 Z' },
    flip: { color: '#b24aff', label: 'FLIP', icon: 'M5 12 A7 7 0 0 1 17 7 L17 4 L21 8 L17 12 L17 9 A5 5 0 0 0 7 12 Z M19 12 A7 7 0 0 1 7 17 L7 20 L3 16 L7 12 L7 15 A5 5 0 0 0 17 12 Z' },
};

// Round power button with an icon and a ring that fills up as it recharges
function PowerButton({ kind, action, onAction, cooldown = 0, maxCooldown = 1, active = false, size, style }) {
    const [down, handlers] = useHold(action, onAction);
    const look = POWER_LOOK[kind] || POWER_LOOK.fire;
    const ready = !cooldown || cooldown <= 0;
    const frac = ready ? 1 : Math.max(0, 1 - cooldown / maxCooldown);
    const C = 2 * Math.PI * 45;
    return (
        <div {...handlers} style={{
            position: 'absolute', pointerEvents: 'auto', width: size, height: size, borderRadius: '50%',
            background: `radial-gradient(circle at 50% 30%, ${look.color}55, rgba(14,18,26,0.92) 70%)`,
            boxShadow: ready
                ? `0 6px 0 rgba(0,0,0,0.5), 0 0 ${active ? 30 : 16}px ${look.color}${active ? 'cc' : '66'}`
                : '0 6px 0 rgba(0,0,0,0.5)',
            transform: down ? 'translateY(4px) scale(0.96)' : 'none', transition: 'transform 0.05s',
            animation: active ? 'powerPulse 0.5s ease-in-out infinite alternate' : 'none',
            userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
            ...style,
        }}>
            <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
                <circle cx="50" cy="50" r="45" fill="none" stroke={ready ? look.color : `${look.color}99`} strokeWidth="6"
                    strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 50 50)" />
                <g transform="translate(27 17) scale(1.9)">
                    {kind === 'fire' ? (
                        /* crosshair */
                        <g fill="none" stroke={ready ? look.color : '#59606b'} strokeWidth="2.2" strokeLinecap="round">
                            <circle cx="12" cy="12" r="7" />
                            <path d="M12 1.5 V6 M12 18 V22.5 M1.5 12 H6 M18 12 H22.5" />
                            <circle cx="12" cy="12" r="1.6" fill={ready ? look.color : '#59606b'} stroke="none" />
                        </g>
                    ) : (
                        <path d={look.icon} fill={ready ? look.color : '#59606b'} stroke={ready ? '#ffffff88' : 'none'} strokeWidth="0.8" strokeLinejoin="round" />
                    )}
                </g>
                <text x="50" y="83" textAnchor="middle" fontSize="13" fontFamily="Russo One, Arial Black, sans-serif"
                    fill={ready ? '#fff' : '#8a93a0'}>{look.label}</text>
            </svg>
        </div>
    );
}

// Your health bar (bottom centre, between the thumbs)
function HealthHud({ hp, touchUI }) {
    const v = Math.max(0, Math.min(100, hp));
    const col = v > 60 ? '#3ddc84' : v > 30 ? '#ffc93d' : '#ff4d4d';
    return (
        <div style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)', zIndex: 6, pointerEvents: 'none',
            bottom: `calc(${EDGE_BOTTOM} + ${touchUI ? '6px' : '40px'})`,
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            background: 'rgba(0,0,0,0.55)', borderRadius: 20, border: `1px solid ${col}66`,
            animation: v <= 30 ? 'lowHp 0.6s ease-in-out infinite alternate' : 'none',
        }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 21 C5 15 2 12 2 8 A5 5 0 0 1 12 6 A5 5 0 0 1 22 8 C22 12 19 15 12 21 Z" fill={col} /></svg>
            <div style={{ width: 'clamp(110px, 22vw, 200px)', height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                <div style={{
                    width: `${v}%`, height: '100%', borderRadius: 6, transition: 'width 0.2s, background 0.2s',
                    background: `linear-gradient(180deg, ${col}, ${col}aa)`, boxShadow: `0 0 10px ${col}`,
                }} />
            </div>
            <span className="gtitle" style={{ color: '#fff', fontSize: '0.8rem', minWidth: 28, textAlign: 'right' }}>{Math.ceil(v)}</span>
        </div>
    );
}

function SpecButton({ label, onClick }) {
    return (
        <button onClick={onClick} style={{
            width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(255,210,122,0.6)',
            background: 'rgba(255,210,122,0.12)', color: '#ffd27a', fontSize: '1rem',
            cursor: 'pointer', fontFamily: 'inherit',
        }}>{label}</button>
    );
}

