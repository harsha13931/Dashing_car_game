import React, { useState, useRef, useEffect, Suspense, lazy } from 'react';
import { socket } from '../net/socket';
import { soundManager } from '../utils/SoundManager';
import {
    PAINTS, TOPPERS, TRAILS, WHEELS, FINISHES, DECALS, DECAL_COLORS, SPOILERS, HOODS, UNDERGLOWS, TINTS,
    loadGarage, saveGarage, cosmeticsFor, drawTopper, underglowColor,
} from '../cosmetics';
import { renderCar, lookKey } from '../carRender';
import { CAR_TYPES as PHYS_CARS, ARENAS, GAME_MODES, MODE_KEYS } from '../../../shared/physics.mjs';

const ARENA_ICON = { random: '🎲', classic: '🏟️', ice: '❄️', box: '⬛', sinkhole: '🕳️', windmill: '🌀' };
const ARENA_CHOICES = ['random', ...Object.keys(ARENAS)];
const arenaLabel = (k) => `${ARENA_ICON[k] || ''} ${k === 'random' ? 'Random' : ARENAS[k].name}`;
import { getToken, saveRoom, clearRoom } from '../net/session';
import { useInstall, promptInstall, isIOS } from '../pwa';
import { gfxSetting, setGfxSetting, webglOK } from '../gfx';

// The real 3D car on the showroom turntable (a flat picture while it loads)
const Showroom3D = lazy(() => import('../three/Showroom3D'));
import { ChatPanel, ChatButton, VoiceControls, VoiceBadge } from './Social';
import { leaveVoice } from '../net/voice';
import { clearChat } from '../net/chat';
import {
    useProfile, ownsCar, ownsItem, itemPrice, buyCar, buyItem, CAR_PRICES, dailyStatus,
} from '../progress';
import { Coin, CoinPill, LevelBadge, DailyRewardModal, ChallengeList, fmt } from './Rewards';

// ─── Menus: home (car stage), garage, play sheets, settings, room ─────────

const DIFFICULTIES = [
    { key: 'easy', label: 'Easy', color: '#4ade80' },
    { key: 'medium', label: 'Medium', color: '#facc15' },
    { key: 'hard', label: 'Hard', color: '#f97316' },
    { key: 'insane', label: 'Insane', color: '#ef4444' },
];

// Menu cards: look + 1–5 bars worked out from the real physics numbers
const CAR_LOOK = [
    { key: 'sports',   emoji: '🏎️', color: '#1199dd' },
    { key: 'muscle',   emoji: '💪', color: '#cc2244' },
    { key: 'truck',    emoji: '🛻', color: '#dd8800' },
    { key: 'rally',    emoji: '🏁', color: '#22aa44' },
    { key: 'kart',     emoji: '🎮', color: '#ccaa00' },
    { key: 'suv',      emoji: '🛡️', color: '#00aaaa' },
    { key: 'drift',    emoji: '💨', color: '#9944cc' },
    { key: 'supercar', emoji: '⚡', color: '#cc5522' },
];
const bar = (v, lo, hi) => Math.max(1, Math.min(5, Math.round(1 + 4 * (v - lo) / (hi - lo))));
const CAR_TYPES = CAR_LOOK.map(l => {
    const s = PHYS_CARS[l.key];
    return {
        ...l, name: s.name, role: s.role, desc: s.desc,
        speed: bar(s.maxSpeed, 0.8, 1.45),
        handling: bar(s.turn, 0.78, 1.55),
        power: bar(s.dashForce * s.mass * s.maxSpeed, 0.95, 1.9),   // ram hit = weight × nitro × speed
        armor: bar(s.hp * s.stability, 100, 170),
        weight: bar(s.mass, 0.85, 1.6),
    };
});

const INVITE_CODE = (new URLSearchParams(window.location.search).get('room') || '').toUpperCase();
const SAFE_TOP = 'max(12px, env(safe-area-inset-top))';
const SAFE_BOTTOM = 'max(14px, env(safe-area-inset-bottom))';
const SAFE_X = 'max(14px, env(safe-area-inset-left))';

function useViewport() {
    const get = () => ({ w: window.innerWidth, h: window.innerHeight });
    const [vp, setVp] = useState(get);
    useEffect(() => {
        const on = () => setVp(get());
        window.addEventListener('resize', on);
        window.addEventListener('orientationchange', on);
        return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
    }, []);
    return { ...vp, landscape: vp.w > vp.h && vp.h < 560 };
}

const click = () => soundManager.playClick();

function StatBar({ value, max = 5, color }) {
    return (
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {Array.from({ length: max }, (_, i) => (
                <div key={i} style={{
                    width: 18, height: 8, borderRadius: 3, transform: 'skewX(-12deg)',
                    background: i < value ? `linear-gradient(180deg, ${color}, ${color}bb)` : 'rgba(255,255,255,0.08)',
                    boxShadow: i < value ? `0 0 6px ${color}66` : 'none',
                    transition: 'background 0.2s',
                }} />
            ))}
        </div>
    );
}

function CarStats({ carKey }) {
    const car = CAR_TYPES.find(c => c.key === carKey);
    if (!car) return null;
    const rows = [['SPEED', car.speed, '#33cc77'], ['HANDLING', car.handling, '#33a6ff'], ['POWER', car.power, '#ff4d5e'], ['ARMOR', car.armor, '#c08bff'], ['WEIGHT', car.weight, '#ffaa22']];
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 12px', alignItems: 'center' }}>
            {rows.map(([label, v, c]) => (
                <React.Fragment key={label}>
                    <span className="gtitle" style={{ fontSize: '0.62rem', color: '#8fa1b8' }}>{label}</span>
                    <StatBar value={v} color={c} />
                </React.Fragment>
            ))}
        </div>
    );
}

// Small vertical car for player slots
function SlotCar({ carType, cos, h = 52 }) {
    const ref = useRef(null);
    useEffect(() => {
        const cv = ref.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const H = h, W = Math.round(h * 0.62);
        cv.width = W * dpr; cv.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const sprite = carCanvas(carType, cos, 0.5);
        const sh = H - 4, sw = sh * sprite.width / sprite.height;
        ctx.drawImage(sprite, W / 2 - sw / 2, 2, sw, sh);
    }, [carType, JSON.stringify(cos || {}), h]);
    return <canvas ref={ref} style={{ width: Math.round(h * 0.62), height: h }} />;
}

function Sheet({ title, onClose, children }) {
    return (
        <div className="sheet-backdrop" onClick={() => { click(); onClose(); }}>
            <div className="sheet gpanel" onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div className="gtitle" style={{ fontSize: '1.25rem', color: '#ffd84d' }}>{title}</div>
                    <button onClick={() => { click(); onClose(); }} aria-label="Close" style={{
                        width: 36, height: 36, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)',
                        background: 'rgba(0,0,0,0.3)', color: '#cdd6e2', fontSize: '1rem', cursor: 'pointer',
                    }}>✕</button>
                </div>
                {children}
            </div>
        </div>
    );
}

