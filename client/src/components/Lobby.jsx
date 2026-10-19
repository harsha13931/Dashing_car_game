import React, { useState, useRef, useEffect } from 'react';
import { socket } from '../net/socket';
import { soundManager } from '../utils/SoundManager';
import { drawCarBody, drawWheels, drawHeadlights } from './CanvasRenderer';
import {
    PAINTS, TOPPERS, TRAILS,
    loadGarage, saveGarage, cosmeticsFor,
    paintColor, drawTopper,
} from '../cosmetics';
import { CAR_VARIANT, tintedCar, preloadCarArt } from '../carArt';

const DIFFICULTIES = [
    { key: 'easy', label: 'Easy', color: '#4ade80', desc: 'Relaxed bots' },
    { key: 'medium', label: 'Medium', color: '#facc15', desc: 'Balanced' },
    { key: 'hard', label: 'Hard', color: '#f97316', desc: 'Aggressive' },
    { key: 'insane', label: 'Insane', color: '#ef4444', desc: 'No mercy' },
];

const CAR_TYPES = [
    { key: 'sports',   name: 'Venom GT',      emoji: '🏎️', color: '#1199dd', speed: 4, handling: 3, power: 2, weight: 2, desc: 'Fast and agile' },
    { key: 'muscle',   name: 'Thunder V8',    emoji: '💪', color: '#cc2244', speed: 3, handling: 2, power: 4, weight: 3, desc: 'Heavy hitter' },
    { key: 'truck',    name: 'War Rig',       emoji: '🛻', color: '#dd8800', speed: 1, handling: 1, power: 5, weight: 5, desc: 'Unstoppable force' },
    { key: 'rally',    name: 'Dust Devil',    emoji: '🏁', color: '#22aa44', speed: 3, handling: 5, power: 2, weight: 2, desc: 'Best handling' },
    { key: 'kart',     name: 'Pocket Rocket', emoji: '🎮', color: '#ccaa00', speed: 5, handling: 4, power: 1, weight: 1, desc: 'Tiny but fast' },
    { key: 'suv',      name: 'Iron Shield',   emoji: '🛡️', color: '#00aaaa', speed: 2, handling: 2, power: 3, weight: 4, desc: 'Tank with style' },
    { key: 'drift',    name: 'Sidewinder',    emoji: '💨', color: '#9944cc', speed: 3, handling: 5, power: 2, weight: 2, desc: 'Drift king' },
    { key: 'supercar', name: 'Phantom X',     emoji: '⚡', color: '#cc5522', speed: 5, handling: 3, power: 1, weight: 1, desc: 'Pure speed' },
];

function StatBar({ value, max = 5, color }) {
    return (
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
            {Array.from({ length: max }, (_, i) => (
                <div key={i} style={{
                    width: '14px', height: '6px', borderRadius: '2px',
                    background: i < value ? color : 'rgba(255,255,255,0.08)',
                    transition: 'background 0.2s',
                }} />
            ))}
        </div>
    );
}

