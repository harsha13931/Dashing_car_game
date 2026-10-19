import React, { useRef, useEffect } from 'react';

const ARENA_RADIUS = 1000;

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Car shape definitions ─────────────────────────────────────────────
function drawCarBody(ctx, type, bodyColor, accentColor, dead) {
    const t = type || 'sports';
    ctx.fillStyle = bodyColor;

    switch (t) {
        case 'sports':
            // Low sleek body — pointed nose, curved rear
            ctx.beginPath();
            ctx.moveTo(18, 0);
            ctx.lineTo(14, -6); ctx.lineTo(5, -8); ctx.lineTo(-10, -8);
            ctx.lineTo(-15, -5); ctx.lineTo(-15, 5); ctx.lineTo(-10, 8);
            ctx.lineTo(5, 8); ctx.lineTo(14, 6);
            ctx.closePath(); ctx.fill();
            // Cabin
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(6, -5); ctx.lineTo(-3, -5); ctx.lineTo(-5, -3);
            ctx.lineTo(-5, 3); ctx.lineTo(-3, 5); ctx.lineTo(6, 5);
            ctx.lineTo(8, 3); ctx.lineTo(8, -3);
            ctx.closePath(); ctx.fill();
            // Windshield
            if (!dead) {
                ctx.fillStyle = 'rgba(150, 220, 255, 0.35)';
                ctx.beginPath();
                ctx.moveTo(8, -3); ctx.lineTo(6, -5); ctx.lineTo(6, 5); ctx.lineTo(8, 3);
                ctx.closePath(); ctx.fill();
            }
            // Spoiler hint
            ctx.fillStyle = accentColor;
            ctx.fillRect(-14, -7, 2, 14);
            break;

        case 'muscle':
            // Wide boxy muscle car — big hood, square rear
            ctx.beginPath();
            ctx.moveTo(16, -1); ctx.lineTo(16, 1);
            ctx.lineTo(12, -8); ctx.lineTo(-12, -9); ctx.lineTo(-16, -7);
            ctx.lineTo(-16, 7); ctx.lineTo(-12, 9); ctx.lineTo(12, 8);
            ctx.lineTo(16, 1); ctx.lineTo(16, -1);
            ctx.closePath(); ctx.fill();
            // Hood scoop
            ctx.fillStyle = accentColor;
            ctx.fillRect(6, -3, 6, 6);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(7, -2, 4, 4);
            // Cabin
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(4, -6); ctx.lineTo(-5, -6); ctx.lineTo(-7, -4);
            ctx.lineTo(-7, 4); ctx.lineTo(-5, 6); ctx.lineTo(4, 6);
            ctx.lineTo(6, 4); ctx.lineTo(6, -4);
            ctx.closePath(); ctx.fill();
            if (!dead) {
                ctx.fillStyle = 'rgba(150, 220, 255, 0.3)';
                ctx.beginPath();
                ctx.moveTo(6, -4); ctx.lineTo(4, -6); ctx.lineTo(4, 6); ctx.lineTo(6, 4);
                ctx.closePath(); ctx.fill();
            }
            break;

        case 'truck':
            // Big boxy truck — flat front, wide body
            ctx.beginPath();
            ctx.moveTo(14, -10); ctx.lineTo(16, -8); ctx.lineTo(16, 8); ctx.lineTo(14, 10);
            ctx.lineTo(-16, 10); ctx.lineTo(-18, 8); ctx.lineTo(-18, -8); ctx.lineTo(-16, -10);
            ctx.closePath(); ctx.fill();
            // Front bumper
            ctx.fillStyle = '#222';
            ctx.fillRect(14, -9, 4, 18);
            // Cabin (elevated)
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(10, -7); ctx.lineTo(2, -7); ctx.lineTo(0, -5);
            ctx.lineTo(0, 5); ctx.lineTo(2, 7); ctx.lineTo(10, 7);
            ctx.lineTo(12, 5); ctx.lineTo(12, -5);
            ctx.closePath(); ctx.fill();
            // Bed / cargo area
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fillRect(-16, -8, 14, 16);
            // Bed rails
            ctx.strokeStyle = bodyColor;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-15, -8, 13, 16);
            if (!dead) {
                ctx.fillStyle = 'rgba(150, 220, 255, 0.25)';
                ctx.fillRect(11, -5, 2, 10);
            }
            break;

        case 'rally':
            // Compact hatchback — rounded, rally stripes
            ctx.beginPath();
            ctx.moveTo(14, 0);
            ctx.quadraticCurveTo(14, -7, 8, -8);
            ctx.lineTo(-8, -8);
            ctx.quadraticCurveTo(-14, -8, -14, -4);
            ctx.lineTo(-14, 4);
            ctx.quadraticCurveTo(-14, 8, -8, 8);
            ctx.lineTo(8, 8);
            ctx.quadraticCurveTo(14, 7, 14, 0);
            ctx.closePath(); ctx.fill();
            // Rally stripe
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fillRect(-12, -2, 24, 4);
            // Cabin
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(4, -5); ctx.lineTo(-4, -5.5); ctx.lineTo(-6, -4);
            ctx.lineTo(-6, 4); ctx.lineTo(-4, 5.5); ctx.lineTo(4, 5);
            ctx.lineTo(6, 3); ctx.lineTo(6, -3);
            ctx.closePath(); ctx.fill();
            if (!dead) {
                ctx.fillStyle = 'rgba(150, 220, 255, 0.3)';
                ctx.beginPath();
                ctx.moveTo(6, -3); ctx.lineTo(4, -5); ctx.lineTo(4, 5); ctx.lineTo(6, 3);
                ctx.closePath(); ctx.fill();
            }
            // Rally light pods
            if (!dead) {
                ctx.fillStyle = '#ffffcc';
                ctx.beginPath(); ctx.arc(13, -3, 1.5, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(13, 3, 1.5, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(13, 0, 1.5, 0, Math.PI * 2); ctx.fill();
            }
            break;

        case 'kart':
            // Tiny open-wheel kart — small, exposed wheels
            ctx.beginPath();
            ctx.moveTo(12, 0);
            ctx.lineTo(10, -4); ctx.lineTo(3, -5); ctx.lineTo(-8, -5);
            ctx.lineTo(-10, -3); ctx.lineTo(-10, 3); ctx.lineTo(-8, 5);
            ctx.lineTo(3, 5); ctx.lineTo(10, 4);
            ctx.closePath(); ctx.fill();
            // Seat
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.arc(-2, 0, 4, 0, Math.PI * 2); ctx.fill();
            // Steering column
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(7, 0); ctx.stroke();
            // Helmet
            if (!dead) {
                ctx.fillStyle = bodyColor;
                ctx.beginPath(); ctx.arc(-2, 0, 3, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = 'rgba(150, 220, 255, 0.5)';
                ctx.beginPath(); ctx.arc(-1, 0, 2, -0.5, 0.5); ctx.fill();
            }
            // Roll bar
            ctx.strokeStyle = '#666';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-5, -4); ctx.lineTo(-5, 4);
            ctx.stroke();
            break;

        case 'suv':
            // Tall boxy SUV
            ctx.beginPath();
            ctx.moveTo(14, -9); ctx.lineTo(15, -7); ctx.lineTo(15, 7); ctx.lineTo(14, 9);
            ctx.lineTo(-14, 9); ctx.lineTo(-15, 7); ctx.lineTo(-15, -7); ctx.lineTo(-14, -9);
            ctx.closePath(); ctx.fill();
            // Roof rack
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            ctx.strokeRect(-10, -8, 16, 16);
            ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(-6, 8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(2, -8); ctx.lineTo(2, 8); ctx.stroke();
            // Cabin
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(8, -6); ctx.lineTo(-2, -6.5); ctx.lineTo(-4, -5);
            ctx.lineTo(-4, 5); ctx.lineTo(-2, 6.5); ctx.lineTo(8, 6);
            ctx.lineTo(10, 4); ctx.lineTo(10, -4);
            ctx.closePath(); ctx.fill();
            if (!dead) {
                ctx.fillStyle = 'rgba(150, 220, 255, 0.3)';
                ctx.fillRect(9, -4, 2, 8);
            }
            // Bull bar
            ctx.strokeStyle = '#888';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(15, -6); ctx.lineTo(17, -5); ctx.lineTo(17, 5); ctx.lineTo(15, 6); ctx.stroke();
            break;

        case 'drift':
            // Low drift car — wide fenders, wing
            ctx.beginPath();
            ctx.moveTo(16, 0);
            ctx.lineTo(13, -7); ctx.lineTo(6, -9); ctx.lineTo(-6, -9);
            ctx.lineTo(-12, -8); ctx.lineTo(-14, -5); ctx.lineTo(-14, 5);
            ctx.lineTo(-12, 8); ctx.lineTo(-6, 9); ctx.lineTo(6, 9);
            ctx.lineTo(13, 7);
            ctx.closePath(); ctx.fill();
            // Wide fender flares
            ctx.fillStyle = bodyColor;
            ctx.beginPath(); ctx.ellipse(4, -9, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(4, 9, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(-8, -9, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(-8, 9, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
            // Cabin
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(5, -5); ctx.lineTo(-3, -5); ctx.lineTo(-5, -3);
            ctx.lineTo(-5, 3); ctx.lineTo(-3, 5); ctx.lineTo(5, 5);
            ctx.lineTo(7, 3); ctx.lineTo(7, -3);
            ctx.closePath(); ctx.fill();
            if (!dead) {
                ctx.fillStyle = 'rgba(150, 220, 255, 0.3)';
                ctx.beginPath();
                ctx.moveTo(7, -3); ctx.lineTo(5, -5); ctx.lineTo(5, 5); ctx.lineTo(7, 3);
                ctx.closePath(); ctx.fill();
            }
            // Big rear wing
            ctx.fillStyle = accentColor;
            ctx.fillRect(-16, -10, 2, 20);
            ctx.fillRect(-17, -10, 4, 2);
            ctx.fillRect(-17, 8, 4, 2);
            break;

        case 'supercar':
            // Ultra-sleek supercar — very pointed, thin
            ctx.beginPath();
            ctx.moveTo(20, 0);
            ctx.lineTo(15, -5); ctx.lineTo(6, -7); ctx.lineTo(-6, -7);
            ctx.lineTo(-14, -5); ctx.lineTo(-16, -3); ctx.lineTo(-16, 3);
            ctx.lineTo(-14, 5); ctx.lineTo(-6, 7); ctx.lineTo(6, 7);
            ctx.lineTo(15, 5);
            ctx.closePath(); ctx.fill();
            // Aero line
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-14, 0); ctx.stroke();
            // Cabin (teardrop)
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(7, -3.5); ctx.lineTo(-1, -4); ctx.lineTo(-4, -3);
            ctx.lineTo(-4, 3); ctx.lineTo(-1, 4); ctx.lineTo(7, 3.5);
            ctx.lineTo(9, 2); ctx.lineTo(9, -2);
            ctx.closePath(); ctx.fill();
            if (!dead) {
                ctx.fillStyle = 'rgba(150, 220, 255, 0.35)';
                ctx.beginPath();
                ctx.moveTo(9, -2); ctx.lineTo(7, -3.5); ctx.lineTo(7, 3.5); ctx.lineTo(9, 2);
                ctx.closePath(); ctx.fill();
            }
            // Rear diffuser vents
            ctx.fillStyle = '#111';
            for (let i = -4; i <= 4; i += 2) {
                ctx.fillRect(-16, i - 0.5, 3, 1);
            }
            break;

        default:
            // Fallback generic car
            ctx.beginPath();
            ctx.moveTo(15, 0); ctx.lineTo(12, -6); ctx.lineTo(4, -9);
            ctx.lineTo(-8, -9); ctx.lineTo(-14, -6); ctx.lineTo(-14, 6);
            ctx.lineTo(-8, 9); ctx.lineTo(4, 9); ctx.lineTo(12, 6);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(5, -5); ctx.lineTo(-4, -5); ctx.lineTo(-6, -4);
            ctx.lineTo(-6, 4); ctx.lineTo(-4, 5); ctx.lineTo(5, 5);
            ctx.lineTo(7, 4); ctx.lineTo(7, -4);
            ctx.closePath(); ctx.fill();
            break;
    }
}

function drawWheels(ctx, type) {
    const t = type || 'sports';
    ctx.shadowBlur = 0;

    // Wheel positions vary per car type
    let wheels;
    switch (t) {
        case 'truck':
            wheels = [
                { x: 10, y: -11, w: 5, h: 4 }, { x: 10, y: 7, w: 5, h: 4 },
                { x: -12, y: -11, w: 5, h: 4 }, { x: -12, y: 7, w: 5, h: 4 },
            ];
            break;
        case 'muscle':
            wheels = [
                { x: 8, y: -10, w: 5, h: 3 }, { x: 8, y: 7, w: 5, h: 3 },
                { x: -10, y: -10, w: 6, h: 3.5 }, { x: -10, y: 6.5, w: 6, h: 3.5 },
            ];
            break;
        case 'kart':
            wheels = [
                { x: 7, y: -7, w: 4, h: 2.5 }, { x: 7, y: 4.5, w: 4, h: 2.5 },
                { x: -7, y: -7, w: 4, h: 2.5 }, { x: -7, y: 4.5, w: 4, h: 2.5 },
            ];
            break;
        case 'suv':
            wheels = [
                { x: 8, y: -10, w: 5, h: 4 }, { x: 8, y: 6, w: 5, h: 4 },
                { x: -10, y: -10, w: 5, h: 4 }, { x: -10, y: 6, w: 5, h: 4 },
            ];
            break;
        case 'drift':
            wheels = [
                { x: 7, y: -11, w: 5, h: 3 }, { x: 7, y: 8, w: 5, h: 3 },
                { x: -9, y: -11, w: 5, h: 3 }, { x: -9, y: 8, w: 5, h: 3 },
            ];
            break;
        case 'supercar':
            wheels = [
                { x: 9, y: -8, w: 4, h: 2.5 }, { x: 9, y: 5.5, w: 4, h: 2.5 },
                { x: -10, y: -8, w: 5, h: 3 }, { x: -10, y: 5, w: 5, h: 3 },
            ];
            break;
        default: // sports, rally
            wheels = [
                { x: 7, y: -10, w: 5, h: 3 }, { x: 7, y: 7, w: 5, h: 3 },
                { x: -10, y: -10, w: 5, h: 3 }, { x: -10, y: 7, w: 5, h: 3 },
            ];
    }

    for (const w of wheels) {
        ctx.fillStyle = '#111';
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = '#333';
        ctx.fillRect(w.x + 1, w.y + 0.5, w.w - 2, w.h - 1);
    }
}

function drawHeadlights(ctx, type) {
    const t = type || 'sports';
    ctx.save();

    // Beam shape varies
    let noseX = 14, spread = 5;
    switch (t) {
        case 'truck':  noseX = 16; spread = 7; break;
        case 'muscle': noseX = 15; spread = 6; break;
        case 'suv':    noseX = 15; spread = 6; break;
        case 'kart':   noseX = 11; spread = 3; break;
        case 'supercar': noseX = 18; spread = 4; break;
        case 'drift':  noseX = 15; spread = 5; break;
    }

    // Beams
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#ffffcc';
    ctx.beginPath();
    ctx.moveTo(noseX, -spread); ctx.lineTo(55, -18); ctx.lineTo(55, 0); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(noseX, spread); ctx.lineTo(55, 0); ctx.lineTo(55, 18); ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Dots
    ctx.shadowBlur = 5;
    ctx.shadowColor = '#ffffaa';
    ctx.fillStyle = '#ffffdd';
    ctx.beginPath(); ctx.arc(noseX - 1, -(spread - 1), 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(noseX - 1, spread - 1, 2, 0, Math.PI * 2); ctx.fill();

    // Tail lights
    const tailX = t === 'truck' ? -17 : (t === 'supercar' ? -15 : -13);
    const tailSpread = t === 'truck' ? 7 : (t === 'suv' ? 6 : 5);
    ctx.shadowColor = '#ff0000';
    ctx.fillStyle = '#ff2222';
    ctx.beginPath(); ctx.arc(tailX, -tailSpread, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(tailX, tailSpread, 1.5, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
}

// ─── Particle system ────────────────────────────────────────────────────
class ParticlePool {
    constructor(max = 400) { this.particles = []; this.max = max; }

    emit(x, y, count, color, speed = 3, life = 30, size = 3) {
        for (let i = 0; i < count && this.particles.length < this.max; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = Math.random() * speed + 0.5;
            this.particles.push({
                x, y,
                vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                life, maxLife: life, color,
                size: size * (0.5 + Math.random() * 0.5)
            });
        }
    }

    emitDirectional(x, y, count, angle, spread, color, speed, life, size = 3) {
        for (let i = 0; i < count && this.particles.length < this.max; i++) {
            const a = angle + (Math.random() - 0.5) * spread;
            const v = Math.random() * speed + speed * 0.3;
            this.particles.push({
                x, y,
                vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                life, maxLife: life, color,
                size: size * (0.5 + Math.random() * 0.5)
            });
        }
    }

    update() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx; p.y += p.vy;
            p.vx *= 0.95; p.vy *= 0.95;
            p.life--;
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    draw(ctx) {
        for (const p of this.particles) {
            const alpha = (p.life / p.maxLife);
            const r = p.size * alpha;
            if (r < 0.3) continue;
            ctx.save();
            ctx.globalAlpha = alpha * 0.8;
            ctx.fillStyle = p.color;
            ctx.shadowBlur = r * 2;
            ctx.shadowColor = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
}

// ─── Tire mark trail ────────────────────────────────────────────────────
class TireTrailPool {
    constructor(max = 600) { this.marks = []; this.max = max; }

    add(x, y, angle, width = 4) {
        if (this.marks.length >= this.max) this.marks.shift();
        this.marks.push({ x, y, angle, width, life: 80, maxLife: 80 });
    }

    update() {
        for (let i = this.marks.length - 1; i >= 0; i--) {
            this.marks[i].life--;
            if (this.marks[i].life <= 0) this.marks.splice(i, 1);
        }
    }

    draw(ctx) {
        for (const m of this.marks) {
            const alpha = (m.life / m.maxLife) * 0.15;
            if (alpha < 0.01) continue;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(m.x, m.y);
            ctx.rotate(m.angle);
            ctx.fillStyle = '#333';
            ctx.fillRect(-m.width * 0.5, -7, m.width, 3);
            ctx.fillRect(-m.width * 0.5, 4, m.width, 3);
            ctx.restore();
        }
    }
}

// ─── Screen shake ───────────────────────────────────────────────────────
class ScreenShake {
    constructor() { this.intensity = 0; this.decay = 0.92; this.x = 0; this.y = 0; }
    trigger(force) { this.intensity = Math.min(20, this.intensity + force); }
    update() {
        if (this.intensity < 0.5) { this.x = this.y = 0; this.intensity = 0; return; }
        this.x = (Math.random() - 0.5) * this.intensity * 2;
        this.y = (Math.random() - 0.5) * this.intensity * 2;
        this.intensity *= this.decay;
    }
}

// ─── Color palette ──────────────────────────────────────────────────────
const PLAYER_COLORS = [
    { body: '#00d4ff', glow: 'rgba(0, 212, 255, 0.6)', accent: '#0099cc' },  // cyan (local)
    { body: '#ff2255', glow: 'rgba(255, 34, 85, 0.6)', accent: '#cc1144' },  // red
    { body: '#ffaa00', glow: 'rgba(255, 170, 0, 0.6)', accent: '#cc8800' },  // orange
    { body: '#44ff44', glow: 'rgba(68, 255, 68, 0.6)', accent: '#22cc22' },   // green
    { body: '#ff44ff', glow: 'rgba(255, 68, 255, 0.6)', accent: '#cc22cc' }, // magenta
    { body: '#ffff44', glow: 'rgba(255, 255, 68, 0.6)', accent: '#cccc22' }, // yellow
    { body: '#44ffff', glow: 'rgba(68, 255, 255, 0.6)', accent: '#22cccc' }, // teal
    { body: '#ff8844', glow: 'rgba(255, 136, 68, 0.6)', accent: '#cc6622' }, // coral
];

export default function CanvasRenderer({ snapshot, localId }) {
    const cvsRef = useRef();
    const prevRef = useRef({ players: [], powerups: [], time: Date.now() });
    const cameraRef = useRef({ x: 0, y: 0 });
    const particlesRef = useRef(new ParticlePool());
    const tireTrailsRef = useRef(new TireTrailPool());
    const shakeRef = useRef(new ScreenShake());
    const prevAliveRef = useRef(new Set());
    const colorMapRef = useRef(new Map()); // playerId -> color index
    const frameRef = useRef(0);

    function getPlayerColor(playerId) {
        if (!colorMapRef.current.has(playerId)) {
            if (playerId === localId) {
                colorMapRef.current.set(playerId, 0);
            } else {
                const used = new Set(colorMapRef.current.values());
                let idx = 1;
                while (used.has(idx) && idx < PLAYER_COLORS.length) idx++;
                colorMapRef.current.set(playerId, idx % PLAYER_COLORS.length);
            }
        }
        return PLAYER_COLORS[colorMapRef.current.get(playerId)] || PLAYER_COLORS[1];
    }

    useEffect(() => {
        const cvs = cvsRef.current;
        const ctx = cvs.getContext('2d');
        let raf;

        function resize() {
            const DPR = window.devicePixelRatio || 1;
            cvs.width = window.innerWidth * DPR;
            cvs.height = window.innerHeight * DPR;
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        }
        window.addEventListener('resize', resize);
        resize();

        function draw() {
            frameRef.current++;
            const frame = frameRef.current;
            ctx.clearRect(0, 0, cvs.width, cvs.height);

            const prev = prevRef.current;
            const now = Date.now();
            const elapsed = Math.min(200, now - prev.time);
            const t = clamp(elapsed / Math.max(1, (snapshot.timestamp - prev.time || 50)), 0, 1);

            const arenaR = snapshot.arenaRadius || ARENA_RADIUS;
            const dangerZone = snapshot.dangerZone || arenaR * 0.85;

            // Interpolate players
            const players = (snapshot.players || []).map(sp => {
                const pr = prev.players.find(pp => pp.id === sp.id) || sp;
                let ang = sp.angle;
                if (Math.abs(ang - pr.angle) > Math.PI) {
                    ang += (ang > pr.angle ? -1 : 1) * Math.PI * 2;
                }
                return {
                    ...sp,
                    ix: lerp(pr.x, sp.x, t),
                    iy: lerp(pr.y, sp.y, t),
                    ia: lerp(pr.angle, ang, t),
                    iscale: lerp(pr.scale || 1, sp.scale || 1, t)
                };
            });

            // Camera
            let target = players.find(p => p.id === localId);
            let spectating = false;

            if (!target || !target.alive) {
                const alivePlayer = players.find(p => p.alive);
                if (alivePlayer) { target = alivePlayer; spectating = true; }
                else if (players.length > 0) { target = players[0]; spectating = true; }
            }

            const tx = target ? target.ix : 0;
            const ty = target ? target.iy : 0;
            cameraRef.current.x = lerp(cameraRef.current.x, tx, 0.08);
            cameraRef.current.y = lerp(cameraRef.current.y, ty, 0.08);

            // Screen shake
            const shake = shakeRef.current;
            shake.update();

            const camX = cameraRef.current.x + shake.x;
            const camY = cameraRef.current.y + shake.y;

            ctx.save();
            ctx.translate(window.innerWidth / 2, window.innerHeight / 2);
            ctx.translate(-camX, -camY);

            // ─── Infinite grid ──────────────────────────────────────────
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 180, 255, 0.025)';
            ctx.lineWidth = 1;
            const gridSize = 100;
            const sx = Math.floor((camX - window.innerWidth / 2) / gridSize) * gridSize;
            const sy = Math.floor((camY - window.innerHeight / 2) / gridSize) * gridSize;
            const ex = sx + window.innerWidth + gridSize * 2;
            const ey = sy + window.innerHeight + gridSize * 2;
            ctx.beginPath();
            for (let x = sx; x < ex; x += gridSize) { ctx.moveTo(x, sy); ctx.lineTo(x, ey); }
            for (let y = sy; y < ey; y += gridSize) { ctx.moveTo(sx, y); ctx.lineTo(ex, y); }
            ctx.stroke();
            ctx.restore();

            // ─── Arena ──────────────────────────────────────────────────
            // Arena fill
            ctx.save();
            const arenaGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, arenaR);
            arenaGrad.addColorStop(0, '#0d1525');
            arenaGrad.addColorStop(0.7, '#0a1020');
            arenaGrad.addColorStop(0.85, '#1a0a0a');
            arenaGrad.addColorStop(1, '#2a0505');
            ctx.beginPath();
            ctx.arc(0, 0, arenaR, 0, Math.PI * 2);
            ctx.fillStyle = arenaGrad;
            ctx.fill();
            ctx.restore();

            // Danger zone ring (pulsing)
            ctx.save();
            const dangerPulse = 0.5 + Math.sin(now / 400) * 0.3;
            ctx.beginPath();
            ctx.arc(0, 0, dangerZone, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 40, 40, ${dangerPulse * 0.15})`;
            ctx.lineWidth = arenaR - dangerZone;
            ctx.stroke();

            // Danger zone dashed ring
            ctx.setLineDash([20, 20]);
            ctx.beginPath();
            ctx.arc(0, 0, dangerZone, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 50, 50, ${dangerPulse * 0.4})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            // Arena border
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, arenaR, 0, Math.PI * 2);
            ctx.lineWidth = 4;
            const borderPulse = 0.6 + Math.sin(now / 600) * 0.2;
            ctx.strokeStyle = `rgba(0, 200, 255, ${borderPulse})`;
            ctx.shadowBlur = 25;
            ctx.shadowColor = '#00c8ff';
            ctx.stroke();
            ctx.restore();

            // Inner grid
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, arenaR, 0, Math.PI * 2);
            ctx.clip();
            ctx.strokeStyle = 'rgba(0, 180, 255, 0.05)';
            ctx.lineWidth = 1;
            for (let i = -arenaR; i <= arenaR; i += 100) {
                ctx.beginPath(); ctx.moveTo(i, -arenaR); ctx.lineTo(i, arenaR); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-arenaR, i); ctx.lineTo(arenaR, i); ctx.stroke();
            }
            // Center cross
            ctx.strokeStyle = 'rgba(0, 200, 255, 0.12)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-50, 0); ctx.lineTo(50, 0); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(0, 50); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();

            // ─── Tire trails ────────────────────────────────────────────
            const tireTrails = tireTrailsRef.current;
            tireTrails.update();
            tireTrails.draw(ctx);

            // ─── Powerups ───────────────────────────────────────────────
            (snapshot.powerups || []).forEach(p => {
                ctx.save();
                ctx.translate(p.x, p.y);
                const pulse = 1 + Math.sin(now / 200 + p.x) * 0.15;
                ctx.scale(pulse, pulse);

                let color = 'gold', label = '?', glowColor = 'gold';
                if (p.type === 'SpeedBoost')  { color = '#00ff88'; label = '⚡'; glowColor = '#00ff88'; }
                if (p.type === 'Shield')      { color = '#00ccff'; label = '🛡️'; glowColor = '#00ccff'; }
                if (p.type === 'MegaPush')    { color = '#ff3366'; label = '💪'; glowColor = '#ff3366'; }
                if (p.type === 'Oil')         { color = '#666'; label = '🛢️'; glowColor = '#666'; }
                if (p.type === 'Reverse')     { color = '#bb44ff'; label = '🔄'; glowColor = '#bb44ff'; }
                if (p.type === 'Magnet')      { color = '#ffaa00'; label = '🧲'; glowColor = '#ffaa00'; }

                // Outer glow ring
                ctx.shadowBlur = 20;
                ctx.shadowColor = glowColor;
                ctx.strokeStyle = glowColor;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, 18, 0, Math.PI * 2);
                ctx.stroke();

                // Inner circle
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(0, 0, 12, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.7;
                ctx.fill();
                ctx.globalAlpha = 1;

                // Label
                ctx.shadowBlur = 0;
                ctx.fillStyle = 'white';
                ctx.font = 'bold 14px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, 0, 0);
                ctx.restore();
            });

            // ─── Projectiles ────────────────────────────────────────────
            (snapshot.projectiles || []).forEach(proj => {
                ctx.save();
                ctx.translate(proj.x, proj.y);

                // Trail
                const projAngle = Math.atan2(proj.vy, proj.vx);
                ctx.save();
                ctx.rotate(projAngle);
                ctx.fillStyle = 'rgba(255, 120, 0, 0.3)';
                ctx.beginPath();
                ctx.moveTo(0, -4); ctx.lineTo(-25, 0); ctx.lineTo(0, 4);
                ctx.fill();
                ctx.restore();

                // Glow
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#ff6600';

                // Core
                ctx.beginPath();
                ctx.arc(0, 0, 6, 0, Math.PI * 2);
                ctx.fillStyle = '#ffcc00';
                ctx.fill();

                ctx.beginPath();
                ctx.arc(0, 0, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();

                ctx.restore();
            });

            // ─── Players (cars) ─────────────────────────────────────────
            players.forEach(p => {
                ctx.save();
                ctx.translate(p.ix, p.iy);
                ctx.rotate(p.ia);

                const scale = p.iscale || 1;
                ctx.scale(scale, scale);

                const isMe = p.id === localId;
                const col = getPlayerColor(p.id);
                const dead = !p.alive;

                // Tire marks when dashing or slipping
                if (p.alive && (p.isDashing || p.slip > 0)) {
                    tireTrails.add(p.ix, p.iy, p.ia, p.isDashing ? 6 : 4);
                }

                // ─── Shield bubble ──────────────────────────────────────
                if (p.shield) {
                    ctx.save();
                    const shieldPulse = 0.6 + Math.sin(now / 150) * 0.2;
                    ctx.globalAlpha = shieldPulse;
                    ctx.beginPath();
                    ctx.arc(0, 0, 28, 0, Math.PI * 2);
                    ctx.strokeStyle = '#00ddff';
                    ctx.lineWidth = 2.5;
                    ctx.shadowBlur = 15;
                    ctx.shadowColor = '#00ddff';
                    ctx.stroke();

                    // Hex pattern on shield
                    for (let i = 0; i < 6; i++) {
                        const a = (i / 6) * Math.PI * 2 + now / 1000;
                        ctx.beginPath();
                        ctx.arc(Math.cos(a) * 20, Math.sin(a) * 20, 4, 0, Math.PI * 2);
                        ctx.strokeStyle = 'rgba(0, 220, 255, 0.3)';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                    ctx.restore();
                }

                // ─── Exhaust / trail ────────────────────────────────────
                if (p.alive) {
                    ctx.save();
                    ctx.globalCompositeOperation = 'screen';

                    if (p.isDashing) {
                        // Boost flame
                        ctx.shadowBlur = 25;
                        ctx.shadowColor = '#ffaa00';
                        const flameLen = 35 + Math.random() * 20;
                        ctx.fillStyle = 'rgba(255, 170, 0, 0.7)';
                        ctx.beginPath();
                        ctx.moveTo(-14, -5); ctx.lineTo(-flameLen, 0); ctx.lineTo(-14, 5);
                        ctx.fill();
                        ctx.fillStyle = 'rgba(255, 255, 200, 0.5)';
                        ctx.beginPath();
                        ctx.moveTo(-14, -3); ctx.lineTo(-flameLen * 0.6, 0); ctx.lineTo(-14, 3);
                        ctx.fill();
                    } else if (p.speedMult > 1) {
                        // Speed boost trail
                        ctx.shadowBlur = 15;
                        ctx.shadowColor = '#00ff88';
                        ctx.fillStyle = 'rgba(0, 255, 136, 0.4)';
                        ctx.beginPath();
                        ctx.moveTo(-14, -3); ctx.lineTo(-25 - Math.random() * 8, 0); ctx.lineTo(-14, 3);
                        ctx.fill();
                    } else {
                        // Normal exhaust
                        ctx.shadowBlur = 8;
                        ctx.shadowColor = col.body;
                        ctx.fillStyle = col.glow;
                        ctx.globalAlpha = 0.4;
                        ctx.beginPath();
                        ctx.moveTo(-14, -3); ctx.lineTo(-20 - Math.random() * 5, 0); ctx.lineTo(-14, 3);
                        ctx.fill();
                    }
                    ctx.restore();
                }

                // ─── Car body ───────────────────────────────────────────
                const bodyColor = dead ? '#333' : col.body;
                const accentColor = dead ? '#222' : col.accent;
                const glowCol = dead ? 'transparent' : col.glow;
                const carType = p.carType || 'sports';

                // Body gradient for depth
                ctx.shadowBlur = dead ? 0 : 6;
                ctx.shadowColor = glowCol;

                // Wheels go behind the body
                drawWheels(ctx, carType);

                // Draw the unique car body shape
                drawCarBody(ctx, carType, bodyColor, accentColor, dead);

                // Headlights + tail lights
                if (!dead) drawHeadlights(ctx, carType);

                // ─── Speed lines when fast ──────────────────────────────
                if (p.alive && p.speedMult > 1) {
                    ctx.save();
                    ctx.globalAlpha = 0.2;
                    ctx.strokeStyle = '#00ff88';
                    ctx.lineWidth = 1;
                    for (let i = 0; i < 3; i++) {
                        const y = -8 + i * 8;
                        ctx.beginPath();
                        ctx.moveTo(-20 - Math.random() * 10, y);
                        ctx.lineTo(-35 - Math.random() * 15, y);
                        ctx.stroke();
                    }
                    ctx.restore();
                }

                // ─── Name tag ───────────────────────────────────────────
                ctx.save();
                ctx.scale(1 / scale, 1 / scale);
                ctx.rotate(-p.ia);

                // Bot indicator
                const label = isMe ? '★ YOU' : (p.name || p.id.slice(0, 4));
                const tagY = -28 * scale;

                // Background pill
                ctx.fillStyle = isMe ? 'rgba(0, 180, 255, 0.25)' : (p.isBot ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.15)');
                const textWidth = ctx.measureText?.(label)?.width || label.length * 7;
                const pillW = textWidth + 12;
                ctx.beginPath();
                ctx.roundRect?.(-pillW / 2, tagY - 8, pillW, 16, 8) ||
                    ctx.rect(-pillW / 2, tagY - 8, pillW, 16);
                ctx.fill();

                ctx.fillStyle = isMe ? '#00ddff' : (dead ? '#555' : '#ddd');
                ctx.font = `bold 11px 'Inter', system-ui, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, 0, tagY);

                if (p.isBot && !isMe) {
                    ctx.fillStyle = '#888';
                    ctx.font = '8px Inter, sans-serif';
                    ctx.fillText('BOT', 0, tagY + 13);
                }
                ctx.restore();

                ctx.restore(); // end player transform
            });

            // ─── Particles ──────────────────────────────────────────────
            const particles = particlesRef.current;

            // Dash particles
            players.forEach(p => {
                if (p.alive && p.isDashing) {
                    particles.emitDirectional(
                        p.ix - Math.cos(p.ia) * 15, p.iy - Math.sin(p.ia) * 15,
                        3, p.ia + Math.PI, 0.8, '#ffaa00', 5, 20, 3
                    );
                }
                // Speed boost particles
                if (p.alive && p.speedMult > 1 && frame % 3 === 0) {
                    particles.emit(
                        p.ix - Math.cos(p.ia) * 12, p.iy - Math.sin(p.ia) * 12,
                        1, '#00ff88', 2, 15, 2
                    );
                }
                // Magnet visual
                if (p.alive && p.magnetTimer > 0 && frame % 2 === 0) {
                    particles.emit(p.ix, p.iy, 1, '#ffaa00', 1, 10, 1);
                }
            });

            // Death explosion
            const currentAlive = new Set(players.filter(p => p.alive).map(p => p.id));
            for (const id of prevAliveRef.current) {
                if (!currentAlive.has(id)) {
                    const dead = players.find(p => p.id === id);
                    if (dead) {
                        const col = getPlayerColor(id);
                        particles.emit(dead.ix, dead.iy, 50, col.body, 8, 45, 4);
                        particles.emit(dead.ix, dead.iy, 30, '#ff4400', 6, 35, 3);
                        particles.emit(dead.ix, dead.iy, 20, '#ffffff', 4, 25, 2);
                        shake.trigger(8);
                    }
                }
            }
            prevAliveRef.current = currentAlive;

            particles.update();
            particles.draw(ctx);

            ctx.restore(); // End camera transform

            // ─── Minimap ────────────────────────────────────────────────
            const mmSize = Math.min(160, window.innerWidth * 0.2);
            const mmPad = 15;
            const mmX = mmPad;
            const mmY = window.innerHeight - mmSize - mmPad - 60; // above mobile controls
            const mmScale = mmSize / (arenaR * 2.4);

            ctx.save();
            ctx.globalAlpha = 0.75;

            // Background
            ctx.fillStyle = 'rgba(5, 5, 20, 0.85)';
            ctx.strokeStyle = 'rgba(0, 180, 255, 0.3)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(mmX + mmSize / 2, mmY + mmSize / 2, mmSize / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Arena ring
            ctx.beginPath();
            ctx.arc(mmX + mmSize / 2, mmY + mmSize / 2, arenaR * mmScale, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0, 180, 255, 0.2)';
            ctx.stroke();

            // Danger ring
            ctx.beginPath();
            ctx.arc(mmX + mmSize / 2, mmY + mmSize / 2, dangerZone * mmScale, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 50, 50, 0.15)';
            ctx.stroke();

            // Powerups
            ctx.globalAlpha = 0.6;
            (snapshot.powerups || []).forEach(pu => {
                ctx.fillStyle = 'rgba(255, 215, 0, 0.7)';
                ctx.beginPath();
                ctx.arc(mmX + mmSize / 2 + pu.x * mmScale, mmY + mmSize / 2 + pu.y * mmScale, 2, 0, Math.PI * 2);
                ctx.fill();
            });

            // Players
            ctx.globalAlpha = 0.9;
            players.forEach(p => {
                if (!p.alive) return;
                const col = getPlayerColor(p.id);
                const mx = mmX + mmSize / 2 + p.ix * mmScale;
                const my = mmY + mmSize / 2 + p.iy * mmScale;

                ctx.fillStyle = col.body;
                ctx.beginPath();
                ctx.arc(mx, my, p.id === localId ? 4 : 3, 0, Math.PI * 2);
                ctx.fill();

                // Direction indicator for local player
                if (p.id === localId) {
                    ctx.strokeStyle = col.body;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(mx, my);
                    ctx.lineTo(mx + Math.cos(p.ia) * 8, my + Math.sin(p.ia) * 8);
                    ctx.stroke();
                }
            });
            ctx.restore();

            // ─── Spectator overlay ──────────────────────────────────────
            if (spectating && target) {
                ctx.save();
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                const specW = 300, specH = 32;
                const specX = (window.innerWidth - specW) / 2;
                ctx.beginPath();
                ctx.roundRect?.(specX, window.innerHeight - 80, specW, specH, 16) ||
                    ctx.rect(specX, window.innerHeight - 80, specW, specH);
                ctx.fill();

                ctx.fillStyle = '#ff4444';
                ctx.font = 'bold 14px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`👁 SPECTATING: ${target.name || target.id.slice(0, 4)}`, window.innerWidth / 2, window.innerHeight - 64);
                ctx.restore();
            }

            // ─── Edge warning vignette ──────────────────────────────────
            if (target && target.alive) {
                const myDist = Math.hypot(target.ix, target.iy);
                if (myDist > dangerZone) {
                    const danger = clamp((myDist - dangerZone) / (arenaR - dangerZone), 0, 1);
                    ctx.save();
                    const vignette = ctx.createRadialGradient(
                        window.innerWidth / 2, window.innerHeight / 2, window.innerWidth * 0.3,
                        window.innerWidth / 2, window.innerHeight / 2, window.innerWidth * 0.7
                    );
                    vignette.addColorStop(0, 'transparent');
                    vignette.addColorStop(1, `rgba(255, 0, 0, ${danger * 0.4})`);
                    ctx.fillStyle = vignette;
                    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
                    ctx.restore();
                }
            }

            raf = requestAnimationFrame(draw);
        }

        draw();

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
        };
    }, [snapshot, localId]);

    // Trigger screen shake on collision events
    useEffect(() => {
        const onCollision = ({ impact }) => {
            shakeRef.current.trigger(clamp(impact / 200, 1, 6));
        };
        // We listen from parent, but also hook into snapshot for particles
        window.__dashArenaCollision = onCollision;
        return () => { delete window.__dashArenaCollision; };
    }, []);

    useEffect(() => {
        prevRef.current = {
            players: snapshot.players || [],
            powerups: snapshot.powerups || [],
            time: snapshot.timestamp || Date.now()
        };
    }, [snapshot]);

    return <canvas ref={cvsRef} className="full-screen" style={{ background: '#030308' }} />;
}