function Pill({ active, onClick, children, color = '#ffd84d', disabled }) {
    return (
        <button onClick={onClick} disabled={disabled} className="gtitle" style={{
            flex: 1, minWidth: 0, padding: '10px 6px', borderRadius: 12, cursor: disabled ? 'default' : 'pointer',
            fontSize: '0.78rem', background: active ? `${color}26` : 'rgba(0,0,0,0.25)',
            border: `2px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
            color: active ? color : '#8fa1b8', opacity: disabled && !active ? 0.45 : 1,
        }}>{children}</button>
    );
}

function Stepper({ value, min, max, onChange, disabled }) {
    const btn = (label, d, off) => (
        <button disabled={disabled || off} onClick={() => { onChange(value + d); click(); }} className="gbtn dark"
            style={{ width: 44, height: 40, padding: 0, fontSize: '1.2rem', borderRadius: 10 }}>{label}</button>
    );
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {btn('−', -1, value <= min)}
            <span className="gtitle" style={{ minWidth: 26, textAlign: 'center', fontSize: '1.3rem', color: '#ffd84d' }}>{value}</span>
            {btn('+', 1, value >= max)}
        </div>
    );
}

function Toggle({ label, on, onChange }) {
    return (
        <button onClick={() => { onChange(!on); click(); }} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
            padding: '12px 4px', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
            cursor: 'pointer', color: '#e6edf5', fontFamily: 'inherit', fontSize: '0.95rem',
        }}>
            <span>{label}</span>
            <span style={{
                width: 52, height: 30, borderRadius: 15, position: 'relative', transition: 'background 0.15s',
                background: on ? '#20b155' : 'rgba(255,255,255,0.15)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)',
            }}>
                <span style={{
                    position: 'absolute', top: 3, left: on ? 25 : 3, width: 24, height: 24, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.15s', boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                }} />
            </span>
        </button>
    );
}

const Label = ({ children }) => (
    <div className="gtitle" style={{ fontSize: '0.68rem', color: '#8fa1b8', margin: '14px 0 8px' }}>{children}</div>
);

// Draws a single car (wheels → body → headlights → topper) centered at the
// current transform origin, pointing right (+x), matching the in-game look.
// `cos` (optional) applies equipped cosmetics.
// Rendered cars are cached per model + build + resolution
const carCanvasCache = new Map();
function carCanvas(type, cos, res) {
    const key = `${lookKey(type, cos, 0)}@${res}`;
    let c = carCanvasCache.get(key);
    if (!c) { c = renderCar(type, cos, { res }); carCanvasCache.set(key, c); }
    if (carCanvasCache.size > 80) carCanvasCache.delete(carCanvasCache.keys().next().value);
    return c;
}

// Draws the car centred at the origin with its nose pointing +x (46 units long)
function paintCar(ctx, carKey, baseColor, cos) {
    const L = 46, W = L * 144 / 264;
    const ug = cos && underglowColor(cos.underglow);
    if (ug) {   // neon underglow
        const grd = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
        grd.addColorStop(0, ug); grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save(); ctx.scale(1, 0.62); ctx.globalAlpha = 0.75;
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
    // Drop shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(1.5, 2, 21, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(carCanvas(carKey, cos, 1.6), -W / 2, -L / 2, W, L);
    ctx.restore();
    if (cos && cos.topper && cos.topper !== 'none') drawTopper(ctx, cos.topper);
}

// Large rotating turntable preview of the selected car.
function CarShowroom(props) {
    const [use3D] = useState(webglOK);
    if (!use3D) return <CarPicture {...props} />;
    const { car, cos, height = 215 } = props;
    return (
        <Suspense fallback={<CarPicture {...props} />}>
            <Showroom3D carKey={car.key} cos={cos} height={height} />
        </Suspense>
    );
}

function CarPicture({ car, cos, height = 215, scale = 2.8, showName = true, framed = true }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let W = canvas.clientWidth || 440;
        const H = height;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        let raf, angle = -Math.PI / 2 - 0.5, running = true;

        function frame() {
            if (!running) return;
            if (canvas.clientWidth && canvas.clientWidth !== W) {      // rotated / resized
                W = canvas.clientWidth;
                canvas.width = W * dpr;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
            ctx.clearRect(0, 0, W, H);
            const cx = W / 2, cy = H * 0.43;
            const PR = Math.min(W * 0.42, H * 0.6);

            // Spotlight glow
            const glow = ctx.createRadialGradient(cx, cy - 10, 0, cx, cy, H * 0.7);
            glow.addColorStop(0, 'rgba(232,160,48,0.14)');
            glow.addColorStop(0.5, 'rgba(232,160,48,0.04)');
            glow.addColorStop(1, 'rgba(232,160,48,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, W, H);

            // Turntable platform (flattened ellipse) beneath the car
            ctx.save();
            ctx.translate(cx, cy + 18 * scale);
            ctx.scale(1, 0.3);
            ctx.beginPath();
            ctx.arc(0, 0, PR, 0, Math.PI * 2);
            const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, PR);
            pg.addColorStop(0, 'rgba(255,255,255,0.06)');
            pg.addColorStop(1, 'rgba(255,255,255,0.01)');
            ctx.fillStyle = pg;
            ctx.fill();
            ctx.strokeStyle = 'rgba(232,160,48,0.3)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, PR * 0.77, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(232,160,48,0.12)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();

            // Car on the turntable
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            ctx.scale(scale, scale);
            paintCar(ctx, car.key, car.color, cos);
            ctx.restore();

            // Bottom scrim so the name stays readable over the platform
            if (showName) {
            const scrim = ctx.createLinearGradient(0, H - 58, 0, H);
            scrim.addColorStop(0, 'rgba(10,13,19,0)');
            scrim.addColorStop(1, 'rgba(10,13,19,0.85)');
            ctx.fillStyle = scrim;
            ctx.fillRect(0, H - 58, W, 58);
            }

            angle += 0.005;
            raf = requestAnimationFrame(frame);
        }
        frame();
        return () => { running = false; cancelAnimationFrame(raf); };
    }, [car.key, car.color, JSON.stringify(cos || {}), height, scale, showName]);

    return (
        <div style={{
            position: 'relative', borderRadius: '12px', overflow: 'hidden',
            ...(framed ? {
                background: 'radial-gradient(ellipse at 50% 35%, #141922 0%, #0a0d13 100%)',
                border: '1px solid rgba(255,255,255,0.06)',
            } : {}),
        }}>
            <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />
            {showName && <div style={{
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
            </div>}
        </div>
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
    { key: 'decal',  label: 'Decals' },
    { key: 'parts',  label: 'Parts' },
    { key: 'wheels', label: 'Wheels' },
    { key: 'glow',   label: 'Neon' },
    { key: 'topper', label: 'Hat' },
    { key: 'trail',  label: 'Trail' },
];

// Little glyphs for the body-shop options
const PART_ICON = {
    stock: '🏭', none: '⨯', lip: '▁', wing: '⊓', gt: '╦',
    bulge: '◒', scoop: '⊡', vents: '≡', carbon: '▦',
    stripes: '‖', side: '⫴', flames: '🔥', number: '#', checker: '🏁',
};

function ChipGrid({ items, value, onPick, field }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 8 }}>
            {items.map(it => (
                <Swatch key={it.key} active={value === it.key} title={it.name} onClick={() => onPick(it.key)} price={lockPrice(field, it.key)}>
                    <div style={{ height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', color: '#e6edf5' }}>
                        {it.color ? <div style={{ width: 26, height: 26, borderRadius: '50%', background: it.color, boxShadow: `0 0 10px ${it.color}` }} />
                            : (PART_ICON[it.key] || '•')}
                    </div>
                </Swatch>
            ))}
        </div>
    );
}

const Section = ({ children }) => (
    <div className="gtitle" style={{ fontSize: '0.62rem', color: '#8fa1b8', margin: '10px 0 6px' }}>{children}</div>
);

// Price tag for items you haven't bought yet (0 = owned / free)
const lockPrice = (field, key) => (field && !ownsItem(field, key) ? itemPrice(field, key) : 0);
const LockTag = ({ price }) => (
    <span className="gtitle" style={{
        position: 'absolute', top: -6, right: -4, background: '#1a1f2b', border: '1px solid rgba(255,216,77,0.5)',
        borderRadius: 8, padding: '1px 5px', fontSize: '0.55rem', color: '#ffd84d', display: 'flex', alignItems: 'center', gap: 2,
    }}>🔒{price}</span>
);

function Swatch({ active, onClick, title, children, price = 0 }) {
    return (
        <button onClick={onClick} title={title} style={{
            position: 'relative',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: '8px 4px', cursor: 'pointer', fontFamily: 'inherit',
            background: active ? 'rgba(255,216,77,0.14)' : 'rgba(0,0,0,0.25)',
            border: `2px solid ${active ? '#ffd84d' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 12, boxShadow: active ? '0 0 12px rgba(255,216,77,0.35)' : 'none',
        }}>
            {price > 0 && <LockTag price={price} />}
            <div style={{ opacity: price > 0 ? 0.55 : 1 }}>{children}</div>
            <span className="gtitle" style={{ fontSize: '0.55rem', color: active ? '#ffd84d' : '#8fa1b8' }}>{title}</span>
        </button>
    );
}

function TopButton({ children, onClick, color = 'dark', style, label }) {
    return (
        <button className={`gbtn ${color}`} onClick={() => { click(); onClick(); }} aria-label={label}
            style={{ padding: '8px 12px', fontSize: '0.8rem', borderRadius: 12, ...style }}>{children}</button>
    );
}

function ArrowBtn({ dir, onClick, style }) {
    return (
        <button className="gbtn dark" onClick={onClick} aria-label={dir < 0 ? 'Previous car' : 'Next car'} style={{
            position: 'absolute', top: '45%', transform: 'translateY(-50%)', width: 48, height: 48, padding: 0,
            borderRadius: '50%', fontSize: '1.4rem', zIndex: 2, ...style,
        }}>{dir < 0 ? '‹' : '›'}</button>
    );
}

function Logo({ size = '1.9rem' }) {
    return (
        <div className="gtitle" style={{
            fontSize: size, fontStyle: 'italic', lineHeight: 1, color: '#ffc53d',
            textShadow: '0 3px 0 #8a4f00, 0 0 24px rgba(255,170,40,0.45)', animation: 'logoFloat 4s ease-in-out infinite',
            whiteSpace: 'nowrap',
        }}>DASH ARENA</div>
    );
}

// ─── Garage: paint / hat / trail for the selected car ─────────────────────
function GarageScreen({ car, cos: savedCos, onChange, onBack, onCycle, vp }) {
    const [tab, setTab] = useState('paint');
    const profile = useProfile();
    // Tapping something you don't own previews it on the car until you buy it
    const [preview, setPreview] = useState(null);     // { field, key }
    const [buyMsg, setBuyMsg] = useState('');
    useEffect(() => { setPreview(null); setBuyMsg(''); }, [car.key]);
    const cos = preview ? { ...savedCos, [preview.field]: preview.key } : savedCos;
    const set = (field, value) => {
        click(); setBuyMsg('');
        if (ownsItem(field, value)) { setPreview(null); onChange({ ...savedCos, [field]: value }); }
        else setPreview({ field, key: value });
    };
    const buy = () => {
        if (!preview) return;
        if (buyItem(preview.field, preview.key)) {
            soundManager.playPowerup();
            onChange({ ...savedCos, [preview.field]: preview.key });
            setPreview(null);
        } else {
            setBuyMsg(`Need ${fmt(itemPrice(preview.field, preview.key) - profile.coins)} more coins — win rounds & daily challenges to earn them`);
        }
    };
    const pillLock = (field, key) => { const pr = lockPrice(field, key); return pr > 0 ? <span style={{ fontSize: '0.7em', color: '#ffd84d' }}> 🔒{pr}</span> : null; };
    const stageH = vp.landscape ? Math.max(180, vp.h - 120) : Math.max(170, Math.min(300, vp.h - 520));

    const items = (
        <div>
        {tab === 'paint' && <Section>Colour</Section>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8 }}>
            {tab === 'paint' && PAINTS.map(p => (
                <Swatch key={p.key} active={cos.paint === p.key} title={p.name} onClick={() => set('paint', p.key)} price={lockPrice('paint', p.key)}>
                    <div style={{
                        width: 32, height: 32, borderRadius: '50%', background: p.color || car.color,
                        border: '2px solid rgba(255,255,255,0.2)',
                        boxShadow: 'inset 0 -4px 6px rgba(0,0,0,0.35), inset 0 3px 4px rgba(255,255,255,0.3)',
                    }} />
                </Swatch>
            ))}
            {tab === 'topper' && TOPPERS.map(tp => (
                <Swatch key={tp.key} active={cos.topper === tp.key} title={tp.name} onClick={() => set('topper', tp.key)} price={lockPrice('topper', tp.key)}>
                    <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <TopperThumb topperKey={tp.key} />
                    </div>
                </Swatch>
            ))}
            {tab === 'trail' && TRAILS.map(tr => (
                <Swatch key={tr.key} active={cos.trail === tr.key} title={tr.name} onClick={() => set('trail', tr.key)} price={lockPrice('trail', tr.key)}>
                    <div style={{
                        width: 36, height: 18, borderRadius: 9, margin: '7px 0',
                        background: tr.rainbow
                            ? 'linear-gradient(90deg,#ff3b3b,#ffb03b,#ffe83b,#3bff6b,#3bc6ff,#b23bff)'
                            : `linear-gradient(90deg, ${tr.color}, rgba(0,0,0,0))`,
                    }} />
                </Swatch>
            ))}
        </div>
        {tab === 'paint' && <>
            <Section>Finish</Section>
            <div style={{ display: 'flex', gap: 6 }}>
                {FINISHES.map(f => <Pill key={f.key} active={(cos.finish || 'gloss') === f.key} onClick={() => set('finish', f.key)}>{f.name}{pillLock('finish', f.key)}</Pill>)}
            </div>
        </>}
        {tab === 'decal' && <>
            <Section>Livery</Section>
            <ChipGrid field="decal" items={DECALS} value={cos.decal || 'stock'} onPick={k => set('decal', k)} />
            <Section>Decal colour</Section>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {DECAL_COLORS.map(d => (
                    <button key={d.key} onClick={() => set('decalColor', d.key)} aria-label={d.key} style={{
                        width: 34, height: 34, borderRadius: '50%', background: d.color, cursor: 'pointer',
                        border: `3px solid ${(cos.decalColor || 'white') === d.key ? '#ffd84d' : 'rgba(255,255,255,0.15)'}`,
                    }} />
                ))}
            </div>
        </>}
        {tab === 'parts' && <>
            <Section>Spoiler</Section>
            <ChipGrid field="spoiler" items={SPOILERS} value={cos.spoiler || 'stock'} onPick={k => set('spoiler', k)} />
            <Section>Bonnet</Section>
            <ChipGrid field="hood" items={HOODS} value={cos.hood || 'stock'} onPick={k => set('hood', k)} />
        </>}
        {tab === 'wheels' && <>
            <Section>Rims</Section>
            <ChipGrid field="wheel" items={WHEELS.map(w => ({ ...w, color: w.rim }))} value={cos.wheel || 'stock'} onPick={k => set('wheel', k)} />
            <Section>Window tint</Section>
            <div style={{ display: 'flex', gap: 6 }}>
                {TINTS.map(t => <Pill key={t.key} active={(cos.tint || 'stock') === t.key} onClick={() => set('tint', t.key)}>{t.name}{pillLock('tint', t.key)}</Pill>)}
            </div>
        </>}
        {tab === 'glow' && <>
            <Section>Neon underglow</Section>
            <ChipGrid field="underglow" items={UNDERGLOWS.map(u => ({ ...u, color: u.color || undefined }))} value={cos.underglow || 'none'} onPick={k => set('underglow', k)} />
        </>}
        </div>
    );

    return (
        <div style={{
            position: 'fixed', inset: 0, display: 'flex', flexDirection: vp.landscape ? 'row' : 'column',
            padding: `${SAFE_TOP} ${SAFE_X} ${SAFE_BOTTOM}`, gap: 12, boxSizing: 'border-box',
        }}>
            <div style={{ flex: vp.landscape ? 1.1 : 'none', position: 'relative', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <TopButton onClick={onBack} label="Back">‹ BACK</TopButton>
                    <div className="gtitle" style={{ fontSize: '1.2rem', color: '#ffd84d', flex: 1 }}>BODY SHOP</div>
                    <CoinPill />
                </div>
                <div style={{ position: 'relative', marginTop: 6 }}>
                    <CarShowroom car={car} cos={cos} height={stageH} scale={Math.min(3.2, stageH / 80)} showName={false} framed={false} />
                    <ArrowBtn dir={-1} onClick={() => onCycle(-1)} style={{ left: 0 }} />
                    <ArrowBtn dir={1} onClick={() => onCycle(1)} style={{ right: 0 }} />
                </div>
                <div className="gtitle" style={{ textAlign: 'center', fontSize: '1.3rem', color: '#fff', marginTop: -8 }}>{car.name}</div>
                <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#8fa1b8' }}>Each car keeps its own look</div>
            </div>
            <div className="gpanel" style={{
                flex: vp.landscape ? 1 : 1, minHeight: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 12,
            }}>
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0, paddingBottom: 2 }}>
                    {CUSTOMIZE_TABS.map(t => (
                        <div key={t.key} style={{ flex: '0 0 auto', minWidth: 72, display: 'flex' }}>
                            <Pill active={tab === t.key} onClick={() => { setTab(t.key); click(); }}>{t.label}</Pill>
                        </div>
                    ))}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{items}</div>
                {preview ? (
                    <div>
                        {buyMsg && <div style={{ fontSize: '0.72rem', color: '#ff8899', textAlign: 'center', marginBottom: 6 }}>{buyMsg}</div>}
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button className="gbtn dark" onClick={() => { click(); setPreview(null); setBuyMsg(''); }} style={{ fontSize: '1rem', padding: '12px 16px' }}>✕</button>
                            <button className={`gbtn ${profile.coins >= itemPrice(preview.field, preview.key) ? 'green' : 'dark'}`} onClick={buy}
                                style={{ flex: 1, fontSize: '1rem', padding: '12px' }}>
                                BUY FOR {fmt(itemPrice(preview.field, preview.key))} <Coin size={16} />
                            </button>
                        </div>
                    </div>
                ) : (
                    <button className="gbtn yellow" onClick={() => { click(); onBack(); }} style={{ fontSize: '1rem', padding: '12px' }}>DONE</button>
                )}
            </div>
        </div>
    );
}