// Draws a single car (wheels → body → headlights → topper) centered at the
// current transform origin, pointing right (+x), matching the in-game look.
// `cos` (optional) applies equipped cosmetics.
function paintCar(ctx, carKey, baseColor, cos) {
    const color = (cos && paintColor(cos.paint)) || baseColor;
    const variant = CAR_VARIANT[carKey] || 1;
    const sprite = tintedCar(variant, color);

    // Drop shadow under the car
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(1, 3, 17, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (sprite) {
        // Kenney sprite faces up; our local space has the nose at +x → rotate 90°
        const L = 46, W = L * sprite.width / sprite.height;
        ctx.save();
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(sprite, -W / 2, -L / 2, W, L);
        ctx.restore();
    } else {
        drawWheels(ctx, carKey);
        drawCarBody(ctx, carKey, color, false);
        drawHeadlights(ctx, carKey);
    }
    if (cos && cos.topper && cos.topper !== 'none') drawTopper(ctx, cos.topper);
}

// Large rotating turntable preview of the selected car.
function CarShowroom({ car, cos }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const W = canvas.clientWidth || 440;
        const H = 215;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        let raf, angle = -Math.PI / 2 - 0.5, running = true;

        function frame() {
            if (!running) return;
            ctx.clearRect(0, 0, W, H);
            const cx = W / 2, cy = 92;

            // Spotlight glow
            const glow = ctx.createRadialGradient(cx, cy - 10, 0, cx, cy, 150);
            glow.addColorStop(0, 'rgba(232,160,48,0.14)');
            glow.addColorStop(0.5, 'rgba(232,160,48,0.04)');
            glow.addColorStop(1, 'rgba(232,160,48,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, W, H);

            // Turntable platform (flattened ellipse) beneath the car
            ctx.save();
            ctx.translate(cx, cy + 52);
            ctx.scale(1, 0.3);
            ctx.beginPath();
            ctx.arc(0, 0, 115, 0, Math.PI * 2);
            const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, 115);
            pg.addColorStop(0, 'rgba(255,255,255,0.06)');
            pg.addColorStop(1, 'rgba(255,255,255,0.01)');
            ctx.fillStyle = pg;
            ctx.fill();
            ctx.strokeStyle = 'rgba(232,160,48,0.3)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, 88, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(232,160,48,0.12)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();

            // Car on the turntable
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            ctx.scale(2.8, 2.8);   // ≈ the sprite's native size → crisp, not blown up
            paintCar(ctx, car.key, car.color, cos);
            ctx.restore();

            // Bottom scrim so the name stays readable over the platform
            const scrim = ctx.createLinearGradient(0, H - 58, 0, H);
            scrim.addColorStop(0, 'rgba(10,13,19,0)');
            scrim.addColorStop(1, 'rgba(10,13,19,0.85)');
            ctx.fillStyle = scrim;
            ctx.fillRect(0, H - 58, W, 58);

            angle += 0.005;
            raf = requestAnimationFrame(frame);
        }
        frame();
        return () => { running = false; cancelAnimationFrame(raf); };
    }, [car.key, car.color, cos && cos.paint, cos && cos.wheel, cos && cos.topper]);

    return (
        <div style={{
            position: 'relative', borderRadius: '12px', overflow: 'hidden',
            background: 'radial-gradient(ellipse at 50% 35%, #141922 0%, #0a0d13 100%)',
            border: '1px solid rgba(255,255,255,0.06)',
        }}>
            <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />
            <div style={{
                position: 'absolute', bottom: '10px', left: 0, right: 0,
                textAlign: 'center', pointerEvents: 'none',
            }}>
                <div style={{
                    fontSize: '1.35rem', fontWeight: 800, letterSpacing: '1px',
                    color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,0.9)',
                }}>{car.name}</div>
                <div style={{ fontSize: '0.75rem', color: car.color, fontStyle: 'italic' }}>
                    {car.desc}
                </div>
            </div>
        </div>
    );
}

