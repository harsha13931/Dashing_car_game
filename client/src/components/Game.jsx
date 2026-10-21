import React, { useEffect, useState, useRef, Suspense, lazy } from 'react';
import { webglOK } from '../gfx';

// The 3D arena loads on demand (keeps the menus quick to open)
const Arena3D = lazy(() => import('../three/Arena3D'));
import { socket } from '../net/socket';
import { soundManager } from '../utils/SoundManager';
import { net } from '../net/netcode';
import { NITRO_COOLDOWN, CAR_TYPES, ARENAS, GAME_MODES, HILL_TARGET } from '../../../shared/physics.mjs';
import { RoundRewards, Coin } from './Rewards';
import { ChatPanel, VoiceControls } from './Social';
import { onChatMessage } from '../net/chat';
import { completeTutorial, TUTORIAL_REWARD } from '../progress';

export const EMOTES = ['GG', '😂', '😡', '🔥', '👋', '😱'];

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
    const [canDraw3D] = useState(webglOK);
    const [soloOut, setSoloOut] = useState(null);     // solo: you're out → choose spectate or lobby
    const [sawOutCard, setSawOutCard] = useState(false);
    const [modeKey, setModeKey] = useState(() => (early && GAME_MODES[early.mode] ? early.mode : 'ffa'));
    const [arenaInfo, setArenaInfo] = useState(() => (early && ARENAS[early.arena] ? { ...ARENAS[early.arena], key: early.arena } : null));
    const followRef = useRef(null);
    const [emoteOpen, setEmoteOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [teamPts, setTeamPts] = useState({ 1: 0, 2: 0 });
    const lastElim = useRef(null);
    const [emoteFeed, setEmoteFeed] = useState([]);
    const [chatOpen, setChatOpen] = useState(false);
    // Room chat shows up in the same feed as emotes
    useEffect(() => onChatMessage((m) => {
        const key = `c${m.id}`;
        setEmoteFeed(f => [...f.slice(-2), { key, mine: m.from === socket.id, name: m.name, text: m.text, chat: true }]);
        setTimeout(() => setEmoteFeed(f => f.filter(x => x.key !== key)), 6000);
    }), []);
    const [replay, setReplay] = useState(null);       // slow-mo of the round's final knock-out
    const sendEmote = (i) => { socket.emit('emote', { roomId: room?.id, e: i }); setEmoteOpen(false); soundManager.playClick(); };

    const inputRef = useRef({ forward: 0, steer: 0, dash: false, shoot: false });
    const seqRef = useRef(0);
    const activeKeys = useRef(new Set());
    const activeButtons = useRef(new Set());
    const joystickInput = useRef({ dx: 0, dy: 0, mag: 0 });   // stick direction on screen

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
        joystickInput.current = { dx: 0, dy: 0, mag: 0 };
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
        const cleanups = [];
        if (net.snap) setSnapshot(net.snap);

        // Engine + tyre audio follow your own (predicted) car every 50 ms
        const audioTimer = setInterval(() => {
            const me = net.snap?.players?.find(p => p.id === socket.id);
            const local = net.local;
            if (!me || !me.alive || !local) { soundManager.stopEngine(); soundManager.setBladeWhine(false); soundManager.setGunFire(false); return; }
            soundManager.startEngine(me.carType);
            const v = net.localSpeed();
            soundManager.updateEngine(v, inputRef.current.forward, local.nitro > 0 || me.speedMult > 1);
            soundManager.setSkid(local.skid ? Math.min(1, 0.35 + v / 500) : 0);
            soundManager.setBladeWhine(!!me.blades);
            soundManager.setGunFire(!!me.gun);
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
            setSawOutCard(true);
            soundManager.stopEngine();
            soundManager.playLose();
        });

        socket.on('powerupCollected', ({ playerId, type }) => {
            if (playerId === socket.id) soundManager.playPowerup();
        });

        socket.on('playerEliminated', ({ id, name, by, byId, reason }) => {
            lastElim.current = { id, name, by, byId, at: net.serverNow() };
            if (id === socket.id) { soundManager.playElimination(); soundManager.vibrate([80, 60, 160]); }
            else if (byId === socket.id) soundManager.playPowerup();   // your knock-out!
            const key = `${id}-${Date.now()}`;
            setFeed(f => [...f.slice(-3), { key, id, name, by, byId, reason }]);
            setTimeout(() => setFeed(f => f.filter(e => e.key !== key)), 4500);
            if (id === socket.id) {
                setMyElim({ by, reason, byId });
                if (byId) setSpectateId(byId);          // kill-cam: watch whoever got you
            }
        });

        const onGfxLow = () => {
            const b = { title: 'SMOOTH MODE ON', sub: 'Lighter effects so the game runs smoother (change in Settings)', color: '#63e38e' };
            setBanner(b);
            setTimeout(() => setBanner(cur => (cur === b ? null : cur)), 3200);
        };
        window.addEventListener('dash-gfx-low', onGfxLow);
        cleanups.push(() => window.removeEventListener('dash-gfx-low', onGfxLow));

        socket.on('emote', ({ id, e }) => {
            const who = net.snap?.players?.find(p => p.id === id);
            const key = `${id}-${Date.now()}`;
            setEmoteFeed(f => [...f.slice(-2), { key, mine: id === socket.id, name: who ? who.name : '?', text: EMOTES[e] }]);
            setTimeout(() => setEmoteFeed(f => f.filter(x => x.key !== key)), 3500);
        });

        socket.on('bombPass', ({ to, from }) => {
            if (to === socket.id) { soundManager.playArenaWarning(); soundManager.vibrate([60, 40, 60]); }
            else if (from === socket.id) soundManager.playPowerup();
        });

        socket.on('arenaEvent', ({ type }) => {
            const b = type === 'suddenDeath'
                ? { title: 'SUDDEN DEATH', sub: 'The fence is electric — hitting or leaning on it burns your health', color: '#4fd8ff' }
                : { title: 'ARENA SHRINKING', sub: 'Less room to hide — keep your health up', color: '#ffb347' };
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

        socket.on('matchStart', ({ count, round: r, maxRounds: mr, arena, mode }) => {
            if (r <= 1) setTeamPts({ 1: 0, 2: 0 });
            setModeKey(GAME_MODES[mode] ? mode : 'ffa');
            setRankings([]);
            net.reset();
            setMatchData(null);
            setCountdown(count);
            setRound(r);
            if (mr) setMaxRounds(mr);
            setFeed([]);
            setArenaInfo(ARENAS[arena] ? { ...ARENAS[arena], key: arena } : null);
            setReplay(null); lastElim.current = null;
            setSoloOut(null); setSawOutCard(false);
            setBanner(null);
            setMyElim(null);
            setSpectateId(null);
            // Controls were hidden while out — make sure nothing is stuck "held"
            activeButtons.current.clear();
            joystickInput.current = { dx: 0, dy: 0, mag: 0 };
            resolveInput();
        });

        socket.on('matchEnd', (data) => {
            soundManager.stopEngine();
            if (data.mode === 'teams' && data.scores) {
                const pts = { 1: 0, 2: 0 };
                for (const r of data.rankings || []) if (r.team) pts[r.team] += data.scores[r.id] || 0;
                setTeamPts(pts);
            }
            setSoloOut(null);
            // Winning hit: replay the last knock-out in slow motion before the results
            const le = lastElim.current;
            if (le && net.serverNow() - le.at < 1500) {
                const ms = net.startReplay(le.at - 1800, le.at + 400, 0.55);
                if (ms > 0) {
                    setReplay({ victim: le.id, name: le.name, by: le.by, until: Date.now() + ms });
                    setTimeout(() => setReplay(r => (r && Date.now() >= r.until - 50 ? null : r)), ms);
                }
            }
            setRankings(data.rankings || []);
            setMatchData(data);
            setCountdown(0);
            if (data.maxRounds) setMaxRounds(data.maxRounds);
            if (!data.matchOver) setNextIn(8);
            const myRank = (data.rankings || []).findIndex(r => r.id === socket.id);
            if (myRank === 0) soundManager.playWin();
            else soundManager.playLose();
        });

        return () => {
            unsub();
            cleanups.forEach(fn => fn());
            clearInterval(audioTimer);
            socket.off('airdrop');
            socket.off('rocketFired');
            socket.off('explosion');
            socket.off('collision');
            socket.off('powerupCollected');
            socket.off('playerEliminated');
            socket.off('arenaEvent');
            socket.off('bombPass');
            socket.off('emote');
            socket.off('soloOut');
            socket.off('countdown');
            socket.off('matchStart');
            socket.off('matchEnd');
            soundManager.stopEngine();
            soundManager.setBladeWhine(false); soundManager.setGunFire(false);
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
        if (activeKeys.current.has('ArrowDown') || activeKeys.current.has('KeyS')) forward -= 1;
        if (activeKeys.current.has('ArrowLeft') || activeKeys.current.has('KeyA')) steer -= 1;
        if (activeKeys.current.has('ArrowRight') || activeKeys.current.has('KeyD')) steer += 1;
        if (activeKeys.current.has('Space')) dash = true;
        if (activeKeys.current.has('ShiftLeft') || activeKeys.current.has('ShiftRight') || activeKeys.current.has('KeyF')) shoot = true;
        if (activeKeys.current.has('KeyQ') || activeKeys.current.has('KeyE')) drop = true;

        // Joystick = point-to-drive: push the stick where you want to go on screen and
        // the car steers itself there; point behind you at speed and it handbrakes round
        const js = joystickInput.current;
        if (js.mag > 0.18) {
            const carA = net.local ? net.local.angle : (net.snap?.players?.find(p => p.id === socket.id)?.angle || 0);
            // (the 3D camera is tilted, so it converts the stick direction onto the ground)
            const want = window.__dashView && window.__dashView.screenToWorldAngle ? window.__dashView.screenToWorldAngle(js.dx, js.dy) : Math.atan2(js.dy, js.dx);
            let diff = want - carA;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const speed = net.localSpeed();
            const throttle = Math.min(1, (js.mag - 0.18) / 0.55);
            if (Math.abs(diff) > 2.2 && speed > 160) {           // way behind you: handbrake turn
                forward = -1; steer = Math.sign(diff);
            } else {
                steer += Math.max(-1, Math.min(1, diff * 2.4));
                forward += throttle * (Math.abs(diff) > 1.6 ? 0.6 : 1);
            }
            steer = Math.round(steer * 10) / 10;                    // fewer tiny updates over the network
        }

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
        const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
        const onDown = e => { if (!e.repeat && !typing(e)) { activeKeys.current.add(e.code); resolveInput(); } };
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

        // While the stick is held the car keeps turning, so re-aim it ~25×/s
        let aimTimer = null;
        const onDown = (e) => {
            e.preventDefault();
            try { zone.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            clearInterval(aimTimer);
            aimTimer = setInterval(resolveInput, 40);
            const maxR = computeMaxR();
            joyRef.current = { active: true, bx: e.clientX, by: e.clientY, maxR };
            setJoyView({ active: true, bx: e.clientX, by: e.clientY, kx: e.clientX, ky: e.clientY });
            joystickInput.current = { dx: 0, dy: 0, mag: 0 };
            resolveInput();
        };
        const onMove = (e) => {
            const j = joyRef.current;
            if (!j.active) return;
            e.preventDefault();
            let dx = e.clientX - j.bx, dy = e.clientY - j.by;
            const mag = Math.hypot(dx, dy);
            if (mag > j.maxR) { dx = (dx / mag) * j.maxR; dy = (dy / mag) * j.maxR; }
            joystickInput.current = { dx, dy, mag: Math.hypot(dx, dy) / j.maxR };
            setJoyView({ active: true, bx: j.bx, by: j.by, kx: j.bx + dx, ky: j.by + dy });
            resolveInput();
        };
        const onUp = (e) => {
            if (!joyRef.current.active) return;
            e.preventDefault();
            clearInterval(aimTimer);
            joyRef.current = { active: false, bx: 0, by: 0, maxR: computeMaxR() };
            setJoyView({ active: false, bx: 0, by: 0, kx: 0, ky: 0 });
            joystickInput.current = { dx: 0, dy: 0, mag: 0 };
            resolveInput();
        };
        zone.addEventListener('pointerdown', onDown);
        zone.addEventListener('pointermove', onMove);
        zone.addEventListener('pointerup', onUp);
        zone.addEventListener('pointercancel', onUp);
        return () => {
            clearInterval(aimTimer);
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
    const watching = !!me && !meAlive && !matchData;        // (solo: the camera still shows who got you)
    const target = watching
        ? (alivePlayers.find(p => p.id === spectateId) || (soloOut ? null : alivePlayers[0]) || null)
        : null;
    const followId = replay ? replay.victim : target ? target.id : socket.id;
    followRef.current = followId;
    const cycleSpectate = (dir) => {
        if (!alivePlayers.length) return;
        const i = Math.max(0, alivePlayers.findIndex(p => p.id === followId));
        setSpectateId(alivePlayers[(i + dir + alivePlayers.length) % alivePlayers.length].id);
        soundManager.playClick();
    };
    useEffect(() => {
        const onKey = (e) => {
            if (e.target && e.target.tagName === 'INPUT') return;      // typing in chat
            const n = parseInt(e.key);
            if (n >= 1 && n <= EMOTES.length && !e.repeat) sendEmote(n - 1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [room?.id]);
    useEffect(() => {
        if (!spectating) return;
        const onKey = (e) => {
            if (e.target && e.target.tagName === 'INPUT') return;
            if (e.code === 'ArrowLeft' || e.code === 'KeyA') cycleSpectate(-1);
            if (e.code === 'ArrowRight' || e.code === 'KeyD') cycleSpectate(1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    // Hot Bomb: beep the last seconds while you're holding it
    const bombBeep = useRef(null);
    useEffect(() => {
        const b = snapshot.bomb;
        const holder = b && snapshot.players?.find(p => p.num === b.holder);
        if (!holder || holder.id !== socket.id) { bombBeep.current = null; return; }
        const sec = Math.ceil(b.fuse);
        if (sec <= 4 && sec !== bombBeep.current) { bombBeep.current = sec; soundManager.playCountdown(); }
    }, [snapshot]);

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
            {canDraw3D ? (
                <Suspense fallback={<div className="full-screen center" style={{ color: '#9ab', fontSize: '0.9rem' }}>Loading 3D arena…</div>}>
                    <Arena3D snapshot={snapshot} localId={socket.id} followId={followId} />
                </Suspense>
            ) : (
                <div className="full-screen center" style={{ color: '#cfd8e3', fontSize: '0.95rem', textAlign: 'center', padding: 24 }}>
                    This browser can't show 3D graphics.<br />Turn on hardware acceleration or update your browser, then reload.
                </div>
            )}

            {/* ─── HUD Overlay ──────────────────────────────────────────── */}
            <div className="full-screen" style={{ pointerEvents: 'none', zIndex: 4 }}>

                <Minimap snapshot={snapshot} localId={socket.id} size={touchUI ? 84 : 116} />

                {/* Top centre: arcade score bar (teams / round, timer, cars left) */}
                <ScoreBar snapshot={snapshot} round={round} maxRounds={maxRounds} teamPts={teamPts} touchUI={touchUI} time={formatTime(snapshot.elapsed || 0)} />

                {/* Game-mode status (teams count / hill progress / who has the bomb) */}
                {countdown <= 0 && !matchData && snapshot.mode !== 'teams' && <ModeStatus snapshot={snapshot} touchUI={touchUI} />}

                {/* Arena phase: shrink warning / sudden death */}
                {countdown <= 0 && !matchData && snapshot.fenceLock > 0 && (
                    <div style={{
                        position: 'absolute', top: `calc(${EDGE_TOP} + ${touchUI ? 70 : 88}px)`,
                        left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap',
                        padding: '4px 12px', borderRadius: 14, fontWeight: 800, letterSpacing: 1,
                        fontSize: touchUI ? '0.7rem' : '0.8rem', color: '#7dffb0',
                        background: 'rgba(0,0,0,0.6)', border: '1px solid #3ddc8488',
                    }}>🔒 SAFE START {Math.ceil(snapshot.fenceLock)}s — nobody can be wrecked yet</div>
                )}
                {countdown <= 0 && !matchData && !(snapshot.fenceLock > 0) && (snapshot.suddenDeath || (snapshot.shrinkIn > 0 && snapshot.shrinkIn <= 10)) && (
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
                    position: 'absolute', left: EDGE_LEFT, top: `calc(${EDGE_TOP} + ${emoteOpen ? 104 : 56}px)`,
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
                            {!e.by && (e.reason === 'electric' ? ' got zapped ⚡' : e.reason === 'wrecked' ? ' blew up' : e.reason === 'pit' ? ' fell in the sinkhole 🕳️' : e.reason === 'bomb' ? ' was holding the bomb 💣' : ' crashed out')}
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

                {/* Status pills (active effects) — under the timer, away from thumbs */}
                {me && meAlive && (
                    <div style={{
                        position: 'absolute', top: `calc(${EDGE_TOP} + ${snapshot.mode && snapshot.mode !== 'ffa' ? (touchUI ? 98 : 118) : (touchUI ? 40 : 52)}px)`,
                        left: '50%', transform: 'translateX(-50%)',
                        display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '60vw',
                    }}>
                        {me.shield && <StatusPill label="SHIELD" color="#00ddff" />}
                        {me.speedMult > 1 && !(snapshot.bomb && snapshot.bomb.holder === me.num) && <StatusPill label="SPEED" color="#00ff88" />}
                        {me.scale > 1.1 && <StatusPill label="MEGA" color="#ff3366" />}
                        {me.slip > 0 && <StatusPill label="OIL!" color="#ff8800" />}
                        {me.magnetTimer > 0 && <StatusPill label="MAGNET" color="#ffaa00" />}
                        {me.bumper && <StatusPill label={`🎈 BALLOONS ${Math.ceil(me.bumperLeft || 0)}s`} color="#ff5fa2" />}
                        {me.blades && <StatusPill label={`⚙ BLADES ${Math.ceil(me.bladeLeft || 0)}s`} color="#ff6a3d" />}
                        {me.gun && <StatusPill label={`🔫 GATLING ${Math.ceil(me.gunLeft || 0)}s`} color="#ff7a1a" />}
                    </div>
                )}

                {/* Eliminated overlay */}
                {me && !meAlive && rankings.length === 0 && !soloOut && !sawOutCard && (
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
                            {myElim?.byId && <div style={{ fontSize: '0.7rem', color: '#ffd27a', letterSpacing: 2, marginTop: 4 }}>🎥 KILL CAM</div>}

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
                        {modeKey !== 'ffa' && (
                            <div className="gtitle" style={{ fontSize: '1.15rem', color: '#ff7ab6', marginTop: 6, letterSpacing: 2, textShadow: '0 2px 6px #000' }}>
                                {GAME_MODES[modeKey].icon} {GAME_MODES[modeKey].name.toUpperCase()}
                                <div style={{ fontSize: '0.75rem', color: '#ffd6ea', letterSpacing: 0, fontFamily: 'inherit' }}>{GAME_MODES[modeKey].tip}</div>
                            </div>
                        )}
                        {arenaInfo && (
                            <div className="gtitle" style={{ fontSize: '1.05rem', color: arenaInfo.ice ? '#9fe0ff' : '#ffc53d', marginTop: 6, letterSpacing: 2, textShadow: '0 2px 6px #000' }}>
                                {{ classic: '🏟️', ice: '❄️', box: '⬛', sinkhole: '🕳️', windmill: '🌀' }[arenaInfo.key] || ''} {arenaInfo.name.toUpperCase()}
                            </div>
                        )}
                        <div style={{ fontSize: '0.85rem', color: '#9ab', marginTop: 4, textShadow: '0 2px 4px #000' }}>
                            {arenaInfo ? arenaInfo.tip : 'Wreck rivals by draining their health'} · last car standing wins
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Round End / Match End Screen ─────────────────────────── */}
            {replay && (
                <div className="full-screen" style={{ zIndex: 10, pointerEvents: 'auto' }} onClick={() => { net.stopReplay(); setReplay(null); }}>
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '9%', background: '#000' }} />
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '9%', background: '#000' }} />
                    <div className="gtitle" style={{ position: 'absolute', top: '11%', left: EDGE_LEFT, color: '#ff4d5e', fontSize: '1.1rem', letterSpacing: 3, animation: 'tapPulse 1s ease-in-out infinite' }}>
                        ● REPLAY
                    </div>
                    <div className="gtitle" style={{ position: 'absolute', bottom: '12%', left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: '1.05rem', textShadow: '0 2px 6px #000' }}>
                        WINNING HIT{replay.by ? ` · ${replay.by} knocks out ${replay.name}` : ` · ${replay.name} is out`}
                    </div>
                    <div style={{ position: 'absolute', top: '11%', right: EDGE_RIGHT, color: '#9ab', fontSize: '0.75rem', fontWeight: 700 }}>TAP TO SKIP ▸</div>
                </div>
            )}

            {rankings.length > 0 && matchData && !replay && (
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
                            <p style={{ textAlign: 'center', color: matchData.winTeam ? (matchData.winTeam === 1 ? '#ff6b5e' : '#5ea2ff') : 'gold', fontSize: '1.1rem', margin: '0 0 1rem 0' }}>
                                {matchData.winTeam ? `${matchData.winTeam === 1 ? '🔴' : '🔵'} ${matchData.winnerName} WINS` : `Winner: ${matchData.winnerName}`}
                                {matchData.winTeam ? (rankings.find(r => r.id === socket.id)?.team === matchData.winTeam ? ' (your team!)' : '') : (matchData.winnerId === socket.id ? ' (You!)' : '')}
                            </p>
                        )}

                        <RoundRewards compact={touchUI} />

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
                                        {' '}{r.team ? (r.team === 1 ? '🔴 ' : '🔵 ') : ''}{r.name} {r.id === socket.id ? '(You)' : ''}
                                        {r.hill !== undefined && <span style={{ color: '#ffc53d', fontSize: '0.75rem' }}> 👑 {r.hill}s</span>}
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
                        <div style={{ maxWidth: 380, margin: '14px auto 0' }}><RoundRewards /></div>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 10 }}>
                            <button className="gbtn blue" onClick={() => { soundManager.playClick(); setSoloOut(null); }}
                                style={{ fontSize: '1rem', padding: '10px 20px' }}>👁 SPECTATE</button>
                            <button className="gbtn dark" onClick={() => { soundManager.playClick(); socket.emit('leaveRoom', { roomId: room?.id }); onBack(); }}
                                style={{ fontSize: '1rem', padding: '10px 20px' }}>🏠 LOBBY</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Spectator bar (multiplayer, after you're knocked out) ── */}
            {spectating && target && (
                <div style={{
                    position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                    bottom: `calc(${EDGE_BOTTOM} + 14px)`, zIndex: 8, pointerEvents: 'auto',
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

            {room?.settings?.training && <TrainingCoach me={me} touchUI={touchUI} live={countdown <= 0} over={!!matchData || !!soloOut} />}

            {/* Emote feed: who said what (works while you're spectating too) */}
            {emoteFeed.length > 0 && (
                <div style={{ position: 'absolute', top: `calc(${EDGE_TOP} + ${touchUI ? 100 : 134}px)`, right: EDGE_RIGHT, zIndex: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, pointerEvents: 'none' }}>
                    {emoteFeed.map(m => (
                        <div key={m.key} style={{
                            background: 'rgba(0,0,0,0.7)', borderRadius: 14, padding: '3px 10px', color: '#fff', fontSize: '0.8rem', fontWeight: 700, maxWidth: '40vw',
                            border: `1px solid ${m.mine ? 'rgba(79,216,255,0.6)' : 'rgba(255,255,255,0.15)'}`, animation: 'popIn 0.2s ease-out',
                        }}>
                            <span style={{ color: m.mine ? '#8fe3ff' : '#ffd27a' }}>{m.mine ? 'You' : m.name}</span>{' '}
                            <span style={{ fontSize: m.chat || m.text.length > 2 ? '0.85rem' : '1.1rem', fontWeight: m.chat ? 600 : 700 }}>{m.text}</span>
                        </div>
                    ))}
                </div>
            )}

            {chatOpen && <ChatPanel roomId={room?.id} onClose={() => setChatOpen(false)} />}

            {/* ─── Top-left: chat & emotes, menu, mic ───────────────────── */}
            {!matchData && (
                <div style={{ position: 'absolute', top: EDGE_TOP, left: EDGE_LEFT, zIndex: 8, pointerEvents: 'auto' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <HudButton onClick={() => { setEmoteOpen(o => !o); setMenuOpen(false); }} active={emoteOpen} label="Chat and emotes">
                            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fff" /><circle cx="8" cy="10.5" r="1.4" fill="#1f6fe0" /><circle cx="12" cy="10.5" r="1.4" fill="#1f6fe0" /><circle cx="16" cy="10.5" r="1.4" fill="#1f6fe0" /></svg>
                        </HudButton>
                        <HudButton onClick={() => { setMenuOpen(o => !o); setEmoteOpen(false); }} active={menuOpen} label="Menu">
                            <svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" /></svg>
                        </HudButton>
                        <VoiceControls roomId={room?.id} round />
                    </div>
                    {emoteOpen && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', maxWidth: '60vw' }}>
                            <button onClick={() => { setEmoteOpen(false); setChatOpen(true); }} aria-label="Type a message" style={emoteChip}>⌨️</button>
                            {EMOTES.map((em, i) => (
                                <button key={em} onClick={() => sendEmote(i)} style={{ ...emoteChip, fontSize: em.length > 2 ? '0.85rem' : '1.15rem' }}>{em}</button>
                            ))}
                        </div>
                    )}
                    {menuOpen && (
                        <div className="gpanel" style={{ marginTop: 6, padding: '10px 12px', width: 220, maxHeight: '62vh', overflowY: 'auto', animation: 'popIn 0.2s ease-out' }}>
                            {touchUI && (
                                <button onClick={() => { switchCtrl(); }} className="gbtn dark" style={{ width: '100%', marginBottom: 6, fontSize: '0.75rem', padding: '7px' }}>
                                    ⇄ {ctrlMode === 'joystick' ? 'Switch to pedals' : 'Switch to joystick'}
                                </button>
                            )}
                            <button onClick={() => { socket.emit('leaveRoom', { roomId: room?.id }); onBack(); }} className="gbtn dark"
                                style={{ width: '100%', marginBottom: 8, fontSize: '0.75rem', padding: '7px', color: '#ff8899' }}>🚪 Leave match</button>
                            <div className="gtitle" style={{ fontSize: '0.7rem', color: '#8fb8ff', marginBottom: 6 }}>PLAYERS · {snapshot.players?.filter(p => p.alive).length || 0} LEFT</div>
                            {(snapshot.players || []).slice().sort((a, b) => (b.alive - a.alive) || ((a.team || 0) - (b.team || 0))).map(p => (
                                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', opacity: p.alive ? 1 : 0.4, fontSize: '0.8rem', color: p.id === socket.id ? '#8fe3ff' : '#dfe6ee' }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                                        {p.team ? (p.team === 1 ? '🔴 ' : '🔵 ') : ''}{p.id === socket.id ? '★ ' : ''}{p.name}{p.isBot ? ' 🤖' : ''}
                                    </span>
                                    <span style={{ fontSize: '0.7rem', color: p.alive ? '#4ade80' : '#f87171' }}>{p.alive ? '●' : '✕'}</span>
                                </div>
                            ))}
                        </div>
                    )}
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
                                    color: 'rgba(232,160,48,0.55)', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '1px', textAlign: 'center', lineHeight: 1.3,
                                }}>POINT<br />TO DRIVE</div>
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
                            cooldown={me?.shootCooldown} maxCooldown={1.4}
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
                            cooldown={me?.shootCooldown} maxCooldown={1.4}
                            style={{ right: 'calc(var(--R) + var(--n) + var(--g))', bottom: 'calc(var(--B) + var(--n) * 0.3)' }} />
                        {me?.weapon && (
                            <PowerButton kind={me.weapon === 'oil' ? 'oil' : 'flip'} action="drop" onAction={handleBtn} size="calc(var(--n) * 0.68)"
                                style={{ right: 'calc(var(--R) + var(--n) * 0.16)', bottom: 'calc(var(--B) + var(--n) + var(--g))' }} />
                        )}
                    </div>
                    )}

                </div>
            )}

            {/* ─── Your health ──────────────────────────────────────────── */}
            {me && meAlive && !matchData && <HealthHud hp={me.hp ?? 100} max={(CAR_TYPES[me.carType] || {}).hp || 100} touchUI={touchUI} />}

            {/* Desktop: action buttons with their keys */}
            {!touchUI && me && meAlive && !matchData && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none' }}>
                    <PowerButton kind="fire" action="shoot" onAction={handleBtn} size="76px" keyHint="F"
                        cooldown={me?.shootCooldown} maxCooldown={1.4} style={{ right: 128, bottom: 26 }} />
                    <PowerButton kind="nitro" action="nitro" onAction={handleBtn} size="92px" keyHint="SPACE"
                        cooldown={net.local ? net.local.dashCooldown : me?.dashCooldown} maxCooldown={NITRO_COOLDOWN}
                        active={net.local ? net.local.nitro > 0 : me?.isDashing} style={{ right: 24, bottom: 22 }} />
                    {me?.weapon && <PowerButton kind={me.weapon === 'oil' ? 'oil' : 'flip'} action="drop" onAction={handleBtn} size="62px" keyHint="Q" style={{ right: 222, bottom: 30 }} />}
                </div>
            )}

            {/* Desktop keyboard hint */}
            {!touchUI && !spectating && (
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

// ─── Game-mode status line under the timer ────────────────────────────────
function ModeStatus({ snapshot, touchUI }) {
    const mode = snapshot.mode;
    if (!mode || mode === 'ffa') return null;
    const players = snapshot.players || [];
    const me = players.find(p => p.id === socket.id);
    const box = (children, color = '#fff', border = 'rgba(255,255,255,0.2)', extra = {}) => (
        <div style={{
            position: 'absolute', top: `calc(${EDGE_TOP} + ${touchUI ? 38 : 48}px)`, left: '50%', transform: 'translateX(-50%)',
            whiteSpace: 'nowrap', padding: '3px 12px', borderRadius: 14, fontWeight: 800, fontSize: touchUI ? '0.74rem' : '0.85rem',
            color, background: 'rgba(0,0,0,0.65)', border: `1px solid ${border}`, ...extra,
        }}>{children}</div>
    );
    if (mode === 'teams') {
        const n = (t) => players.filter(p => p.alive && p.team === t).length;
        return box(<>
            <span style={{ color: '#ff6b5e' }}>🔴 {n(1)}</span>
            <span style={{ color: '#aaa', margin: '0 8px' }}>vs</span>
            <span style={{ color: '#5ea2ff' }}>🔵 {n(2)}</span>
            {me && me.team ? <span style={{ color: '#aaa', marginLeft: 10, fontWeight: 600 }}>you're {me.team === 1 ? 'RED' : 'BLUE'}</span> : null}
        </>);
    }
    if (mode === 'koth') {
        const leader = players.reduce((b, p) => ((p.hill || 0) > (b ? b.hill || 0 : -1) ? p : b), null);
        const mine = me ? me.hill || 0 : 0;
        const holder = snapshot.hill && players.find(p => p.num === snapshot.hill.holder);
        return box(<>
            👑 You {Math.floor(mine)}/{HILL_TARGET}s
            {leader && leader.id !== socket.id && leader.hill > 0 && <span style={{ color: '#ffc53d' }}> · {leader.name} {Math.floor(leader.hill)}s</span>}
            <span style={{ color: snapshot.hill?.contested ? '#ff6b5e' : holder ? '#7dffb0' : '#888', marginLeft: 8 }}>
                {snapshot.hill?.contested ? 'CONTESTED' : holder ? (holder.id === socket.id ? 'HOLDING!' : `${holder.name} holds it`) : 'zone free'}
            </span>
        </>, '#fff', 'rgba(255,197,61,0.5)');
    }
    if (mode === 'bomb') {
        const b = snapshot.bomb;
        if (!b) return box('💣 Bomb incoming…', '#ffb3b3', 'rgba(255,80,80,0.4)');
        const holder = players.find(p => p.num === b.holder);
        const mine = holder && holder.id === socket.id;
        if (mine) {
            return box(<>💣 YOU HAVE THE BOMB — {b.fuse.toFixed(0)}s! Bump someone!</>, '#fff', '#ff3b3b',
                { background: 'rgba(200,20,20,0.85)', fontSize: touchUI ? '0.9rem' : '1rem', animation: 'tapPulse 0.6s ease-in-out infinite' });
        }
        return box(<>💣 {holder ? holder.name : '?'} has the bomb · {b.fuse.toFixed(0)}s</>, '#ffb3b3', 'rgba(255,80,80,0.4)');
    }
    return null;
}

// ─── Training: step-by-step tips that tick off as you do them ─────────────
function TrainingCoach({ me, touchUI, live, over }) {
    const [step, setStep] = useState(0);
    const [reward, setReward] = useState(null);
    const dist = useRef({ d: 0, x: null, y: null });
    useEffect(() => {
        const onFire = ({ id }) => { if (id === socket.id) setStep(s => (s === 2 ? 3 : s)); };
        socket.on('rocketFired', onFire);
        return () => socket.off('rocketFired', onFire);
    }, []);
    useEffect(() => {
        if (!me || !live) return;
        const d = dist.current;
        if (d.x !== null) d.d += Math.hypot(me.x - d.x, me.y - d.y);
        d.x = me.x; d.y = me.y;
        if (step === 0 && d.d > 900) setStep(1);
        if (step === 1 && me.isDashing) setStep(2);
    });
    useEffect(() => {
        if (over && reward === null) setReward(completeTutorial());
    }, [over]);

    const steps = [
        { title: 'DRIVE', text: touchUI ? 'Put your thumb on the left side and point where you want to go' : 'Drive with the arrow keys (or WASD)' },
        { title: 'NITRO', text: touchUI ? 'Tap NITRO for a big speed boost' : 'Press SPACE for a nitro boost' },
        { title: 'FIRE', text: touchUI ? 'Tap FIRE to launch twin rockets at the bot' : 'Press F (or Shift) to fire rockets' },
        { title: 'WRECK IT', text: 'Ram the Practice Bot and hit it with rockets until its health runs out!' },
    ];
    if (over) {
        return (
            <div className="gpanel" style={{ position: 'absolute', top: '12%', left: '50%', transform: 'translateX(-50%)', zIndex: 12, padding: '10px 18px', textAlign: 'center', pointerEvents: 'none' }}>
                <div className="gtitle" style={{ color: '#63e38e', fontSize: '1.1rem' }}>🎓 TRAINING COMPLETE!</div>
                {reward > 0 && <div className="gtitle" style={{ color: '#ffd84d', marginTop: 4 }}>+{TUTORIAL_REWARD} <Coin size={15} /> bonus</div>}
            </div>
        );
    }
    if (!live) return null;
    const cur = steps[Math.min(step, steps.length - 1)];
    return (
        <div className="gpanel" style={{
            position: 'absolute', top: `calc(${EDGE_TOP} + 50px)`, left: '50%', transform: 'translateX(-50%)', zIndex: 7,
            padding: '8px 16px', textAlign: 'center', pointerEvents: 'none', maxWidth: '62vw', animation: 'popInX 0.3s ease-out',
        }} key={step}>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 4 }}>
                {steps.map((s, i) => (
                    <span key={s.title} style={{ width: 8, height: 8, borderRadius: 4, background: i < step ? '#63e38e' : i === step ? '#ffd84d' : 'rgba(255,255,255,0.2)' }} />
                ))}
            </div>
            <div className="gtitle" style={{ color: '#ffd84d', fontSize: '0.95rem' }}>🎓 {cur.title}</div>
            <div style={{ color: '#fff', fontSize: '0.82rem', marginTop: 2 }}>{cur.text}</div>
        </div>
    );
}

function outReason(e) {
    if (!e) return 'You left the arena';
    if (e.reason === 'wrecked') return e.by ? `Wrecked by ${e.by} 💥` : 'Your car blew up 💥';
    if (e.reason === 'bomb') return 'The bomb went off while you had it 💣';
    if (e.reason === 'pit') return e.by ? `${e.by} shoved you into the sinkhole 🕳️` : 'You fell into the sinkhole 🕳️';
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
        const spec = ARENAS[snapshot.arena] || ARENAS.classic;
        const shape = (r) => {
            ctx.beginPath();
            if (spec.shape === 'square') { const h = r * 0.89; ctx.rect(cx - h, cy - h, h * 2, h * 2); }
            else ctx.arc(cx, cy, r, 0, Math.PI * 2);
        };
        ctx.fillStyle = 'rgba(255,255,255,0.03)'; shape(rad); ctx.fill();
        ctx.fillStyle = spec.ice ? 'rgba(170,220,255,0.18)' : 'rgba(255,255,255,0.06)'; shape(rad * cur); ctx.fill();
        ctx.strokeStyle = snapshot.suddenDeath ? 'rgba(79,216,255,0.9)' : 'rgba(232,160,48,0.6)'; ctx.lineWidth = 1.5;
        shape(rad * cur); ctx.stroke();
        if (spec.pit) {
            ctx.fillStyle = '#000'; ctx.strokeStyle = '#ffc21a'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(cx, cy, rad * cur * spec.pit, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        if (spec.bar) {
            const a = snapshot.barAngle || 0, l = rad * cur * spec.bar.len;
            ctx.strokeStyle = '#c9ced6'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * l, cy - Math.sin(a) * l); ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); ctx.stroke();
        }

        for (const pu of (snapshot.powerups || [])) {
            ctx.fillStyle = '#ffd84d';
            ctx.fillRect(cx + (pu.x / R) * rad - 1.8, cy + (pu.y / R) * rad - 1.8, 3.6, 3.6);
        }
        const meTeam = (snapshot.players || []).find(p => p.id === localId)?.team || 0;
        for (const p of (snapshot.players || [])) {
            if (!p.alive) continue;
            const px = cx + (p.x / R) * rad;
            const py = cy + (p.y / R) * rad;
            const me = p.id === localId;
            ctx.fillStyle = me ? '#4dff88' : p.team ? (p.team === meTeam ? '#5ea2ff' : '#ff4d5e') : '#ff4d5e';
            ctx.beginPath(); ctx.arc(px, py, me ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
            if (me) {
                ctx.strokeStyle = '#8fe3ff'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.stroke();
            }
        }
    }, [snapshot, localId, size]);

    return (
        <div style={{
            position: 'absolute', top: EDGE_TOP, right: EDGE_RIGHT, width: size, height: size,
            borderRadius: '50%', overflow: 'hidden',
            background: 'radial-gradient(circle, rgba(20,32,56,0.78), rgba(8,12,22,0.85))', border: '3px solid #3d8bff',
            boxShadow: '0 0 0 2px rgba(255,255,255,0.75), 0 4px 10px rgba(0,0,0,0.4)',
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
function PowerButton({ kind, action, onAction, cooldown = 0, maxCooldown = 1, active = false, size, style, keyHint }) {
    const [down, handlers] = useHold(action, onAction);
    const look = POWER_LOOK[kind] || POWER_LOOK.fire;
    const ready = !cooldown || cooldown <= 0;
    const frac = ready ? 1 : Math.max(0, 1 - cooldown / maxCooldown);
    const C = 2 * Math.PI * 44;
    return (
        <div {...handlers} style={{
            position: 'absolute', pointerEvents: 'auto', width: size, height: size, borderRadius: '50%',
            background: ready
                ? 'radial-gradient(circle at 50% 26%, #7cc8ff 0%, #2f86f0 45%, #1550b8 100%)'
                : 'radial-gradient(circle at 50% 26%, #5d6b80 0%, #2c3646 60%, #1b222d 100%)',
            border: `3px solid ${ready ? '#ffffff' : 'rgba(255,255,255,0.35)'}`,
            boxShadow: `0 5px 0 ${ready ? '#0b2f6e' : '#11161d'}, 0 0 ${active ? 28 : 10}px ${active ? look.color : 'rgba(0,0,0,0.35)'}`,
            transform: down ? 'translateY(4px) scale(0.95)' : 'none', transition: 'transform 0.05s',
            animation: active ? 'powerPulse 0.5s ease-in-out infinite alternate' : 'none',
            userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none', boxSizing: 'border-box',
            ...style,
        }}>
            <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {!ready && (
                    /* recharge: the button fills back up clockwise */
                    <circle cx="50" cy="50" r="22" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="44"
                        strokeDasharray={`${2 * Math.PI * 22 * (1 - frac)} ${2 * Math.PI * 22}`} transform="rotate(-90 50 50) scale(-1 1) translate(-100 0)" />
                )}
                <circle cx="50" cy="50" r="44" fill="none" stroke={ready ? '#bfe8ff' : '#8fb8ff'} strokeWidth="4"
                    strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 50 50)" opacity={ready ? 0.9 : 1} />
                <g transform="translate(27 15) scale(1.9)">
                    {kind === 'fire' ? (
                        <g fill="none" stroke={ready ? '#fff' : '#9aa6b5'} strokeWidth="2.4" strokeLinecap="round">
                            <circle cx="12" cy="12" r="7" />
                            <path d="M12 1.5 V6 M12 18 V22.5 M1.5 12 H6 M18 12 H22.5" />
                            <circle cx="12" cy="12" r="1.8" fill={ready ? '#ff4d5e' : '#9aa6b5'} stroke="none" />
                        </g>
                    ) : (
                        <path d={look.icon} fill={ready ? look.color : '#9aa6b5'} stroke="#fff" strokeWidth={ready ? 1.1 : 0} strokeLinejoin="round" />
                    )}
                </g>
                <text x="50" y="82" textAnchor="middle" fontSize="12.5" fontFamily="Russo One, Arial Black, sans-serif"
                    fill="#fff" stroke="#0b2f6e" strokeWidth="0.8" paintOrder="stroke">{look.label}</text>
            </svg>
            {keyHint && (
                <div className="gtitle" style={{
                    position: 'absolute', left: '50%', top: -12, transform: 'translateX(-50%)', padding: '1px 7px', borderRadius: 6,
                    background: '#1f6fe0', border: '2px solid #fff', color: '#fff', fontSize: '0.6rem', whiteSpace: 'nowrap', pointerEvents: 'none',
                }}>{keyHint}</div>
            )}
        </div>
    );
}

// Square blue arcade button for the top-left corner
function HudButton({ children, onClick, active, label }) {
    return (
        <button onClick={() => { soundManager.playClick(); onClick(); }} aria-label={label} style={{
            width: 42, height: 38, borderRadius: 10, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: active ? 'linear-gradient(180deg,#7cc8ff,#2f86f0)' : 'linear-gradient(180deg,#3d9bff,#1f62d6)',
            border: '2px solid #ffffff', boxShadow: '0 3px 0 #0b2f6e',
        }}>{children}</button>
    );
}
const emoteChip = {
    minWidth: 38, height: 36, borderRadius: 10, border: '2px solid rgba(255,255,255,0.85)', padding: '0 8px',
    background: 'linear-gradient(180deg,#2d3a52,#1a2232)', color: '#fff', fontSize: '1.05rem', fontWeight: 800,
    fontFamily: 'inherit', cursor: 'pointer', animation: 'popIn 0.2s ease-out',
};

// ─── Top-centre arcade score bar ──────────────────────────────────────────
function ScoreBar({ snapshot, round, maxRounds, teamPts, touchUI, time }) {
    const players = snapshot.players || [];
    const teams = snapshot.mode === 'teams';
    const Diamond = ({ col, on }) => (
        <span style={{
            width: touchUI ? 8 : 10, height: touchUI ? 8 : 10, transform: 'rotate(45deg)', display: 'inline-block', margin: '0 2.5px',
            background: on ? col : 'transparent', border: `1.5px solid ${col}`, opacity: on ? 1 : 0.4,
            boxShadow: on ? `0 0 6px ${col}` : 'none', flexShrink: 0,
        }} />
    );
    const side = (children, align) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: align, gap: 6, minWidth: touchUI ? 'min(120px, 14vw)' : 170 }}>{children}</div>
    );
    const num = (v, col) => <span className="gtitle" style={{ color: col, fontSize: touchUI ? '0.95rem' : '1.1rem', textShadow: '0 2px 0 rgba(0,0,0,0.5)' }}>{v}</span>;
    let left, right;
    if (teams) {
        const team = (t) => players.filter(p => p.team === t).sort((a, b) => b.alive - a.alive);
        left = side(<>{team(1).map(p => <Diamond key={p.id} col="#ff4d5e" on={p.alive} />)}{num(teamPts[1] || 0, '#ff8a8a')}</>, 'flex-end');
        right = side(<>{num(teamPts[2] || 0, '#8ab8ff')}{team(2).map(p => <Diamond key={p.id} col="#3d8bff" on={p.alive} />)}</>, 'flex-start');
    } else {
        left = side(<span className="gtitle" style={{ color: '#cfe3ff', fontSize: touchUI ? '0.72rem' : '0.82rem' }}>{round > 0 ? `ROUND ${round}/${maxRounds}` : ''}</span>, 'flex-end');
        const sorted = players.slice().sort((a, b) => (b.id === socket.id) - (a.id === socket.id) || b.alive - a.alive);
        right = side(<>{sorted.map(p => <Diamond key={p.id} col={p.id === socket.id ? '#4dff88' : '#ffb03d'} on={p.alive} />)}
            {num(players.filter(p => p.alive).length, '#ffd27a')}</>, 'flex-start');
    }
    return (
        <div style={{
            position: 'absolute', top: EDGE_TOP, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 10,
            pointerEvents: 'none', padding: touchUI ? '3px 10px' : '5px 14px', borderRadius: 14,
            background: 'linear-gradient(90deg, rgba(10,16,30,0) 0%, rgba(10,16,30,0.72) 18%, rgba(10,16,30,0.72) 82%, rgba(10,16,30,0) 100%)',
        }}>
            {left}
            <div className="gtitle" style={{
                padding: touchUI ? '3px 12px' : '5px 16px', borderRadius: 10, color: '#fff', fontSize: touchUI ? '1rem' : '1.25rem',
                background: 'linear-gradient(180deg,#3d9bff,#1f62d6)', border: '2px solid #fff', boxShadow: '0 3px 0 #0b2f6e',
                fontVariantNumeric: 'tabular-nums', minWidth: touchUI ? 52 : 64, textAlign: 'center',
            }}>{time}</div>
            {right}
        </div>
    );
}

function HealthHud({ hp, max = 100, touchUI }) {
    const v = Math.max(0, Math.min(100, (hp / max) * 100));
    const col = v > 60 ? '#3ddc84' : v > 30 ? '#ffc93d' : '#ff4d4d';
    return (
        <div style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)', zIndex: 6, pointerEvents: 'none',
            bottom: `calc(${EDGE_BOTTOM} + ${touchUI ? '6px' : '40px'})`,
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px',
            background: 'linear-gradient(180deg, rgba(20,32,56,0.85), rgba(10,16,30,0.85))', borderRadius: 14,
            border: '2px solid rgba(143,184,255,0.55)', boxShadow: '0 3px 0 rgba(0,0,0,0.35)',
            animation: v <= 30 ? 'lowHp 0.6s ease-in-out infinite alternate' : 'none',
        }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 21 C5 15 2 12 2 8 A5 5 0 0 1 12 6 A5 5 0 0 1 22 8 C22 12 19 15 12 21 Z" fill={col} /></svg>
            <div style={{ width: 'clamp(110px, 22vw, 200px)', height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                <div style={{
                    width: `${v}%`, height: '100%', borderRadius: 6, transition: 'width 0.2s, background 0.2s',
                    background: `linear-gradient(180deg, ${col}, ${col}aa)`, boxShadow: `0 0 10px ${col}`,
                }} />
            </div>
            <span className="gtitle" style={{ color: '#fff', fontSize: '0.8rem', minWidth: 28, textAlign: 'right' }}>{Math.max(0, Math.ceil(hp))}</span>
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

