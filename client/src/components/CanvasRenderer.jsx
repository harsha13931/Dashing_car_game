import React, { useRef, useEffect } from 'react';

const ARENA_RADIUS = 1000;
const WALL_THICKNESS = 40;
const CAR_SCALE = 1.4;

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    return `rgb(${clamp(r + amt, 0, 255)},${clamp(g + amt, 0, 255)},${clamp(b + amt, 0, 255)})`;
}

// ─── Procedural asphalt texture ─────────────────────────────────────────
function createAsphaltTexture() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a1e26';
    ctx.fillRect(0, 0, size, size);
    const id = ctx.getImageData(0, 0, size, size);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 14;
        d[i] = clamp(d[i] + n, 0, 255);
        d[i + 1] = clamp(d[i + 1] + n, 0, 255);
        d[i + 2] = clamp(d[i + 2] + n, 0, 255);
    }
    ctx.putImageData(id, 0, 0);
    for (let i = 0; i < 150; i++) {
        const g = 30 + Math.random() * 25;
        ctx.fillStyle = `rgba(${g},${g + 2},${g + 4},0.7)`;
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, 0.5 + Math.random() * 1.2, 0, Math.PI * 2);
        ctx.fill();
    }
    return c;
}

// ─── Car body shapes (with gradient shading) ────────────────────────────
export function drawCarBody(ctx, type, color, dead) {
    const t = type || 'sports';
    const highlight = dead ? '#444' : shade(color, 50);
    const base = dead ? '#2a2a2a' : color;
    const shadow = dead ? '#1a1a1a' : shade(color, -50);

    const grad = ctx.createLinearGradient(0, -12, 0, 12);
    grad.addColorStop(0, highlight);
    grad.addColorStop(0.45, base);
    grad.addColorStop(1, shadow);
    ctx.fillStyle = grad;

    switch (t) {
        case 'sports': {
            ctx.beginPath();
            ctx.moveTo(20, 0);
            ctx.bezierCurveTo(18, -5, 14, -7, 6, -8);
            ctx.lineTo(-10, -8);
            ctx.bezierCurveTo(-14, -8, -16, -6, -16, -4);
            ctx.lineTo(-16, 4);
            ctx.bezierCurveTo(-16, 6, -14, 8, -10, 8);
            ctx.lineTo(6, 8);
            ctx.bezierCurveTo(14, 7, 18, 5, 20, 0);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shade(color, -70);
            ctx.lineWidth = 0.5;
            ctx.stroke();
            // Cabin
            const cg = ctx.createLinearGradient(0, -5, 0, 5);
            cg.addColorStop(0, 'rgba(40,60,90,0.9)');
            cg.addColorStop(1, 'rgba(20,30,50,0.9)');
            ctx.fillStyle = cg;
            ctx.beginPath();
            ctx.moveTo(8, -4); ctx.lineTo(-2, -5); ctx.lineTo(-5, -3);
            ctx.lineTo(-5, 3); ctx.lineTo(-2, 5); ctx.lineTo(8, 4);
            ctx.bezierCurveTo(10, 3, 10, -3, 8, -4);
            ctx.closePath(); ctx.fill();
            if (!dead) {
                ctx.fillStyle = 'rgba(180,220,255,0.12)';
                ctx.fillRect(-4, -4.5, 12, 2);
            }
            // Body line
            ctx.strokeStyle = `rgba(255,255,255,0.08)`;
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-14, 0); ctx.stroke();
            break;
        }
        case 'muscle': {
            ctx.beginPath();
            ctx.moveTo(17, 0);
            ctx.lineTo(14, -8); ctx.lineTo(-12, -9);
            ctx.bezierCurveTo(-16, -9, -17, -7, -17, -5);
            ctx.lineTo(-17, 5);
            ctx.bezierCurveTo(-17, 7, -16, 9, -12, 9);
            ctx.lineTo(14, 8); ctx.lineTo(17, 0);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shade(color, -70);
            ctx.lineWidth = 0.5;
            ctx.stroke();
            // Hood scoop
            const sg = ctx.createLinearGradient(7, -3, 7, 3);
            sg.addColorStop(0, shade(color, 30));
            sg.addColorStop(1, shade(color, -30));
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(6, -3, 7, 6, 1) : ctx.rect(6, -3, 7, 6);
            ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.fillRect(7.5, -2, 4, 4);
            // Cabin
            const cg = ctx.createLinearGradient(0, -6, 0, 6);
            cg.addColorStop(0, 'rgba(40,55,80,0.9)');
            cg.addColorStop(1, 'rgba(20,30,45,0.9)');
            ctx.fillStyle = cg;
            ctx.beginPath();
            ctx.moveTo(5, -6); ctx.lineTo(-5, -6.5); ctx.lineTo(-7, -4);
            ctx.lineTo(-7, 4); ctx.lineTo(-5, 6.5); ctx.lineTo(5, 6);
            ctx.lineTo(7, 4); ctx.lineTo(7, -4);
            ctx.closePath(); ctx.fill();
            if (!dead) {
                ctx.fillStyle = 'rgba(180,220,255,0.1)';
                ctx.fillRect(-5, -6, 10, 2);
            }
            // Racing stripes
            ctx.fillStyle = `rgba(255,255,255,0.06)`;
            ctx.fillRect(-15, -2, 30, 1.5);
            ctx.fillRect(-15, 0.5, 30, 1.5);
            break;
        }
        case 'truck': {
            ctx.beginPath();
            ctx.moveTo(15, -10); ctx.lineTo(17, -8); ctx.lineTo(17, 8); ctx.lineTo(15, 10);
            ctx.lineTo(-17, 10); ctx.lineTo(-19, 8); ctx.lineTo(-19, -8); ctx.lineTo(-17, -10);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shade(color, -70);
            ctx.lineWidth = 0.5;
            ctx.stroke();
            // Bull bar
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(17, -7); ctx.lineTo(19, -5); ctx.lineTo(19, 5); ctx.lineTo(17, 7);
            ctx.stroke();
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(19, -2); ctx.lineTo(19, 2); ctx.stroke();
            // Cabin
            const cg = ctx.createLinearGradient(0, -6, 0, 6);
            cg.addColorStop(0, 'rgba(45,55,75,0.9)');
            cg.addColorStop(1, 'rgba(20,25,35,0.9)');
            ctx.fillStyle = cg;
            ctx.beginPath();
            ctx.moveTo(12, -7); ctx.lineTo(3, -7); ctx.lineTo(1, -5);
            ctx.lineTo(1, 5); ctx.lineTo(3, 7); ctx.lineTo(12, 7);
            ctx.lineTo(14, 5); ctx.lineTo(14, -5);
            ctx.closePath(); ctx.fill();
            // Cargo bed
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(-17, -8, 16, 16);
            ctx.strokeStyle = shade(color, -20);
            ctx.lineWidth = 1;
            ctx.strokeRect(-16, -8, 14, 16);
            break;
        }
        case 'rally': {
            ctx.beginPath();
            ctx.moveTo(15, 0);
            ctx.bezierCurveTo(15, -7, 10, -8, 6, -8);
            ctx.lineTo(-8, -8);
            ctx.bezierCurveTo(-14, -8, -15, -5, -15, -3);
            ctx.lineTo(-15, 3);
            ctx.bezierCurveTo(-15, 5, -14, 8, -8, 8);
            ctx.lineTo(6, 8);
            ctx.bezierCurveTo(10, 8, 15, 7, 15, 0);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shade(color, -70);
            ctx.lineWidth = 0.5;
            ctx.stroke();
            // Rally stripes
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(-12, -1.5, 26, 3);
            // Number circle
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.beginPath(); ctx.arc(-2, 0, 5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = dead ? '#333' : shade(color, -40);
            ctx.font = 'bold 6px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('7', -2, 0.5);
            // Cabin
            const cg = ctx.createLinearGradient(0, -5, 0, 5);
            cg.addColorStop(0, 'rgba(40,60,85,0.9)');
            cg.addColorStop(1, 'rgba(20,30,45,0.9)');
            ctx.fillStyle = cg;
            ctx.beginPath();
            ctx.moveTo(5, -5); ctx.lineTo(-3, -5.5); ctx.lineTo(-6, -4);
            ctx.lineTo(-6, 4); ctx.lineTo(-3, 5.5); ctx.lineTo(5, 5);
            ctx.lineTo(7, 3); ctx.lineTo(7, -3);
            ctx.closePath(); ctx.fill();
            break;
        }
        case 'kart': {
            ctx.beginPath();
            ctx.moveTo(13, 0);
            ctx.lineTo(10, -4); ctx.lineTo(4, -5); ctx.lineTo(-9, -5);
            ctx.lineTo(-11, -3); ctx.lineTo(-11, 3); ctx.lineTo(-9, 5);
            ctx.lineTo(4, 5); ctx.lineTo(10, 4);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shade(color, -70);
            ctx.lineWidth = 0.5;
            ctx.stroke();
            // Seat
            ctx.fillStyle = '#222';
            ctx.beginPath(); ctx.arc(-2, 0, 4, 0, Math.PI * 2); ctx.fill();
            // Roll bar
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(-5, -4.5); ctx.lineTo(-5, 4.5); ctx.stroke();
            // Steering column
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(7, 0); ctx.stroke();
            // Helmet
            if (!dead) {
                const hg = ctx.createRadialGradient(-2, 0, 0, -2, 0, 3.5);
                hg.addColorStop(0, shade(color, 40));
                hg.addColorStop(1, shade(color, -20));
                ctx.fillStyle = hg;
                ctx.beginPath(); ctx.arc(-2, 0, 3.5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = 'rgba(100,160,220,0.4)';
                ctx.beginPath(); ctx.arc(-1, 0, 2, -0.5, 0.5); ctx.fill();
            }
            break;
        }
        case 'suv': {
            ctx.beginPath();
            ctx.moveTo(15, -9); ctx.lineTo(16, -7); ctx.lineTo(16, 7); ctx.lineTo(15, 9);
            ctx.lineTo(-15, 9); ctx.lineTo(-16, 7); ctx.lineTo(-16, -7); ctx.lineTo(-15, -9);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shade(color, -70);
            ctx.lineWidth = 0.5;
            ctx.stroke();
            // Roof rack
            ctx.strokeStyle = '#3a3a3a';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(-11, -7.5, 18, 15);
            ctx.beginPath(); ctx.moveTo(-5, -7.5); ctx.lineTo(-5, 7.5); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(3, -7.5); ctx.lineTo(3, 7.5); ctx.stroke();
            // Cabin
            const cg = ctx.createLinearGradient(0, -6, 0, 6);
            cg.addColorStop(0, 'rgba(45,60,85,0.9)');
            cg.addColorStop(1, 'rgba(20,30,45,0.9)');
            ctx.fillStyle = cg;
            ctx.beginPath();
            ctx.moveTo(10, -6); ctx.lineTo(-1, -6.5); ctx.lineTo(-3, -5);
            ctx.lineTo(-3, 5); ctx.lineTo(-1, 6.5); ctx.lineTo(10, 6);
            ctx.lineTo(12, 4); ctx.lineTo(12, -4);
            ctx.closePath(); ctx.fill();
            // Bull bar
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(16, -6); ctx.lineTo(18, -4); ctx.lineTo(18, 4); ctx.lineTo(16, 6);
            ctx.stroke();
            break;
        }
        case 'drift': {
            ctx.beginPath();
            ctx.moveTo(17, 0);
            ctx.bezierCurveTo(16, -6, 12, -8, 6, -9);
            ctx.lineTo(-6, -9);
            ctx.bezierCurveTo(-12, -9, -15, -7, -15, -4);
            ctx.lineTo(-15, 4);
            ctx.bezierCurveTo(-15, 7, -12, 9, -6, 9);
            ctx.lineTo(6, 9);
            ctx.bezierCurveTo(12, 8, 16, 6, 17, 0);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shade(color, -70);
            ctx.lineWidth = 0.5;
            ctx.stroke();
            // Wide fender flares
            ctx.fillStyle = base;
            ctx.beginPath(); ctx.ellipse(5, -9.5, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(5, 9.5, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(-8, -9.5, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(-8, 9.5, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
            // Cabin
            const cg = ctx.createLinearGradient(0, -5, 0, 5);
            cg.addColorStop(0, 'rgba(40,55,80,0.9)');
            cg.addColorStop(1, 'rgba(20,28,42,0.9)');
            ctx.fillStyle = cg;
            ctx.beginPath();
            ctx.moveTo(6, -5); ctx.lineTo(-3, -5); ctx.lineTo(-5, -3);
            ctx.lineTo(-5, 3); ctx.lineTo(-3, 5); ctx.lineTo(6, 5);
            ctx.lineTo(8, 3); ctx.lineTo(8, -3);
            ctx.closePath(); ctx.fill();
            // Big rear wing
            ctx.fillStyle = '#333';
            ctx.fillRect(-17, -11, 2.5, 22);
            ctx.fillStyle = shade(color, -30);
            ctx.fillRect(-18, -11, 4.5, 2);
            ctx.fillRect(-18, 9, 4.5, 2);
            break;
        }
        case 'supercar': {
            ctx.beginPath();
            ctx.moveTo(22, 0);
            ctx.bezierCurveTo(20, -4, 16, -6, 8, -7);
            ctx.lineTo(-6, -7);
            ctx.bezierCurveTo(-14, -7, -17, -5, -17, -3);
            ctx.lineTo(-17, 3);
            ctx.bezierCurveTo(-17, 5, -14, 7, -6, 7);
            ctx.lineTo(8, 7);
            ctx.bezierCurveTo(16, 6, 20, 4, 22, 0);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shade(color, -70);
            ctx.lineWidth = 0.5;
            ctx.stroke();
            // Aero spine line
            ctx.strokeStyle = `rgba(255,255,255,0.06)`;
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-15, 0); ctx.stroke();
            // Cabin (teardrop)
            const cg = ctx.createLinearGradient(0, -4, 0, 4);
            cg.addColorStop(0, 'rgba(40,60,90,0.9)');
            cg.addColorStop(1, 'rgba(18,25,40,0.9)');
            ctx.fillStyle = cg;
            ctx.beginPath();
            ctx.moveTo(8, -3.5); ctx.lineTo(0, -4); ctx.lineTo(-3, -3);
            ctx.lineTo(-3, 3); ctx.lineTo(0, 4); ctx.lineTo(8, 3.5);
            ctx.bezierCurveTo(10, 2.5, 10, -2.5, 8, -3.5);
            ctx.closePath(); ctx.fill();
            if (!dead) {
                ctx.fillStyle = 'rgba(180,220,255,0.08)';
                ctx.fillRect(0, -3.5, 8, 1.5);
            }
            // Rear diffuser
            ctx.fillStyle = '#0a0a0a';
            for (let i = -5; i <= 5; i += 2) {
                ctx.fillRect(-17, i - 0.4, 3, 0.8);
            }
            break;
        }
        default: {
            ctx.beginPath();
            ctx.moveTo(16, 0); ctx.lineTo(12, -7); ctx.lineTo(4, -9);
            ctx.lineTo(-8, -9); ctx.lineTo(-14, -6); ctx.lineTo(-14, 6);
            ctx.lineTo(-8, 9); ctx.lineTo(4, 9); ctx.lineTo(12, 7);
            ctx.closePath(); ctx.fill();
            break;
        }
    }
}

export function drawWheels(ctx, type) {
    const t = type || 'sports';
    let wheels;
    switch (t) {
        case 'truck':
            wheels = [{ x: 11, y: -11.5 }, { x: 11, y: 8 }, { x: -12, y: -11.5 }, { x: -12, y: 8 }];
            break;
        case 'muscle':
            wheels = [{ x: 9, y: -10.5 }, { x: 9, y: 7.5 }, { x: -10, y: -10.5 }, { x: -10, y: 7 }];
            break;
        case 'kart':
            wheels = [{ x: 8, y: -7.5 }, { x: 8, y: 5 }, { x: -8, y: -7.5 }, { x: -8, y: 5 }];
            break;
        case 'suv':
            wheels = [{ x: 9, y: -10.5 }, { x: 9, y: 7 }, { x: -11, y: -10.5 }, { x: -11, y: 7 }];
            break;
        case 'drift':
            wheels = [{ x: 8, y: -12 }, { x: 8, y: 9 }, { x: -9, y: -12 }, { x: -9, y: 9 }];
            break;
        case 'supercar':
            wheels = [{ x: 10, y: -8.5 }, { x: 10, y: 6 }, { x: -11, y: -8.5 }, { x: -11, y: 6 }];
            break;
        default:
            wheels = [{ x: 8, y: -10 }, { x: 8, y: 7 }, { x: -10, y: -10 }, { x: -10, y: 7 }];
    }
    const rw = t === 'truck' || t === 'suv' ? 5.5 : (t === 'kart' ? 4 : 5);
    const rh = t === 'truck' || t === 'suv' ? 4 : (t === 'kart' ? 2.5 : 3.2);

    for (const w of wheels) {
        const cx = w.x + rw / 2, cy = w.y + rh / 2;
        // Tire
        ctx.fillStyle = '#0e0e0e';
        ctx.beginPath();
        ctx.ellipse(cx, cy, rw / 2 + 0.5, rh / 2 + 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Rim
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath();
        ctx.ellipse(cx, cy, rw / 2 - 1.2, rh / 2 - 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        // Hub
        ctx.fillStyle = '#555';
        ctx.beginPath();
        ctx.ellipse(cx, cy, 1.2, 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

export function drawHeadlights(ctx, type) {
    const t = type || 'sports';
    let noseX = 15, spread = 5;
    switch (t) {
        case 'truck': noseX = 17; spread = 7; break;
        case 'muscle': noseX = 16; spread = 6; break;
        case 'suv': noseX = 16; spread = 6; break;
        case 'kart': noseX = 12; spread = 3; break;
        case 'supercar': noseX = 20; spread = 4; break;
        case 'drift': noseX = 16; spread = 5; break;
    }

    ctx.save();
    // Warm beams
    ctx.globalAlpha = 0.04;
    ctx.fillStyle = '#fff8e0';
    ctx.beginPath();
    ctx.moveTo(noseX, -spread); ctx.lineTo(50, -14); ctx.lineTo(50, 0); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(noseX, spread); ctx.lineTo(50, 0); ctx.lineTo(50, 14); ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Headlight lenses
    ctx.fillStyle = '#fff8dd';
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#ffeeaa';
    ctx.beginPath(); ctx.arc(noseX - 1, -(spread - 1), 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(noseX - 1, spread - 1, 1.8, 0, Math.PI * 2); ctx.fill();

    // Tail lights
    const tailX = t === 'truck' ? -18 : (t === 'supercar' ? -16 : -14);
    const tailSpread = t === 'truck' ? 7 : (t === 'suv' ? 6 : 5);
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = 3;
    ctx.fillStyle = '#cc0000';
    ctx.beginPath(); ctx.arc(tailX, -tailSpread, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(tailX, tailSpread, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
}

// ─── Particle system ────────────────────────────────────────────────────
class ParticlePool {
    constructor(max = 500) { this.particles = []; this.max = max; }

    emit(x, y, count, color, speed = 3, life = 30, size = 3) {
        for (let i = 0; i < count && this.particles.length < this.max; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = Math.random() * speed + 0.5;
            this.particles.push({
                x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                life, maxLife: life, color, size: size * (0.5 + Math.random() * 0.5)
            });
        }
    }

    emitDirectional(x, y, count, angle, spread, color, speed, life, size = 3) {
        for (let i = 0; i < count && this.particles.length < this.max; i++) {
            const a = angle + (Math.random() - 0.5) * spread;
            const v = Math.random() * speed + speed * 0.3;
            this.particles.push({
                x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                life, maxLife: life, color, size: size * (0.5 + Math.random() * 0.5)
            });
        }
    }

    emitSparks(x, y, count, angle) {
        for (let i = 0; i < count && this.particles.length < this.max; i++) {
            const a = angle + (Math.random() - 0.5) * 2.5;
            const v = 3 + Math.random() * 6;
            const colors = ['#ffcc44', '#ff8822', '#ffee88', '#ffffff'];
            this.particles.push({
                x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                life: 10 + Math.random() * 15, maxLife: 20, color: colors[i % 4],
                size: 1 + Math.random() * 1.5, spark: true
            });
        }
    }

    update() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx; p.y += p.vy;
            p.vx *= p.spark ? 0.97 : 0.95;
            p.vy *= p.spark ? 0.97 : 0.95;
            if (p.spark) p.vy += 0.1;
            p.life--;
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    draw(ctx) {
        for (const p of this.particles) {
            const alpha = p.life / p.maxLife;
            const r = p.size * (p.spark ? 1 : alpha);
            if (r < 0.2) continue;
            ctx.save();
            ctx.globalAlpha = alpha * 0.9;
            ctx.fillStyle = p.color;
            if (p.spark) {
                ctx.fillRect(p.x - r * 0.5, p.y - r * 0.5, r, r);
            } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
            }
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
            const alpha = (m.life / m.maxLife) * 0.12;
            if (alpha < 0.01) continue;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(m.x, m.y);
            ctx.rotate(m.angle);
            ctx.fillStyle = '#222';
            ctx.fillRect(-m.width * 0.5, -7, m.width, 2.5);
            ctx.fillRect(-m.width * 0.5, 4.5, m.width, 2.5);
            ctx.restore();
        }
    }
}

// ─── Screen shake ───────────────────────────────────────────────────────
class ScreenShake {
    constructor() { this.intensity = 0; this.decay = 0.9; this.x = 0; this.y = 0; }
    trigger(force) { this.intensity = Math.min(18, this.intensity + force); }
    update() {
        if (this.intensity < 0.5) { this.x = this.y = 0; this.intensity = 0; return; }
        this.x = (Math.random() - 0.5) * this.intensity * 2;
        this.y = (Math.random() - 0.5) * this.intensity * 2;
        this.intensity *= this.decay;
    }
}

// ─── Ambient dust ───────────────────────────────────────────────────────
class AmbientDust {
    constructor(count = 60) {
        this.motes = [];
        for (let i = 0; i < count; i++) {
            this.motes.push({
                x: (Math.random() - 0.5) * ARENA_RADIUS * 2,
                y: (Math.random() - 0.5) * ARENA_RADIUS * 2,
                size: 0.5 + Math.random() * 1.5,
                alpha: 0.05 + Math.random() * 0.1,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }
    draw(ctx, now) {
        for (const m of this.motes) {
            m.x += m.vx; m.y += m.vy;
            if (Math.hypot(m.x, m.y) > ARENA_RADIUS) {
                m.x = (Math.random() - 0.5) * ARENA_RADIUS;
                m.y = (Math.random() - 0.5) * ARENA_RADIUS;
            }
            const a = m.alpha * (0.7 + Math.sin(now / 2000 + m.phase) * 0.3);
            ctx.globalAlpha = a;
            ctx.fillStyle = '#aaa';
            ctx.beginPath();
            ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

// ─── Color palette (realistic car paints) ───────────────────────────────
const PLAYER_COLORS = [
    { body: '#1199dd', name: 'Blue' },
    { body: '#cc2244', name: 'Red' },
    { body: '#dd8800', name: 'Orange' },
    { body: '#22aa44', name: 'Green' },
    { body: '#9944cc', name: 'Purple' },
    { body: '#ccaa00', name: 'Gold' },
    { body: '#00aaaa', name: 'Teal' },
    { body: '#cc5522', name: 'Rust' },
];

export default function CanvasRenderer({ snapshot, localId }) {
    const cvsRef = useRef();
    const prevRef = useRef({ players: [], powerups: [], time: Date.now() });
    const cameraRef = useRef({ x: 0, y: 0 });
    const particlesRef = useRef(new ParticlePool());
    const tireTrailsRef = useRef(new TireTrailPool());
    const shakeRef = useRef(new ScreenShake());
    const dustRef = useRef(new AmbientDust());
    const prevAliveRef = useRef(new Set());
    const colorMapRef = useRef(new Map());
    const frameRef = useRef(0);
    const asphaltRef = useRef(null);
    const asphaltPatternRef = useRef(null);

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
        asphaltRef.current = createAsphaltTexture();
    }, []);

    useEffect(() => {
        const cvs = cvsRef.current;
        const ctx = cvs.getContext('2d');
        let raf;

        function resize() {
            const DPR = window.devicePixelRatio || 1;
            cvs.width = window.innerWidth * DPR;
            cvs.height = window.innerHeight * DPR;
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            asphaltPatternRef.current = null;
        }
        window.addEventListener('resize', resize);
        resize();

        function draw() {
            frameRef.current++;
            const frame = frameRef.current;
            const W = window.innerWidth, H = window.innerHeight;
            const now = Date.now();

            ctx.fillStyle = '#050810';
            ctx.fillRect(0, 0, W, H);

            const prev = prevRef.current;
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
                const aliveP = players.find(p => p.alive);
                if (aliveP) { target = aliveP; spectating = true; }
                else if (players.length > 0) { target = players[0]; spectating = true; }
            }

            const tx = target ? target.ix : 0;
            const ty = target ? target.iy : 0;
            cameraRef.current.x = lerp(cameraRef.current.x, tx, 0.08);
            cameraRef.current.y = lerp(cameraRef.current.y, ty, 0.08);

            const shake = shakeRef.current;
            shake.update();
            const camX = cameraRef.current.x + shake.x;
            const camY = cameraRef.current.y + shake.y;

            ctx.save();
            ctx.translate(W / 2, H / 2);
            ctx.translate(-camX, -camY);

            // ─── Arena floor (asphalt texture) ─────────────────────────
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, arenaR, 0, Math.PI * 2);
            ctx.clip();

            if (asphaltRef.current) {
                if (!asphaltPatternRef.current) {
                    asphaltPatternRef.current = ctx.createPattern(asphaltRef.current, 'repeat');
                }
                ctx.fillStyle = asphaltPatternRef.current;
                ctx.fillRect(-arenaR, -arenaR, arenaR * 2, arenaR * 2);
            } else {
                ctx.fillStyle = '#1a1e26';
                ctx.fillRect(-arenaR, -arenaR, arenaR * 2, arenaR * 2);
            }

            // Radial darkening at edges
            const edgeGrad = ctx.createRadialGradient(0, 0, arenaR * 0.4, 0, 0, arenaR);
            edgeGrad.addColorStop(0, 'rgba(0,0,0,0)');
            edgeGrad.addColorStop(0.7, 'rgba(0,0,0,0.05)');
            edgeGrad.addColorStop(1, 'rgba(0,0,0,0.25)');
            ctx.fillStyle = edgeGrad;
            ctx.fillRect(-arenaR, -arenaR, arenaR * 2, arenaR * 2);
            ctx.restore();

            // ─── Road markings ─────────────────────────────────────────
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([15, 25]);
            ctx.beginPath();
            ctx.arc(0, 0, arenaR * 0.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, arenaR * 0.75, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Center marking
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(40, 0); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(0, 40); ctx.stroke();
            ctx.restore();

            // ─── Concrete barrier wall ─────────────────────────────────
            ctx.save();
            // Wall body
            ctx.beginPath();
            ctx.arc(0, 0, arenaR + WALL_THICKNESS, 0, Math.PI * 2);
            ctx.arc(0, 0, arenaR, 0, Math.PI * 2, true);
            const wallGrad = ctx.createRadialGradient(0, 0, arenaR, 0, 0, arenaR + WALL_THICKNESS);
            wallGrad.addColorStop(0, '#3a3e48');
            wallGrad.addColorStop(0.3, '#2e3238');
            wallGrad.addColorStop(1, '#1a1d22');
            ctx.fillStyle = wallGrad;
            ctx.fill();
            // Inner white line
            ctx.beginPath();
            ctx.arc(0, 0, arenaR + 2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
            // Outer edge shadow
            ctx.beginPath();
            ctx.arc(0, 0, arenaR + WALL_THICKNESS, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 3;
            ctx.stroke();
            // Hazard stripes at certain intervals
            const numStripes = 24;
            for (let i = 0; i < numStripes; i++) {
                const a1 = (i / numStripes) * Math.PI * 2;
                const a2 = ((i + 0.3) / numStripes) * Math.PI * 2;
                ctx.beginPath();
                ctx.arc(0, 0, arenaR + 4, a1, a2);
                ctx.strokeStyle = 'rgba(255,180,0,0.15)';
                ctx.lineWidth = 4;
                ctx.stroke();
            }
            ctx.restore();

            // ─── Danger zone ───────────────────────────────────────────
            ctx.save();
            const dangerPulse = 0.5 + Math.sin(now / 500) * 0.3;
            // Subtle red ring at danger boundary
            ctx.setLineDash([12, 18]);
            ctx.beginPath();
            ctx.arc(0, 0, dangerZone, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(200, 50, 50, ${dangerPulse * 0.2})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
            // Danger zone shading
            ctx.beginPath();
            ctx.arc(0, 0, arenaR, 0, Math.PI * 2);
            ctx.arc(0, 0, dangerZone, 0, Math.PI * 2, true);
            ctx.fillStyle = `rgba(120, 20, 20, ${dangerPulse * 0.06})`;
            ctx.fill();
            ctx.restore();

            // ─── Ambient dust ──────────────────────────────────────────
            ctx.save();
            dustRef.current.draw(ctx, now);
            ctx.restore();

            // ─── Tire trails ───────────────────────────────────────────
            const tireTrails = tireTrailsRef.current;
            tireTrails.update();
            tireTrails.draw(ctx);

            // ─── Powerups ──────────────────────────────────────────────
            (snapshot.powerups || []).forEach(p => {
                ctx.save();
                ctx.translate(p.x, p.y);
                const pulse = 1 + Math.sin(now / 250 + p.x) * 0.1;
                ctx.scale(pulse, pulse);

                let color = '#ccc', label = '?';
                if (p.type === 'SpeedBoost') { color = '#22cc66'; label = '⚡'; }
                if (p.type === 'Shield') { color = '#3399ff'; label = '🛡️'; }
                if (p.type === 'MegaPush') { color = '#ee3355'; label = '💪'; }
                if (p.type === 'Oil') { color = '#555'; label = '🛢️'; }
                if (p.type === 'Reverse') { color = '#9944dd'; label = '🔄'; }
                if (p.type === 'Magnet') { color = '#ddaa00'; label = '🧲'; }

                // Outer ring
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.arc(0, 0, 16, 0, Math.PI * 2);
                ctx.stroke();

                // Inner fill
                ctx.globalAlpha = 0.15;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(0, 0, 14, 0, Math.PI * 2);
                ctx.fill();

                // Icon
                ctx.globalAlpha = 1;
                ctx.fillStyle = color;
                ctx.font = 'bold 13px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, 0, 0);
                ctx.restore();
            });

            // ─── Projectiles ───────────────────────────────────────────
            (snapshot.projectiles || []).forEach(proj => {
                ctx.save();
                ctx.translate(proj.x, proj.y);
                const projAngle = Math.atan2(proj.vy, proj.vx);
                ctx.rotate(projAngle);

                // Trail
                const tg = ctx.createLinearGradient(-20, 0, 0, 0);
                tg.addColorStop(0, 'rgba(255,120,0,0)');
                tg.addColorStop(1, 'rgba(255,120,0,0.4)');
                ctx.fillStyle = tg;
                ctx.beginPath();
                ctx.moveTo(0, -3); ctx.lineTo(-20, 0); ctx.lineTo(0, 3);
                ctx.fill();

                // Core
                ctx.fillStyle = '#ffcc00';
                ctx.beginPath();
                ctx.arc(0, 0, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(0, 0, 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });

            // ─── Players (cars) ────────────────────────────────────────
            players.forEach(p => {
                ctx.save();
                ctx.translate(p.ix, p.iy);

                const scale = (p.iscale || 1) * CAR_SCALE;
                const isMe = p.id === localId;
                const col = getPlayerColor(p.id);
                const dead = !p.alive;
                const carType = p.carType || 'sports';

                // Tire marks
                if (p.alive && (p.isDashing || p.slip > 0)) {
                    tireTrails.add(p.ix, p.iy, p.ia, p.isDashing ? 7 : 4);
                }

                // ─── Drop shadow ───────────────────────────────────────
                ctx.save();
                ctx.rotate(p.ia);
                ctx.scale(scale, scale);
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.beginPath();
                ctx.ellipse(1, 2, 16, 9, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                // Now draw the car
                ctx.save();
                ctx.rotate(p.ia);
                ctx.scale(scale, scale);

                // ─── Shield bubble ─────────────────────────────────────
                if (p.shield) {
                    ctx.save();
                    const sp = 0.5 + Math.sin(now / 200) * 0.2;
                    ctx.globalAlpha = sp;
                    ctx.beginPath();
                    ctx.arc(0, 0, 22, 0, Math.PI * 2);
                    ctx.strokeStyle = '#3399ff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.globalAlpha = sp * 0.1;
                    ctx.fillStyle = '#3399ff';
                    ctx.fill();
                    ctx.restore();
                }

                // ─── Exhaust / trail ───────────────────────────────────
                if (p.alive) {
                    ctx.save();
                    if (p.isDashing) {
                        const flameLen = 30 + Math.random() * 18;
                        // Outer flame
                        const fg = ctx.createLinearGradient(-14, 0, -flameLen, 0);
                        fg.addColorStop(0, 'rgba(255,160,0,0.8)');
                        fg.addColorStop(0.5, 'rgba(255,80,0,0.4)');
                        fg.addColorStop(1, 'rgba(255,40,0,0)');
                        ctx.fillStyle = fg;
                        ctx.beginPath();
                        ctx.moveTo(-14, -4); ctx.lineTo(-flameLen, 0); ctx.lineTo(-14, 4);
                        ctx.fill();
                        // Inner flame
                        ctx.fillStyle = 'rgba(255,240,180,0.6)';
                        ctx.beginPath();
                        ctx.moveTo(-14, -2); ctx.lineTo(-flameLen * 0.5, 0); ctx.lineTo(-14, 2);
                        ctx.fill();
                    } else if (p.speedMult > 1) {
                        const sg = ctx.createLinearGradient(-14, 0, -25, 0);
                        sg.addColorStop(0, 'rgba(0,200,100,0.5)');
                        sg.addColorStop(1, 'rgba(0,200,100,0)');
                        ctx.fillStyle = sg;
                        ctx.beginPath();
                        ctx.moveTo(-14, -2.5); ctx.lineTo(-25 - Math.random() * 6, 0); ctx.lineTo(-14, 2.5);
                        ctx.fill();
                    } else {
                        // Small exhaust puff
                        ctx.globalAlpha = 0.15;
                        ctx.fillStyle = '#999';
                        const ex = -16 - Math.random() * 4;
                        ctx.beginPath();
                        ctx.arc(ex, (Math.random() - 0.5) * 2, 1.5 + Math.random(), 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.restore();
                }

                // ─── Car body ──────────────────────────────────────────
                drawWheels(ctx, carType);
                drawCarBody(ctx, carType, col.body, dead);
                if (!dead) drawHeadlights(ctx, carType);

                // ─── Speed lines ───────────────────────────────────────
                if (p.alive && p.speedMult > 1) {
                    ctx.save();
                    ctx.globalAlpha = 0.15;
                    ctx.strokeStyle = '#66ddaa';
                    ctx.lineWidth = 0.8;
                    for (let i = 0; i < 3; i++) {
                        const y = -7 + i * 7;
                        ctx.beginPath();
                        ctx.moveTo(-18 - Math.random() * 8, y);
                        ctx.lineTo(-30 - Math.random() * 12, y);
                        ctx.stroke();
                    }
                    ctx.restore();
                }

                ctx.restore(); // end car scale/rotation

                // ─── Name tag (screen-space) ───────────────────────────
                ctx.save();
                const label = isMe ? '★ YOU' : (p.name || p.id.slice(0, 4));
                const tagY = -22 * scale;

                // Background pill
                ctx.font = `bold 11px 'Inter',system-ui,sans-serif`;
                const tw = ctx.measureText(label).width;
                const pillW = tw + 14;
                const pillH = 18;
                ctx.fillStyle = isMe
                    ? 'rgba(20,80,140,0.7)'
                    : (dead ? 'rgba(40,40,40,0.6)' : 'rgba(0,0,0,0.5)');
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(-pillW / 2, tagY - pillH / 2, pillW, pillH, 9);
                else ctx.rect(-pillW / 2, tagY - pillH / 2, pillW, pillH);
                ctx.fill();

                // Border
                if (isMe) {
                    ctx.strokeStyle = 'rgba(80,180,255,0.4)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }

                ctx.fillStyle = isMe ? '#88ccff' : (dead ? '#666' : '#ddd');
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, 0, tagY);

                if (p.isBot && !isMe) {
                    ctx.fillStyle = '#777';
                    ctx.font = '8px Inter,sans-serif';
                    ctx.fillText('BOT', 0, tagY + 13);
                }
                ctx.restore();

                ctx.restore(); // end player transform
            });

            // ─── Particles ─────────────────────────────────────────────
            const particles = particlesRef.current;

            players.forEach(p => {
                if (p.alive && p.isDashing) {
                    particles.emitDirectional(
                        p.ix - Math.cos(p.ia) * 15 * CAR_SCALE,
                        p.iy - Math.sin(p.ia) * 15 * CAR_SCALE,
                        2, p.ia + Math.PI, 0.8, '#ffaa00', 4, 18, 2.5
                    );
                }
                if (p.alive && p.speedMult > 1 && frame % 4 === 0) {
                    particles.emit(
                        p.ix - Math.cos(p.ia) * 12 * CAR_SCALE,
                        p.iy - Math.sin(p.ia) * 12 * CAR_SCALE,
                        1, '#33cc77', 1.5, 12, 1.5
                    );
                }
            });

            // Death explosions
            const currentAlive = new Set(players.filter(p => p.alive).map(p => p.id));
            for (const id of prevAliveRef.current) {
                if (!currentAlive.has(id)) {
                    const dp = players.find(p => p.id === id);
                    if (dp) {
                        const col = getPlayerColor(id);
                        particles.emit(dp.ix, dp.iy, 35, col.body, 7, 40, 3.5);
                        particles.emitSparks(dp.ix, dp.iy, 20, Math.random() * Math.PI * 2);
                        particles.emit(dp.ix, dp.iy, 15, '#333', 3, 30, 4);
                        shake.trigger(10);
                    }
                }
            }
            prevAliveRef.current = currentAlive;

            particles.update();
            particles.draw(ctx);

            ctx.restore(); // End camera transform

            // ─── Minimap ───────────────────────────────────────────────
            const mmSize = Math.min(140, W * 0.18);
            const mmPad = 14;
            const mmX = mmPad;
            const mmY = H - mmSize - mmPad - 55;
            const mmScale = mmSize / (arenaR * 2.4);
            const mmCx = mmX + mmSize / 2;
            const mmCy = mmY + mmSize / 2;

            ctx.save();
            ctx.globalAlpha = 0.8;

            // Background
            ctx.fillStyle = 'rgba(10,12,20,0.9)';
            ctx.beginPath();
            ctx.arc(mmCx, mmCy, mmSize / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Arena ring
            ctx.beginPath();
            ctx.arc(mmCx, mmCy, arenaR * mmScale, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.stroke();

            // Danger ring
            ctx.beginPath();
            ctx.arc(mmCx, mmCy, dangerZone * mmScale, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(200,50,50,0.12)';
            ctx.stroke();

            // Powerups
            ctx.globalAlpha = 0.5;
            (snapshot.powerups || []).forEach(pu => {
                ctx.fillStyle = '#aa8800';
                ctx.beginPath();
                ctx.arc(mmCx + pu.x * mmScale, mmCy + pu.y * mmScale, 1.5, 0, Math.PI * 2);
                ctx.fill();
            });

            // Players
            ctx.globalAlpha = 1;
            players.forEach(p => {
                if (!p.alive) return;
                const col = getPlayerColor(p.id);
                const mx = mmCx + p.ix * mmScale;
                const my = mmCy + p.iy * mmScale;

                ctx.fillStyle = col.body;
                ctx.beginPath();
                ctx.arc(mx, my, p.id === localId ? 3.5 : 2.5, 0, Math.PI * 2);
                ctx.fill();

                if (p.id === localId) {
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(mx, my);
                    ctx.lineTo(mx + Math.cos(p.ia) * 7, my + Math.sin(p.ia) * 7);
                    ctx.stroke();
                }
            });
            ctx.restore();

            // ─── Spectator overlay ─────────────────────────────────────
            if (spectating && target) {
                ctx.save();
                const specW = 260, specH = 30;
                const specX = (W - specW) / 2;
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(specX, H - 70, specW, specH, 15);
                else ctx.rect(specX, H - 70, specW, specH);
                ctx.fill();
                ctx.fillStyle = '#ee4444';
                ctx.font = 'bold 13px Inter,sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`SPECTATING: ${target.name || target.id.slice(0, 4)}`, W / 2, H - 55);
                ctx.restore();
            }

            // ─── Edge warning vignette ─────────────────────────────────
            if (target && target.alive) {
                const myDist = Math.hypot(target.ix, target.iy);
                if (myDist > dangerZone) {
                    const danger = clamp((myDist - dangerZone) / (arenaR - dangerZone), 0, 1);
                    ctx.save();
                    const vignette = ctx.createRadialGradient(
                        W / 2, H / 2, W * 0.3,
                        W / 2, H / 2, W * 0.7
                    );
                    vignette.addColorStop(0, 'transparent');
                    vignette.addColorStop(1, `rgba(180, 0, 0, ${danger * 0.35})`);
                    ctx.fillStyle = vignette;
                    ctx.fillRect(0, 0, W, H);
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

    useEffect(() => {
        const onCollision = ({ impact }) => {
            shakeRef.current.trigger(clamp(impact / 200, 1, 6));
            const shake = shakeRef.current;
            if (impact > 300) {
                const cx = cameraRef.current.x;
                const cy = cameraRef.current.y;
                particlesRef.current.emitSparks(cx, cy, Math.floor(impact / 100), Math.random() * Math.PI * 2);
            }
        };
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

    return <canvas ref={cvsRef} className="full-screen" style={{ background: '#050810' }} />;
}