// Small static thumbnail used in the picker strip.
function CarThumb({ car, cos, active, onSelect }) {
    const canvasRef = useRef(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const W = 50, H = 38;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        let cancelled = false;
        const draw = () => {
            if (cancelled) return;
            ctx.clearRect(0, 0, W, H);
            const paint = (cos && paintColor(cos.paint)) || car.color;
            const sprite = tintedCar(CAR_VARIANT[car.key] || 1, paint);
            if (sprite) {
                const h = 34, w = h * sprite.width / sprite.height;
                ctx.drawImage(sprite, W / 2 - w / 2, H / 2 - h / 2, w, h);
            } else {
                ctx.save();
                ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 2); ctx.scale(1.25, 1.25);
                drawWheels(ctx, car.key); drawCarBody(ctx, car.key, car.color, false);
                ctx.restore();
            }
        };
        draw();
        preloadCarArt(draw);
        return () => { cancelled = true; };
    }, [car.key, car.color, cos && cos.paint]);

    return (
        <button
            onClick={() => onSelect(car.key)}
            title={car.name}
            style={{
                flex: '1 1 0', minWidth: '48px', height: '46px', padding: 0,
                background: active ? 'rgba(232,160,48,0.12)' : 'rgba(255,255,255,0.02)',
                border: `2px solid ${active ? '#e8a030' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
        >
            <canvas ref={canvasRef} style={{ width: '50px', height: '38px' }} />
        </button>
    );
}

function NavArrow({ dir, onClick }) {
    return (
        <button
            onClick={onClick}
            aria-label={dir === 'prev' ? 'Previous car' : 'Next car'}
            style={{
                position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                [dir === 'prev' ? 'left' : 'right']: '10px',
                width: '40px', height: '40px', borderRadius: '50%',
                background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(232,160,48,0.4)',
                color: '#e8a030', fontSize: '1.3rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'inherit', lineHeight: 1, zIndex: 2,
            }}
        >{dir === 'prev' ? '‹' : '›'}</button>
    );
}

// Small canvas preview of a topper for the customize grid.
function TopperThumb({ topperKey }) {
    const canvasRef = useRef(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const S = 40;
        canvas.width = S * dpr; canvas.height = S * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, S, S);
        if (topperKey === 'none') {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(14, 20); ctx.lineTo(26, 20); ctx.stroke();
            return;
        }
        ctx.save();
        ctx.translate(S / 2, S / 2 + 6);
        ctx.rotate(-Math.PI / 2);   // orient topper upright in the thumb
        ctx.scale(1.5, 1.5);
        drawTopper(ctx, topperKey);
        ctx.restore();
    }, [topperKey]);
    return <canvas ref={canvasRef} style={{ width: '40px', height: '40px' }} />;
}

const CUSTOMIZE_TABS = [
    { key: 'paint',  label: 'Paint' },
    { key: 'topper', label: 'Hat' },
    { key: 'trail',  label: 'Trail' },
];

function Swatch({ active, onClick, title, children }) {
    return (
        <button
            onClick={onClick}
            title={title}
            style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                padding: '7px 4px', cursor: 'pointer', fontFamily: 'inherit',
                background: active ? 'rgba(232,160,48,0.14)' : 'rgba(255,255,255,0.02)',
                border: `2px solid ${active ? '#e8a030' : 'rgba(255,255,255,0.07)'}`,
                borderRadius: '10px', transition: 'all 0.15s', position: 'relative',
            }}
        >
            {children}
            <span style={{
                fontSize: '0.6rem', color: active ? '#e8a030' : '#8899aa',
                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px',
            }}>{title}</span>
        </button>
    );
}

function CustomizeScreen({ car, cos, onChange, onDone }) {
    const [tab, setTab] = useState('paint');

    const set = (field, value) => { onChange({ ...cos, [field]: value }); soundManager.playClick(); };

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.25rem' }}>
                <button
                    onClick={() => { onDone(); soundManager.playClick(); }}
                    style={{ background: 'none', border: 'none', color: '#8899aa', cursor: 'pointer', fontSize: '1.2rem', padding: '4px', fontFamily: 'inherit' }}
                >←</button>
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px', color: '#8899aa' }}>
                    Customize · {car.name}
                </span>
            </div>

            <CarShowroom car={car} cos={cos} />

            {/* Category tabs */}
            <div style={{ display: 'flex', gap: '4px' }}>
                {CUSTOMIZE_TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => { setTab(t.key); soundManager.playClick(); }}
                        style={{
                            flex: 1, padding: '7px', borderRadius: '6px', cursor: 'pointer',
                            fontFamily: 'inherit', fontWeight: 700, fontSize: '0.72rem',
                            textTransform: 'uppercase', letterSpacing: '0.5px',
                            background: tab === t.key ? 'rgba(232,160,48,0.16)' : 'transparent',
                            border: `1px solid ${tab === t.key ? '#e8a030' : 'rgba(255,255,255,0.08)'}`,
                            color: tab === t.key ? '#e8a030' : '#8899aa', transition: 'all 0.15s',
                        }}
                    >{t.label}</button>
                ))}
            </div>

            {/* Item grid */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px',
                background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '10px',
                maxHeight: '150px', overflowY: 'auto',
            }}>
                {tab === 'paint' && PAINTS.map(p => (
                    <Swatch key={p.key} active={cos.paint === p.key} title={p.name} onClick={() => set('paint', p.key)}>
                        <div style={{
                            width: '32px', height: '32px', borderRadius: '50%',
                            background: p.color || car.color,
                            border: '2px solid rgba(255,255,255,0.15)',
                            boxShadow: 'inset 0 -4px 6px rgba(0,0,0,0.35), inset 0 3px 4px rgba(255,255,255,0.25)',
                        }} />
                    </Swatch>
                ))}

                {tab === 'topper' && TOPPERS.map(tp => (
                    <Swatch key={tp.key} active={cos.topper === tp.key} title={tp.name} onClick={() => set('topper', tp.key)}>
                        <div style={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <TopperThumb topperKey={tp.key} />
                        </div>
                    </Swatch>
                ))}

                {tab === 'trail' && TRAILS.map(tr => (
                    <Swatch key={tr.key} active={cos.trail === tr.key} title={tr.name} onClick={() => set('trail', tr.key)}>
                        <div style={{
                            width: '34px', height: '18px', borderRadius: '9px',
                            background: tr.rainbow
                                ? 'linear-gradient(90deg,#ff3b3b,#ffb03b,#ffe83b,#3bff6b,#3bc6ff,#b23bff)'
                                : `linear-gradient(90deg, ${tr.color}, rgba(0,0,0,0))`,
                        }} />
                    </Swatch>
                ))}
            </div>

            <button className="btn" onClick={() => { onDone(); soundManager.playClick(); }} style={{ marginTop: '0.25rem' }}>
                DONE
            </button>
        </>
    );
}

function CarStats({ carKey }) {
    const car = CAR_TYPES.find(c => c.key === carKey);
    if (!car) return null;
    return (
        <div style={{
            background: 'rgba(0,0,0,0.25)', borderRadius: '8px', padding: '10px 12px',
            display: 'grid', gridTemplateColumns: '70px 1fr', gap: '4px 8px', alignItems: 'center',
        }}>
            <span className="text-dim" style={{ fontSize: '0.7rem' }}>SPEED</span>
            <StatBar value={car.speed} color="#33cc77" />
            <span className="text-dim" style={{ fontSize: '0.7rem' }}>HANDLING</span>
            <StatBar value={car.handling} color="#3399dd" />
            <span className="text-dim" style={{ fontSize: '0.7rem' }}>POWER</span>
            <StatBar value={car.power} color="#dd3344" />
            <span className="text-dim" style={{ fontSize: '0.7rem' }}>WEIGHT</span>
            <StatBar value={car.weight} color="#dd8822" />
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: car.color, fontSize: '0.75rem', fontStyle: 'italic', marginTop: '2px' }}>
                {car.desc}
            </div>
        </div>
    );
}

const INVITE_CODE = (new URLSearchParams(window.location.search).get('room') || '').toUpperCase();

export default function Lobby({ room, setRoom, setPlayer, player, connected, connError }) {
    const [name, setName] = useState(() => {
        try { return localStorage.getItem('dasharena.name') || 'Player'; } catch (_) { return 'Player'; }
    });
    const [rid, setRid] = useState(INVITE_CODE);
    const [error, setError] = useState('');
    const [botCount, setBotCount] = useState(3);
    const [botDifficulty, setBotDifficulty] = useState('medium');
    const [carType, setCarTypeRaw] = useState(() => {
        try {
            const k = localStorage.getItem('dasharena.car');
            return CAR_TYPES.some(c => c.key === k) ? k : 'sports';
        } catch (_) { return 'sports'; }
    });
    const setCarType = (k) => {
        setCarTypeRaw(k);
        try { localStorage.setItem('dasharena.car', k); } catch (_) { /* ignore */ }
    };
    const [tab, setTab] = useState('multi');
    const [copied, setCopied] = useState(false);
    const [step, setStep] = useState('name');
    const [garage, setGarage] = useState(loadGarage);
    const cosmetics = cosmeticsFor(garage, carType);   // the selected car's own look

    useEffect(() => { preloadCarArt(); }, []);
    useEffect(() => {
        try { localStorage.setItem('dasharena.name', name); } catch (_) { /* ignore */ }
    }, [name]);

    function updateCosmetics(next) {
        const g = { ...garage, [carType]: next };
        setGarage(g);
        saveGarage(g);
    }

    function createRoom() {
        soundManager.playClick();
        socket.connect();
        socket.emit('createRoom', {
            name,
            botCount: tab === 'solo' ? botCount : 0,
            botDifficulty,
            carType,
            cosmetics,
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
        const code = rid.trim().toUpperCase();
        socket.emit('joinRoom', { roomId: code, name, carType, cosmetics }, (res) => {
            if (res && res.error) { setError(res.error); return; }
            setRoom({ id: res.roomId || code });
            if (res.player) setPlayer(res.player);
            setError('');
        });
    }

    function shareInvite() {
        const link = `${window.location.origin}/?room=${room.id}`;
        soundManager.playClick();
        if (navigator.share) {
            navigator.share({ title: 'Dash Arena', text: `Join my Dash Arena room ${room.id}!`, url: link }).catch(() => {});
            return;
        }
        navigator.clipboard?.writeText(link).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
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

    function cycleCar(dir) {
        const idx = CAR_TYPES.findIndex(c => c.key === carType);
        const next = (idx + dir + CAR_TYPES.length) % CAR_TYPES.length;
        setCarType(CAR_TYPES[next].key);
        soundManager.playClick();
    }

    const selectedCar = CAR_TYPES.find(c => c.key === carType) || CAR_TYPES[0];

    return (
        <div className="center full-screen" style={{ overflow: 'auto', padding: '1rem' }}>
            <div className="lobby-panel panel flex-col" style={{
                width: '100%', maxWidth: room ? '440px' : '520px', padding: '1.5rem 1.5rem 2rem',
                border: '1px solid rgba(255,255,255,0.06)',
                boxShadow: '0 8px 60px rgba(0,0,0,0.6)',
            }}>
                <h1 style={{
                    textAlign: 'center', fontSize: 'clamp(1.6rem,5vw,2.5rem)',
                    marginBottom: '0.15rem', letterSpacing: '3px',
                    color: '#e8a030', fontWeight: 800,
                }}>DASH ARENA</h1>
                <p style={{ textAlign: 'center', fontSize: '0.8rem', margin: 0, color: '#8899aa' }}>
                    Knock opponents off the arena to win
                </p>

                {!connected && (
                    <div style={{
                        color: '#facc15', textAlign: 'center',
                        background: 'rgba(250,204,21,0.08)', padding: '0.5rem', borderRadius: '6px',
                        fontSize: '0.85rem',
                    }}>
                        Connecting to server...
                        {connError && (
                            <div style={{ color: '#ff8a8a', fontSize: '0.72rem', marginTop: 4 }}>
                                {connError} — the free server may be waking up; this can take ~50s on first load.
                            </div>
                        )}
                    </div>
                )}

                {error && (
                    <div style={{
                        color: '#ff4466', textAlign: 'center',
                        background: 'rgba(255,68,102,0.08)', padding: '0.5rem', borderRadius: '6px',
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
                                    {['multi', 'solo'].map(t => (
                                        <button
                                            key={t}
                                            onClick={() => { setTab(t); soundManager.playClick(); }}
                                            style={{
                                                flex: 1, padding: '10px',
                                                background: tab === t ? 'rgba(232, 160, 48, 0.12)' : 'transparent',
                                                border: `1px solid ${tab === t ? '#e8a030' : 'rgba(255,255,255,0.08)'}`,
                                                color: tab === t ? '#e8a030' : '#8899aa',
                                                cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                                                fontSize: '0.85rem', textTransform: 'uppercase',
                                                borderRadius: t === 'multi' ? '6px 0 0 6px' : '0 6px 6px 0',
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
                                            background: 'none', border: 'none', color: '#8899aa',
                                            cursor: 'pointer', fontSize: '1.2rem', padding: '4px',
                                            fontFamily: 'inherit',
                                        }}
                                    >←</button>
                                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px', color: '#8899aa' }}>
                                        Select Your Vehicle
                                    </span>
                                </div>

                                {/* Showroom preview with browse arrows */}
                                <div style={{ position: 'relative' }}>
                                    <CarShowroom car={selectedCar} cos={cosmetics} />
                                    <NavArrow dir="prev" onClick={() => cycleCar(-1)} />
                                    <NavArrow dir="next" onClick={() => cycleCar(1)} />
                                </div>

                                {/* Thumbnail picker strip */}
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                    {CAR_TYPES.map(car => (
                                        <CarThumb
                                            key={car.key}
                                            car={car}
                                            cos={cosmeticsFor(garage, car.key)}
                                            active={carType === car.key}
                                            onSelect={k => { setCarType(k); soundManager.playClick(); }}
                                        />
                                    ))}
                                </div>

                                <button
                                    onClick={() => { setStep('customize'); soundManager.playClick(); }}
                                    style={{
                                        padding: '10px', borderRadius: '8px', cursor: 'pointer',
                                        fontFamily: 'inherit', fontWeight: 700, fontSize: '0.85rem',
                                        textTransform: 'uppercase', letterSpacing: '1px',
                                        background: 'rgba(232,160,48,0.1)', border: '1px solid #e8a030',
                                        color: '#e8a030',
                                    }}
                                >🎨 Customize</button>

                                <CarStats carKey={carType} />

                                {tab === 'solo' && (
                                    <div className="flex-col" style={{ gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: '8px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <label className="text-dim" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                                Bots: <span style={{ color: '#e8a030', fontWeight: 700 }}>{botCount}</span>
                                            </label>
                                            <input
                                                type="range" min="1" max="7" value={botCount}
                                                onChange={e => setBotCount(Number(e.target.value))}
                                                style={{ width: '120px', accentColor: '#e8a030' }}
                                            />
                                        </div>
                                        <div className="flex-row" style={{ gap: '4px', flexWrap: 'wrap' }}>
                                            {DIFFICULTIES.map(d => (
                                                <button
                                                    key={d.key}
                                                    onClick={() => { setBotDifficulty(d.key); soundManager.playClick(); }}
                                                    style={{
                                                        flex: '1 1 0', minWidth: '55px', padding: '5px 2px',
                                                        background: botDifficulty === d.key ? 'rgba(255,255,255,0.06)' : 'transparent',
                                                        border: `1px solid ${botDifficulty === d.key ? '#ddd' : 'rgba(255,255,255,0.08)'}`,
                                                        color: botDifficulty === d.key ? d.color : '#8899aa',
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

                        {step === 'customize' && (
                            <CustomizeScreen
                                car={selectedCar}
                                cos={cosmetics}
                                onChange={updateCosmetics}
                                onDone={() => setStep('car')}
                            />
                        )}
                    </>
                ) : (
                    <div className="flex-col">
                        <div className="center flex-col" style={{ gap: '4px' }}>
                            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '2px', color: '#8899aa' }}>Room ID</div>
                            <div style={{
                                fontSize: 'clamp(1.2rem,4vw,2rem)', letterSpacing: '3px',
                                fontWeight: 'bold', fontFamily: 'monospace', color: '#fff',
                            }}>{room.id}</div>
                            <div style={{ fontSize: '0.65rem', color: '#8899aa' }}>Share this code with friends</div>
                            <button onClick={shareInvite} style={{
                                marginTop: '6px', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer',
                                fontFamily: 'inherit', fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.5px',
                                background: 'rgba(232,160,48,0.12)', border: '1px solid #e8a030', color: '#e8a030',
                            }}>{copied ? '✓ Link copied' : '🔗 Invite friends'}</button>
                        </div>

                        <div style={{
                            background: 'rgba(0,0,0,0.25)', padding: '0.75rem',
                            borderRadius: '8px', minHeight: '100px',
                        }}>
                            <h4 style={{ marginBottom: '0.5rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px', color: '#8899aa' }}>
                                Players ({room.players?.length || 0})
                            </h4>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                {room.players?.map(p => {
                                    const carInfo = CAR_TYPES.find(c => c.key === p.carType);
                                    return (
                                        <li key={p.id} className="flex-row" style={{
                                            padding: '5px 0',
                                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                                            gap: '8px',
                                        }}>
                                            <div style={{
                                                width: '8px', height: '8px', borderRadius: '50%',
                                                background: p.isBot ? '#dd8822' : (p.alive ? '#33cc77' : '#555'),
                                            }} />
                                            <span style={{ color: p.id === player?.id ? '#fff' : '#bbb', fontSize: '0.85rem', flex: 1 }}>
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

                        {/* Match length — the host picks how many rounds */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '1px', color: '#8899aa' }}>Rounds</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                                {[1, 3, 5].map(n => {
                                    const isHost = room.hostId === socket.id;
                                    const on = (room.maxRounds || 3) === n;
                                    return (
                                        <button key={n} disabled={!isHost}
                                            onClick={() => { socket.emit('updateSettings', { roomId: room.id, settings: { maxRounds: n } }); soundManager.playClick(); }}
                                            style={{
                                                minWidth: 44, padding: '6px 10px', borderRadius: 6, fontFamily: 'inherit', fontWeight: 700,
                                                cursor: isHost ? 'pointer' : 'default', opacity: isHost || on ? 1 : 0.45,
                                                background: on ? 'rgba(232,160,48,0.16)' : 'transparent',
                                                border: `1px solid ${on ? '#e8a030' : 'rgba(255,255,255,0.1)'}`,
                                                color: on ? '#e8a030' : '#8899aa',
                                            }}>{n}</button>
                                    );
                                })}
                            </div>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#8899aa', textAlign: 'center', lineHeight: 1.4 }}>
                            Push rivals through the fence. Last car standing wins the round —
                            after {room.maxRounds || 3} round{(room.maxRounds || 3) > 1 ? 's' : ''}, the most points wins the match.
                        </div>

                        {room.hostId === socket.id ? (
                            <button className="btn" onClick={startMatch} style={{ marginTop: '0.25rem' }}>
                                START MATCH
                            </button>
                        ) : (
                            <div style={{ textAlign: 'center', color: '#e8a030', fontSize: '0.85rem', padding: '10px' }}>
                                Waiting for the host to start…
                            </div>
                        )}
                        <button className="btn btn-secondary" onClick={leaveRoom} style={{ fontSize: '0.8rem', padding: '8px' }}>
                            LEAVE ROOM
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