// One player / bot / empty place in the room
function PlayerCard({ p, room, vp }) {
    return (
        <div className="gpanel" style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', minHeight: 0, minWidth: 0, overflow: 'hidden', borderRadius: 14,
            borderColor: p.id === socket.id ? 'rgba(255,216,77,0.7)' : 'rgba(255,255,255,0.08)',
        }}>
            <SlotCar carType={p.carType} cos={p.cosmetics} h={vp.landscape ? 36 : 44} />
            <div style={{ minWidth: 0 }}>
                <div className="gtitle" style={{
                    fontSize: '0.8rem', color: p.id === socket.id ? '#ffd84d' : '#fff',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{p.name}{p.id === room.hostId ? ' 👑' : ''}<VoiceBadge p={p} /></div>
                <div style={{ fontSize: '0.64rem', color: p.connected === false ? '#facc15' : '#8fa1b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.connected === false ? 'reconnecting…' : p.id === socket.id ? 'You' : (CAR_TYPES.find(c => c.key === p.carType)?.name || '')}
                </div>
            </div>
        </div>
    );
}

const emptyCard = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '5px 8px', minHeight: 0, borderRadius: 14,
    border: '2px dashed rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.18)',
};

// Team Battle: a side with 4 places — players, bots, empty places to move into
function TeamSide({ team, room, vp, isHost }) {
    const col = team === 1 ? '#ff4d3d' : '#3d8bff';
    const humans = (room.players || []).filter(p => !p.isBot && p.teamPick === team);
    const bots = room.settings?.teamBots?.[team] || 0;
    const count = humans.length + bots;
    const mine = (room.players || []).find(p => p.id === socket.id);
    const here = mine && mine.teamPick === team;
    const roomFull = (room.players || []).filter(p => !p.isBot).length + (room.settings?.botCount || 0) >= 8;
    const join = () => { click(); socket.emit('chooseTeam', { roomId: room.id, team }); };
    const bot = (delta) => { click(); socket.emit('teamBot', { roomId: room.id, team, delta }); };
    const places = [];
    humans.forEach(p => places.push({ kind: 'human', p }));
    for (let i = 0; i < bots; i++) places.push({ kind: 'bot' });
    while (places.length < 4) places.push({ kind: 'open' });
    return (
        <div style={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 16,
            background: `linear-gradient(180deg, ${col}26, ${col}0d)`, border: `2px solid ${here ? col : `${col}55`}`,
            boxShadow: here ? `0 0 14px ${col}55` : 'none',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span className="gtitle" style={{ color: team === 1 ? '#ff8a7e' : '#8ab8ff', fontSize: '0.9rem' }}>
                    {team === 1 ? '🔴 RED' : '🔵 BLUE'} <span style={{ color: '#cfd8e3', fontSize: '0.75rem' }}>{count}/4</span>
                </span>
                {here ? <span className="gtitle" style={{ fontSize: '0.62rem', color: '#ffd84d' }}>YOUR TEAM</span>
                    : count < 4 ? <button className="gbtn green" onClick={join} style={{ fontSize: '0.68rem', padding: '4px 10px', borderRadius: 10 }}>SWITCH HERE ⇄</button>
                        : <span className="gtitle" style={{ fontSize: '0.62rem', color: '#8fa1b8' }}>FULL</span>}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: 'minmax(46px, 1fr)', gap: 6 }}>
                {places.map((pl, i) => {
                    if (pl.kind === 'human') return <PlayerCard key={pl.p.id} p={pl.p} room={room} vp={vp} />;
                    if (pl.kind === 'bot') return (
                        <div key={`b${i}`} style={{ ...emptyCard, border: `2px solid ${col}44`, background: 'rgba(0,0,0,0.3)' }}>
                            <span style={{ fontSize: '1.3rem' }}>🤖</span>
                            <span className="gtitle" style={{ fontSize: '0.7rem', color: '#8fa1b8' }}>BOT</span>
                            {isHost && <button onClick={() => bot(-1)} aria-label="Remove bot" style={{
                                marginLeft: 'auto', width: 24, height: 24, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)',
                                background: 'rgba(255,68,102,0.2)', color: '#ff8899', cursor: 'pointer', fontSize: '0.7rem',
                            }}>✕</button>}
                        </div>
                    );
                    return (
                        <div key={`o${i}`} style={{ ...emptyCard, cursor: !here ? 'pointer' : 'default' }} onClick={!here ? join : undefined}>
                            {!here && <span className="gtitle" style={{ fontSize: '0.62rem', color: '#7d8ba0' }}>TAP TO JOIN</span>}
                            {here && !isHost && <span className="gtitle" style={{ fontSize: '0.62rem', color: '#5d6b80' }}>EMPTY</span>}
                            {isHost && !roomFull && (
                                <button onClick={(e) => { e.stopPropagation(); bot(1); }} style={{
                                    padding: '3px 8px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.35)',
                                    color: '#cfd8e3', fontSize: '0.66rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
                                }}>+ 🤖 BOT</button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Room: player slots, rounds, bots, start ──────────────────────────────
function RoomScreen({ room, vp, onLeave, onShare, copied }) {
    const isHost = room.hostId === socket.id;
    const humans = (room.players || []).filter(p => !p.isBot);
    const bots = room.settings?.botCount || 0;
    const rounds = room.maxRounds || 3;
    const update = (settings) => socket.emit('updateSettings', { roomId: room.id, settings });
    const start = () => { click(); soundManager.playGo(); socket.emit('startMatch', { roomId: room.id }); };
    const [chatOpen, setChatOpenUI] = useState(false);
    // Chat and voice only once someone else has joined (nobody to talk to on your own)
    const together = humans.filter(p => p.connected !== false).length >= 2;
    useEffect(() => {
        if (together) return;
        setChatOpenUI(false);
        const t = setTimeout(leaveVoice, 15000);      // they may just have switched apps for a moment
        return () => clearTimeout(t);
    }, [together]);

    // Team Battle: two sides of 4 places
    const teamMode = room.settings?.mode === 'teams';
    const side = (t) => humans.filter(p => p.teamPick === t).length + (room.settings?.teamBots?.[t] || 0);
    const teamsOk = !teamMode || (side(1) > 0 && side(2) > 0);
    const canStart = humans.length + bots >= 2 && teamsOk;

    const slots = [];
    humans.forEach(p => slots.push({ kind: 'human', p }));
    for (let i = 0; i < Math.min(bots, 8 - humans.length); i++) slots.push({ kind: 'bot' });
    if (slots.length < 8) slots.push({ kind: 'open' });            // one "+ invite" card is enough
    const cols = vp.landscape ? 4 : 2;
    const short = vp.landscape && vp.h < 430;         // phone in landscape: squeeze the spacing

    return (
        <div style={{
            position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', gap: short ? 6 : 10,
            padding: `${SAFE_TOP} ${SAFE_X} ${SAFE_BOTTOM}`, boxSizing: 'border-box', maxWidth: 900, margin: '0 auto',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <TopButton onClick={onLeave} label="Leave room">‹ LEAVE</TopButton>
                    {together && <ChatButton onClick={() => setChatOpenUI(true)} />}
                    {together && <VoiceControls roomId={room.id} />}
                </div>
                <div style={{ textAlign: 'center' }}>
                    <div className="gtitle" style={{ fontSize: '0.6rem', color: '#8fa1b8' }}>ROOM CODE</div>
                    <div className="gtitle" style={{ fontSize: short ? '1.25rem' : '1.5rem', letterSpacing: 4, color: '#fff' }}>{room.id}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <TopButton onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Race me in Dash Arena! 🏎️💥 Room ${room.id}: ${window.location.origin}/?room=${room.id}`)}`, '_blank')}
                        color="green" label="Share on WhatsApp">WhatsApp</TopButton>
                    <TopButton onClick={onShare} color="blue" label="Invite">{copied ? '✓ COPIED' : '🔗 INVITE'}</TopButton>
                </div>
            </div>

            {teamMode ? (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: vp.landscape ? 'row' : 'column', gap: 8 }}>
                    <TeamSide team={1} room={room} vp={vp} isHost={isHost} />
                    <TeamSide team={2} room={room} vp={vp} isHost={isHost} />
                </div>
            ) : (
                <div style={{
                    flex: 1, minHeight: 0, display: 'grid', gap: 8, overflowY: 'auto',
                    gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: `minmax(${short ? 52 : 58}px, 92px)`, alignContent: 'safe center',
                }}>
                    {slots.map((s, i) => (
                        s.kind === 'human' ? <PlayerCard key={s.p.id} p={s.p} room={room} vp={vp} />
                        : s.kind === 'bot' ? (
                            <div key={`bot${i}`} style={emptyCard}>
                                <div style={{ fontSize: '1.6rem' }}>🤖</div>
                                <div className="gtitle" style={{ fontSize: '0.75rem', color: '#8fa1b8' }}>BOT</div>
                            </div>
                        ) : (
                            <div key={`open${i}`} style={{ ...emptyCard, cursor: 'pointer' }} onClick={() => { click(); onShare(); }}>
                                <div className="gtitle" style={{ fontSize: '0.7rem', color: '#5d6b80' }}>+ INVITE</div>
                            </div>
                        )
                    ))}
                </div>
            )}

            <div className="gpanel" style={{
                padding: short ? '6px 12px' : '10px 14px', display: 'flex', flexWrap: 'wrap', gap: short ? '6px 14px' : '10px 18px',
                alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="gtitle" style={{ fontSize: '0.65rem', color: '#8fa1b8' }}>ROUNDS</span>
                    {[1, 3, 5].map(n => (
                        <Pill key={n} active={rounds === n} disabled={!isHost}
                            onClick={() => { if (isHost) { update({ maxRounds: n }); click(); } }}>{n}</Pill>
                    ))}
                </div>
                {!teamMode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="gtitle" style={{ fontSize: '0.65rem', color: '#8fa1b8' }}>BOTS</span>
                        <Stepper value={bots} min={0} max={8 - humans.length} disabled={!isHost}
                            onChange={n => update({ botCount: n })} />
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="gtitle" style={{ fontSize: '0.65rem', color: '#8fa1b8' }}>MODE</span>
                    <Pill active disabled={!isHost} onClick={() => {
                        if (!isHost) return;
                        const cur = (room.settings && room.settings.mode) || 'ffa';
                        update({ mode: MODE_KEYS[(MODE_KEYS.indexOf(cur) + 1) % MODE_KEYS.length] }); click();
                    }}>{GAME_MODES[(room.settings && room.settings.mode) || 'ffa'].icon} {GAME_MODES[(room.settings && room.settings.mode) || 'ffa'].name} ▸</Pill>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="gtitle" style={{ fontSize: '0.65rem', color: '#8fa1b8' }}>ARENA</span>
                    <Pill active disabled={!isHost} onClick={() => {
                        if (!isHost) return;
                        const cur = (room.settings && room.settings.arena) || 'random';
                        update({ arena: ARENA_CHOICES[(ARENA_CHOICES.indexOf(cur) + 1) % ARENA_CHOICES.length] }); click();
                    }}>{arenaLabel((room.settings && room.settings.arena) || 'random')} ▸</Pill>
                </div>
            </div>

            {isHost ? (
                <button className="gbtn yellow" disabled={!canStart} onClick={start}
                    style={{ fontSize: vp.landscape ? '1.1rem' : '1.35rem', padding: short ? '7px' : vp.landscape ? '10px' : '16px', flexShrink: 0 }}>
                    {canStart ? '▶ START MATCH' : !teamsOk ? 'BOTH TEAMS NEED A CAR' : 'NEED 2+ PLAYERS'}
                </button>
            ) : (
                <div className="gpanel gtitle" style={{ textAlign: 'center', padding: short ? 8 : 14, color: '#ffd84d', fontSize: '0.9rem', flexShrink: 0 }}>
                    WAITING FOR HOST TO START…
                </div>
            )}
            <div style={{ textAlign: 'center', color: '#8fa1b8', fontSize: '0.72rem', marginTop: -2, display: short ? 'none' : 'block' }}>
                {canStart ? `Wreck rivals' health to zero · ${rounds} round${rounds > 1 ? 's' : ''} · most points wins`
                    : 'Invite a friend or add a bot to start'}
            </div>

            {chatOpen && together && <ChatPanel roomId={room.id} onClose={() => setChatOpenUI(false)} />}
        </div>
    );
}

// ─── Main menu ────────────────────────────────────────────────────────────
// Names: 2–16 letters / numbers (any language), spaces, _ . -
const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
const NAME_OK = (n) => cleanName(n).length >= 2;

// Full-screen "what's your name?" — shown on first launch and whenever you change it
function NameScreen({ initial, canClose, onSave, onClose }) {
    const [val, setVal] = useState(initial || '');
    const ok = NAME_OK(val);
    const submit = () => { if (ok) { click(); onSave(cleanName(val)); } };
    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 35, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(5,8,13,0.82)', padding: 16, boxSizing: 'border-box', animation: 'fadeIn 0.15s ease-out',
        }}>
            <div className="gpanel" style={{
                width: 'min(440px, 100%)', padding: '20px 22px', textAlign: 'center', position: 'relative',
                background: 'linear-gradient(180deg, #1f2a3d, #121927)',
            }}>
                {canClose && (
                    <button onClick={() => { click(); onClose(); }} aria-label="Close" style={{
                        position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#cdd6e2', cursor: 'pointer',
                    }}>✕</button>
                )}
                <div className="gtitle" style={{ fontSize: '1.45rem', color: '#ffd84d' }}>WHAT'S YOUR NAME?</div>
                <div style={{ color: '#9fb0c3', fontSize: '0.85rem', margin: '6px 0 14px' }}>
                    Other players will see it above your car and in the kill feed.
                </div>
                <input value={val} autoFocus maxLength={20} placeholder="Type your name"
                    onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
                    className="gtitle" style={{
                        width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.4)', textAlign: 'center',
                        border: `2px solid ${val && !ok ? '#ff5d73' : 'rgba(255,216,77,0.5)'}`, borderRadius: 14,
                        color: '#fff', fontSize: '1.3rem', padding: '12px 14px', outline: 'none', letterSpacing: 1,
                    }} />
                <div style={{ height: 18, marginTop: 6, fontSize: '0.75rem', color: val && !ok ? '#ff8a9a' : '#6f7f93' }}>
                    {val && !ok ? 'At least 2 letters or numbers' : `${cleanName(val).length}/16`}
                </div>
                <button className="gbtn yellow" disabled={!ok} onClick={submit}
                    style={{ width: '100%', fontSize: '1.15rem', padding: 13, marginTop: 8 }}>LET'S GO ▶</button>
            </div>
        </div>
    );
}

export default function Lobby({ room, setRoom, setPlayer, connected, connError }) {
    const vp = useViewport();
    const [name, setName] = useState(() => {
        try { return cleanName(localStorage.getItem('dasharena.name')); } catch (_) { return ''; }
    });
    // Ask for a name before anything else if we don't have one yet
    const [askName, setAskName] = useState(() => (NAME_OK(name) ? null : { then: INVITE_CODE ? 'online' : null, first: true }));
    const [carType, setCarTypeRaw] = useState(() => {
        try {
            const k = localStorage.getItem('dasharena.car');
            return CAR_TYPES.some(c => c.key === k) ? k : 'sports';
        } catch (_) { return 'sports'; }
    });
    const [garage, setGarage] = useState(loadGarage);
    const [screen, setScreen] = useState('home');
    const [sheet, setSheet] = useState(INVITE_CODE && NAME_OK(name) ? 'online' : null);
    const [rid, setRid] = useState(INVITE_CODE);
    const [botCount, setBotCount] = useState(3);
    const [botDifficulty, setBotDifficulty] = useState('medium');
    const [arena, setArena] = useState('random');
    const [gameMode, setGameMode] = useState('ffa');
    const [gfx, setGfx] = useState(gfxSetting);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [settings, setSettings] = useState(soundManager.settings);
    const [ctrlMode, setCtrlMode] = useState(() => {
        try { return localStorage.getItem('dasharena.ctrlmode') || 'joystick'; } catch (_) { return 'joystick'; }
    });

    const install = useInstall();
    const profile = useProfile();
    const [showDaily, setShowDaily] = useState(() => dailyStatus().canClaim);
    const [buyErr, setBuyErr] = useState('');
    const onInstall = async () => {
        if (install.canPrompt) await promptInstall();
        else setSheet('install');
    };

    const cosmetics = cosmeticsFor(garage, carType);
    const car = CAR_TYPES.find(c => c.key === carType) || CAR_TYPES[0];
    const carIdx = CAR_TYPES.indexOf(car);

    const saveName = (n) => {
        setName(n);
        try { localStorage.setItem('dasharena.name', n); } catch (_) { /* ignore */ }
        const then = askName && askName.then;
        setAskName(null);
        if (then) { setError(''); setSheet(then); }
    };
    // Play buttons: make sure we know who you are first
    const openPlay = (which) => {
        click(); setError('');
        if (!ownsCar(carType)) return;
        if (NAME_OK(name)) setSheet(which);
        else setAskName({ then: which });
    };

    const setCarType = (k) => {
        setCarTypeRaw(k);
        try { localStorage.setItem('dasharena.car', k); } catch (_) { /* ignore */ }
    };
    const unlockCar = () => {
        click();
        if (buyCar(carType)) { soundManager.playPowerup(); setBuyErr(''); }
        else setBuyErr(`Need ${fmt(CAR_PRICES[carType] - profile.coins)} more coins — play rounds & finish daily challenges`);
    };
    const cycleCar = (dir) => {
        setBuyErr('');
        const next = CAR_TYPES[(carIdx + dir + CAR_TYPES.length) % CAR_TYPES.length];
        setCarType(next.key);
        soundManager.playRev(next.key);
    };
    const updateCosmetics = (next) => {
        const g = { ...garage, [carType]: next };
        setGarage(g);
        saveGarage(g);
    };
    const setSetting = (k, v) => { soundManager.setSetting(k, v); setSettings({ ...soundManager.settings }); };
    const playerName = () => cleanName(name) || 'Player';

    function createRoom(mode) {
        click();
        setError('');
        if (!socket.connected) socket.connect();
        const training = mode === 'training';
        if (training) mode = 'bots';
        socket.emit('createRoom', {
            name: playerName(), botCount: mode === 'bots' ? botCount : 0, botDifficulty,
            carType: training && !ownsCar(carType) ? 'sports' : carType, cosmetics, token: getToken(),
            arena: mode === 'bots' ? arena : 'random', training, mode: mode === 'bots' ? gameMode : 'ffa',
        }, (res) => {
            if (!res || res.error) return setError(res?.error || 'Could not create a room');
            saveRoom(res.roomId);
            setRoom({ id: res.roomId });
            setPlayer(res.player);
            setSheet(null);
            if (mode === 'bots') { soundManager.playGo(); socket.emit('startMatch', { roomId: res.roomId }); }
        });
    }

    function joinRoom() {
        const code = rid.trim().toUpperCase();
        if (!code) return setError('Enter the room code your friend shared');
        click();
        setError('');
        if (!socket.connected) socket.connect();
        socket.emit('joinRoom', { roomId: code, name: playerName(), carType, cosmetics, token: getToken() }, (res) => {
            if (!res || res.error) return setError(res?.error || 'Could not join');
            saveRoom(res.roomId || code);
            setRoom({ id: res.roomId || code });
            if (res.player) setPlayer(res.player);
            setSheet(null);
        });
    }

    function leaveRoom() {
        leaveVoice();
        clearChat();
        socket.emit('leaveRoom', { roomId: room.id });
        clearRoom();
        setRoom(null);
        setScreen('home');
    }

    function shareInvite() {
        const link = `${window.location.origin}/?room=${room.id}`;
        if (navigator.share) {
            navigator.share({ title: 'Dash Arena', text: `Join my Dash Arena room ${room.id}!`, url: link }).catch(() => {});
            return;
        }
        navigator.clipboard?.writeText(link).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
    }

    // Connection status pill (the free server can take a while to wake up)
    const connPill = !connected && (
        <div style={{
            position: 'fixed', top: SAFE_TOP, left: '50%', transform: 'translateX(-50%)', zIndex: 40,
            background: 'rgba(0,0,0,0.75)', border: '1px solid #facc15', color: '#facc15', borderRadius: 20,
            padding: '6px 14px', fontSize: '0.75rem', whiteSpace: 'nowrap', maxWidth: '92vw', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
            Connecting to server…{connError ? ' (waking up, ~1 min)' : ''}
        </div>
    );

    let content;
    if (room) {
        content = <RoomScreen room={room} vp={vp} onLeave={() => { click(); leaveRoom(); }} onShare={shareInvite} copied={copied} />;
    } else if (screen === 'garage') {
        content = <GarageScreen car={car} cos={cosmetics} onChange={updateCosmetics} onBack={() => setScreen('home')} onCycle={cycleCar} vp={vp} />;
    } else {
        // Home: big car stage + play buttons
        const L = vp.landscape;
        const stageH = L ? Math.max(170, vp.h - 150) : Math.max(170, Math.min(340, vp.h - 470));
        const stage = (
            <div style={{ position: 'relative', width: '100%' }}>
                <CarShowroom car={car} cos={cosmetics} height={stageH} scale={Math.min(3.4, stageH / 78)} showName={false} framed={false} />
                <ArrowBtn dir={-1} onClick={() => { click(); cycleCar(-1); }} style={{ left: 0 }} />
                <ArrowBtn dir={1} onClick={() => { click(); cycleCar(1); }} style={{ right: 0 }} />
            </div>
        );
        const carInfo = (
            <div style={{ textAlign: 'center' }}>
                <div className="gtitle" style={{ fontSize: L ? '1.3rem' : '1.6rem', color: '#fff', textShadow: '0 3px 0 rgba(0,0,0,0.5)' }}>{car.name}</div>
                <div style={{ fontSize: '0.78rem', color: car.color, marginTop: 2 }}>
                    <span className="gtitle" style={{ fontSize: '0.66rem', letterSpacing: 1, padding: '1px 7px', borderRadius: 8, background: `${car.color}33`, marginRight: 6 }}>{car.role}</span>
                    <span style={{ fontStyle: 'italic' }}>{car.desc}</span>
                </div>
                {!ownsCar(carType) && (
                    <div className="gtitle" style={{ fontSize: '0.75rem', color: '#ffd84d', marginTop: 4 }}>🔒 LOCKED · {fmt(CAR_PRICES[carType])} <Coin size={13} /></div>
                )}
                <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginTop: 8 }}>
                    {CAR_TYPES.map((c, i) => (
                        <div key={c.key} onClick={() => { click(); setCarType(c.key); soundManager.playRev(c.key); }} style={{
                            width: i === carIdx ? 18 : 7, height: 7, borderRadius: 4, cursor: 'pointer',
                            background: i === carIdx ? '#ffd84d' : 'rgba(255,255,255,0.25)', transition: 'width 0.2s',
                        }} />
                    ))}
                </div>
            </div>
        );
        const owned = ownsCar(carType);
        const buttons = (
            <div style={{ display: 'flex', flexDirection: 'column', gap: L ? 12 : 14, width: '100%' }}>
                {!profile.tutorialDone && (
                    <button className="gbtn green" onClick={() => createRoom('training')} disabled={!connected}
                        style={{ fontSize: '0.85rem', padding: '8px', animation: 'tapPulse 1.6s ease-in-out infinite' }}>
                        🎓 NEW? 1-MIN TRAINING · +150 <Coin size={14} />
                    </button>
                )}
                {owned ? (
                    <button className="gbtn yellow" onClick={() => openPlay('online')}
                        style={{ fontSize: L ? '1.15rem' : '1.4rem', padding: L ? '12px' : '16px' }}>▶ PLAY ONLINE</button>
                ) : (
                    <div>
                        <button className={`gbtn ${profile.coins >= CAR_PRICES[carType] ? 'green' : 'dark'}`} onClick={unlockCar}
                            style={{ width: '100%', fontSize: L ? '1.1rem' : '1.3rem', padding: L ? '12px' : '16px' }}>
                            🔓 UNLOCK · {fmt(CAR_PRICES[carType])} <Coin size={18} />
                        </button>
                        {buyErr && <div style={{ fontSize: '0.7rem', color: '#ff8899', textAlign: 'center', marginTop: 4 }}>{buyErr}</div>}
                    </div>
                )}
                <div style={{ display: 'flex', gap: 12 }}>
                    <button className="gbtn blue" onClick={() => openPlay('bots')} disabled={!owned}
                        style={{ flex: 1, fontSize: '0.95rem', padding: L ? '10px 6px' : '13px 6px' }}>🤖 VS BOTS</button>
                    <button className="gbtn purple" onClick={() => { click(); setScreen('garage'); }}
                        style={{ flex: 1, fontSize: '0.95rem', padding: L ? '10px 6px' : '13px 6px' }}>🎨 GARAGE</button>
                </div>
            </div>
        );
        const settingsBtn = (
            <TopButton onClick={() => setSheet('settings')} label="Settings" style={{ width: 44, height: 40, padding: 0, fontSize: '1.1rem' }}>⚙</TopButton>
        );
        const todo = profile.challenges.list.filter(c => !c.done).length;
        const statusRow = (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <LevelBadge />
                <CoinPill />
                <TopButton onClick={() => setSheet('challenges')} label="Daily challenges" style={{ position: 'relative', height: 36, padding: '0 10px', fontSize: '0.95rem' }}>
                    🎯{todo > 0 && <span className="gtitle" style={{
                        position: 'absolute', top: -6, right: -6, background: '#ff3b5c', color: '#fff', borderRadius: 9,
                        minWidth: 18, height: 18, fontSize: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{todo}</span>}
                </TopButton>
                {!install.installed && (
                    <TopButton onClick={onInstall} color="green" label="Install app" style={{ height: 36, padding: '0 10px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>📲 GET APP</TopButton>
                )}
            </div>
        );
        const topBar = (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <button onClick={() => { click(); setAskName({ then: null }); }} aria-label="Change your name" style={{
                    display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.35)',
                    border: '2px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: '4px 14px 4px 4px', cursor: 'pointer',
                    maxWidth: L ? 150 : '55vw', minWidth: 0,
                }}>
                    <span className="gtitle" style={{
                        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'linear-gradient(180deg,#ffd84d,#f5a300)', color: '#3b2300', fontSize: '1rem',
                    }}>{playerName()[0].toUpperCase()}</span>
                    <span className="gtitle" style={{ color: '#fff', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{playerName()}</span>
                </button>
                {L && statusRow}
                {!L && <Logo size="1.35rem" />}
                {!L && settingsBtn}
            </div>
        );

        content = L ? (
            <div style={{ position: 'fixed', inset: 0, display: 'flex', gap: 16, padding: `${SAFE_TOP} ${SAFE_X} ${SAFE_BOTTOM}`, boxSizing: 'border-box' }}>
                <div style={{ flex: 1.2, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    {topBar}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        {stage}
                        {carInfo}
                    </div>
                </div>
                <div style={{ width: 'min(330px, 42vw)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <Logo size="1.7rem" />{settingsBtn}
                    </div>
                    <div className="gpanel" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'center' }}><CarStats carKey={carType} /></div>
                    {buttons}
                </div>
            </div>
        ) : (
            <div style={{
                position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', gap: 10,
                padding: `${SAFE_TOP} ${SAFE_X} ${SAFE_BOTTOM}`, boxSizing: 'border-box', maxWidth: 520, margin: '0 auto',
            }}>
                {topBar}
                <div style={{ display: 'flex', justifyContent: 'center' }}>{statusRow}</div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
                    {stage}
                    {carInfo}
                </div>
                <div className="gpanel" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'center' }}><CarStats carKey={carType} /></div>
                {buttons}
            </div>
        );
    }

    const errLine = error && (
        <div style={{ color: '#ff6680', background: 'rgba(255,68,102,0.1)', borderRadius: 10, padding: '8px 10px', fontSize: '0.85rem', marginBottom: 10, textAlign: 'center' }}>{error}</div>
    );

    return (
        <>
            <div className="menu-bg" />
            {content}
            {connPill}

            {sheet === 'online' && !room && (
                <Sheet title="Play Online" onClose={() => setSheet(null)}>
                    {errLine}
                    <button className="gbtn yellow" onClick={() => createRoom('online')} disabled={!connected}
                        style={{ width: '100%', fontSize: '1.15rem', padding: 14 }}>CREATE ROOM</button>
                    <div style={{ fontSize: '0.75rem', color: '#8fa1b8', textAlign: 'center', margin: '8px 0 4px' }}>
                        You'll get a code + link to share with friends
                    </div>
                    <Label>Or join a friend</Label>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <input value={rid} onChange={e => setRid(e.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={6}
                            onKeyDown={e => e.key === 'Enter' && joinRoom()} className="gtitle" style={{
                                flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.35)', border: '2px solid rgba(255,255,255,0.12)',
                                borderRadius: 12, color: '#fff', fontSize: '1.2rem', letterSpacing: 4, textAlign: 'center', padding: '10px',
                                outline: 'none',
                            }} />
                        <button className="gbtn green" onClick={joinRoom} disabled={!connected} style={{ fontSize: '1rem', padding: '10px 18px' }}>JOIN</button>
                    </div>
                </Sheet>
            )}

            {sheet === 'bots' && !room && (
                <Sheet title="Race vs Bots" onClose={() => setSheet(null)}>
                    {errLine}
                    <Label>Opponents</Label>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <Stepper value={botCount} min={1} max={7} onChange={setBotCount} />
                    </div>
                    <Label>Difficulty</Label>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {DIFFICULTIES.map(d => (
                            <Pill key={d.key} color={d.color} active={botDifficulty === d.key}
                                onClick={() => { setBotDifficulty(d.key); click(); }}>{d.label}</Pill>
                        ))}
                    </div>
                    <Label>Mode</Label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                        {MODE_KEYS.map(k => (
                            <Pill key={k} active={gameMode === k} onClick={() => { setGameMode(k); click(); }}>{GAME_MODES[k].icon} {GAME_MODES[k].name}</Pill>
                        ))}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#8fa1b8', textAlign: 'center', marginTop: 4 }}>{GAME_MODES[gameMode].tip}</div>
                    <Label>Arena</Label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                        {ARENA_CHOICES.map(k => (
                            <Pill key={k} active={arena === k} onClick={() => { setArena(k); click(); }}>{arenaLabel(k)}</Pill>
                        ))}
                    </div>
                    <button className="gbtn yellow" onClick={() => createRoom('bots')} disabled={!connected}
                        style={{ width: '100%', fontSize: '1.2rem', padding: 14, marginTop: 18 }}>▶ START RACE</button>
                </Sheet>
            )}

            {askName && !room && (
                <NameScreen initial={NAME_OK(name) ? name : ''} canClose={!askName.first && NAME_OK(name)}
                    onSave={saveName} onClose={() => setAskName(null)} />
            )}

            {sheet === 'challenges' && (
                <Sheet title="Daily Challenges" onClose={() => setSheet(null)}>
                    <ChallengeList />
                </Sheet>
            )}

            {showDaily && !askName && !sheet && !room && screen === 'home' && (
                <DailyRewardModal onClose={() => setShowDaily(false)} />
            )}

            {sheet === 'install' && (
                <Sheet title="Install Dash Arena" onClose={() => setSheet(null)}>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12 }}>
                        <img src="/icons/icon-192.png" alt="" style={{ width: 64, height: 64, borderRadius: 14 }} />
                        <div style={{ fontSize: '0.85rem', color: '#c8d4e3', lineHeight: 1.4 }}>
                            Play full screen from your home screen — opens instantly, no browser bars.
                        </div>
                    </div>
                    {isIOS() ? (
                        <ol style={{ margin: 0, paddingLeft: 20, color: '#fff', fontSize: '0.9rem', lineHeight: 1.8 }}>
                            <li>Open this page in <b>Safari</b></li>
                            <li>Tap the <b>Share</b> button <span style={{ fontSize: '1.1rem' }}>⎋</span> at the bottom</li>
                            <li>Choose <b>Add to Home Screen</b></li>
                        </ol>
                    ) : (
                        <ol style={{ margin: 0, paddingLeft: 20, color: '#fff', fontSize: '0.9rem', lineHeight: 1.8 }}>
                            <li>Open this page in <b>Chrome</b></li>
                            <li>Tap the <b>⋮ menu</b> (top right)</li>
                            <li>Choose <b>Install app</b> or <b>Add to Home screen</b></li>
                        </ol>
                    )}
                    <button className="gbtn yellow" onClick={() => { click(); setSheet(null); }}
                        style={{ width: '100%', fontSize: '1rem', padding: 12, marginTop: 16 }}>GOT IT</button>
                </Sheet>
            )}

            {sheet === 'settings' && (
                <Sheet title="Settings" onClose={() => setSheet(null)}>
                    <Label>Your name</Label>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <div className="gtitle" style={{
                            flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.35)', border: '2px solid rgba(255,255,255,0.12)',
                            borderRadius: 12, color: '#fff', fontSize: '1rem', padding: '10px 12px',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{playerName()}</div>
                        <button className="gbtn dark" onClick={() => { click(); setSheet(null); setAskName({ then: null }); }}
                            style={{ fontSize: '0.8rem', padding: '10px 14px' }}>CHANGE</button>
                    </div>
                    <Label>Audio</Label>
                    <Toggle label="🔊 Sound effects" on={settings.sound} onChange={v => setSetting('sound', v)} />
                    <Toggle label="🎵 Music" on={settings.music} onChange={v => setSetting('music', v)} />
                    <Toggle label="📳 Vibration" on={settings.vibration} onChange={v => setSetting('vibration', v)} />
                    <Label>Graphics</Label>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {[['auto', 'Auto'], ['high', 'High'], ['low', 'Smooth (low)']].map(([k, l]) => (
                            <Pill key={k} active={gfx === k} onClick={() => { setGfxSetting(k); setGfx(k); click(); }}>{l}</Pill>
                        ))}
                    </div>
                    <Label>Tutorial</Label>
                    <button className="gbtn dark" onClick={() => { setSheet(null); createRoom('training'); }} disabled={!connected}
                        style={{ width: '100%', fontSize: '0.85rem', padding: 10 }}>🎓 PLAY TRAINING AGAIN</button>
                    <Label>Touch controls</Label>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {[['buttons', 'Pedals'], ['joystick', 'Joystick']].map(([k, l]) => (
                            <Pill key={k} active={ctrlMode === k} onClick={() => {
                                setCtrlMode(k); click();
                                try { localStorage.setItem('dasharena.ctrlmode', k); } catch (_) { /* ignore */ }
                            }}>{l}</Pill>
                        ))}
                    </div>
                    <button className="gbtn yellow" onClick={() => { click(); setSheet(null); }}
                        style={{ width: '100%', fontSize: '1rem', padding: 12, marginTop: 18 }}>DONE</button>
                </Sheet>
            )}
        </>
    );
}
