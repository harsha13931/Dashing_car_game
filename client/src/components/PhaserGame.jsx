import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { socket } from '../net/socket';
import { trailColor, drawTopper, TOPPERS } from '../cosmetics';
import { renderCar, renderShadow, renderBrakeGlow, lookKey, resolveLook, CAR_TEX_H } from '../carRender';
import { PAINTS, underglowColor } from '../cosmetics';
import { net, PLANE_SPEED, DROP_FALL_MS } from '../net/netcode';
import { pickRocketTarget, CAR_TYPES } from '../../../shared/physics.mjs';

function hexToInt(hex) {
    if (!hex || hex[0] !== '#') return 0xffffff;
    return parseInt(hex.slice(1), 16);
}
// CSS color (hex or hsl()) → integer for Phaser tint
function cssToInt(col) {
    if (!col) return 0xffa000;
    if (col[0] === '#') return hexToInt(col);
    const m = col.match(/hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
    if (m) {
        const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
        const hue = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        const r = Math.round(hue(p, q, h + 1 / 3) * 255);
        const g = Math.round(hue(p, q, h) * 255);
        const b = Math.round(hue(p, q, h - 1 / 3) * 255);
        return (r << 16) | (g << 8) | b;
    }
    return 0xffa000;
}
// ─── Car art ───────────────────────────────────────────────────────────────
const TYPE_SIZE = {             // matches server carStats.size for hitbox accuracy
    sports: 0.9, muscle: 1.1, truck: 1.4, rally: 0.95,
    kart: 0.7, suv: 1.2, drift: 0.95, supercar: 0.85,
};
// The physics box is 88×46 world px × size; the drawn car is 264×144 px,
// so this scale makes what you see match what you hit.
const CAR_SCALE = 92.4 / CAR_TEX_H;
const TOPPER_SCALE = 0.7;

function hashId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h);
}
// Anyone without a saved look (shouldn't happen any more) still gets a distinct paint
function fallbackLook(id) {
    const paints = PAINTS.filter(p => p.color);
    return { paint: paints[hashId(id) % paints.length].key };
}

// Headlight cone (points up, drawn additively)
function makeBeamCanvas() {
    const W = 220, H = 300;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    for (const x of [W / 2 - 34, W / 2 + 34]) {
        const grd = g.createLinearGradient(0, H, 0, 0);
        grd.addColorStop(0, 'rgba(255,250,225,0.9)'); grd.addColorStop(1, 'rgba(255,250,225,0)');
        g.fillStyle = grd;
        g.beginPath(); g.moveTo(x - 8, H); g.lineTo(x - 70, 0); g.lineTo(x + 70, 0); g.lineTo(x + 8, H); g.closePath(); g.fill();
    }
    return c;
}

// Soft oval of light under the car (tinted per underglow colour)
function makeUnderglowCanvas() {
    const W = 200, H = 320;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.translate(W / 2, H / 2); g.scale(1, H / W);
    const grd = g.createRadialGradient(0, 0, 10, 0, 0, W / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, W / 2, 0, Math.PI * 2); g.fill();
    return c;
}

// ─── Procedural asphalt tile (offscreen canvas → Phaser texture) ────────────
function makeAsphaltCanvas() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2b3039';   // lighter asphalt so dark cars still stand out
    ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 16;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 180; i++) {
        const g = 28 + Math.random() * 22;
        ctx.fillStyle = `rgba(${g},${g + 2},${g + 5},0.6)`;
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, 0.5 + Math.random() * 1.3, 0, Math.PI * 2);
        ctx.fill();
    }
    return c;
}

// ─── Air-drop art: cargo plane (faces +x), wooden crate, parachute ────────
function makePlaneCanvas() {
    const W = 240, H = 230;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.translate(W / 2, H / 2);
    const body = '#dfe3e8', dark = '#8d96a3', accent = '#d6312f';
    // Main wings
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(18, -6); g.lineTo(-6, -108); g.lineTo(-30, -108); g.lineTo(-22, -6);
    g.lineTo(-22, 6); g.lineTo(-30, 108); g.lineTo(-6, 108); g.lineTo(18, 6);
    g.closePath(); g.fill();
    g.strokeStyle = dark; g.lineWidth = 2; g.stroke();
    // Wing stripes
    g.fillStyle = accent;
    g.fillRect(-26, -104, 18, 10); g.fillRect(-26, 94, 18, 10);
    // Engines + props
    for (const y of [-58, 58]) {
        g.fillStyle = '#5a6270';
        g.beginPath(); g.ellipse(14, y, 20, 8, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(30,30,30,0.35)';
        g.beginPath(); g.ellipse(36, y, 3, 22, 0, 0, Math.PI * 2); g.fill();
    }
    // Tail
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-82, -4); g.lineTo(-100, -40); g.lineTo(-112, -40); g.lineTo(-104, -4);
    g.lineTo(-104, 4); g.lineTo(-112, 40); g.lineTo(-100, 40); g.lineTo(-82, 4);
    g.closePath(); g.fill(); g.stroke();
    // Fuselage
    const fg = g.createLinearGradient(0, -16, 0, 16);
    fg.addColorStop(0, '#f4f6f8'); fg.addColorStop(0.5, '#d2d7de'); fg.addColorStop(1, '#a8b0bb');
    g.fillStyle = fg;
    g.beginPath();
    g.moveTo(64, 0); g.quadraticCurveTo(58, -15, 30, -15); g.lineTo(-96, -9); g.quadraticCurveTo(-112, 0, -96, 9);
    g.lineTo(30, 15); g.quadraticCurveTo(58, 15, 64, 0);
    g.closePath(); g.fill(); g.stroke();
    // Cockpit + stripe
    g.fillStyle = '#2b4a6b';
    g.beginPath(); g.ellipse(44, 0, 11, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = accent; g.fillRect(-60, -2, 70, 4);
    return c;
}

function makeRocketCanvas() {
    const W = 70, H = 24;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    // Fins
    g.fillStyle = '#3b3f46';
    g.beginPath(); g.moveTo(10, 12); g.lineTo(2, 1); g.lineTo(18, 7); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(10, 12); g.lineTo(2, 23); g.lineTo(18, 17); g.closePath(); g.fill();
    // Body
    const bg = g.createLinearGradient(0, 6, 0, 18);
    bg.addColorStop(0, '#f2f4f6'); bg.addColorStop(0.5, '#c9ced6'); bg.addColorStop(1, '#8a929e');
    g.fillStyle = bg; g.fillRect(8, 6.5, 44, 11);
    // Nose cone
    g.fillStyle = '#d6312f';
    g.beginPath(); g.moveTo(52, 6.5); g.quadraticCurveTo(68, 12, 52, 17.5); g.closePath(); g.fill();
    // Band + nozzle
    g.fillStyle = '#d6312f'; g.fillRect(30, 6.5, 4, 11);
    g.fillStyle = '#2a2d33'; g.fillRect(4, 8.5, 5, 7);
    return c;
}

// Industrial circular saw: dark steel, hooked teeth, cut-outs, bolted hub
function makeSawCanvas() {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    const R = 60, r = 50, teeth = 28;
    // Hooked teeth
    g.beginPath();
    for (let i = 0; i < teeth; i++) {
        const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.72) / teeth) * Math.PI * 2, a2 = ((i + 0.78) / teeth) * Math.PI * 2;
        g.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
        g.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);          // sharp tip
        g.lineTo(Math.cos(a2) * (r + 2), Math.sin(a2) * (r + 2));
    }
    g.closePath();
    const steel = g.createLinearGradient(-R, -R, R, R);
    steel.addColorStop(0, '#e9edf2'); steel.addColorStop(0.35, '#8d96a2'); steel.addColorStop(0.55, '#c7ced7');
    steel.addColorStop(0.8, '#5d6570'); steel.addColorStop(1, '#a8b0ba');
    g.fillStyle = steel; g.fill();
    g.strokeStyle = '#2c3138'; g.lineWidth = 1.2; g.stroke();
    // Bright honed edge on the tips
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, R - 3, 0, Math.PI * 2); g.stroke();
    // Darker blued body with grinding marks
    const body = g.createRadialGradient(-10, -10, 4, 0, 0, r);
    body.addColorStop(0, '#6a737f'); body.addColorStop(0.7, '#3d434c'); body.addColorStop(1, '#2a2e35');
    g.fillStyle = body; g.beginPath(); g.arc(0, 0, r - 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    for (let k = 14; k < r - 8; k += 4) { g.beginPath(); g.arc(0, 0, k, 0, Math.PI * 2); g.stroke(); }
    // Curved expansion slots
    g.strokeStyle = '#14171b'; g.lineWidth = 3; g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.beginPath(); g.arc(0, 0, r - 16, a, a + 0.55); g.stroke();
    }
    // Hub + bolts
    const hub = g.createRadialGradient(-3, -3, 1, 0, 0, 13);
    hub.addColorStop(0, '#d9dee5'); hub.addColorStop(1, '#4b525c');
    g.fillStyle = hub; g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a1d21';
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        g.beginPath(); g.arc(Math.cos(a) * 8, Math.sin(a) * 8, 2, 0, Math.PI * 2); g.fill();
    }
    g.beginPath(); g.arc(0, 0, 3.5, 0, Math.PI * 2); g.fill();
    return c;
}

// Motion-blur halo drawn under a spinning saw
function makeSawBlurCanvas() {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, 63);
    grd.addColorStop(0, 'rgba(200,210,220,0)');
    grd.addColorStop(0.6, 'rgba(220,228,236,0.45)');
    grd.addColorStop(0.85, 'rgba(255,255,255,0.25)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(S / 2, S / 2, 63, 0, Math.PI * 2); g.fill();
    return c;
}

// Glossy balloon (white, tinted per balloon)
function makeBalloonCanvas() {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = S; c.height = S + 10;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S * 0.38, S * 0.34, 3, S / 2, S / 2, S * 0.48);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, '#f2f2f2'); grd.addColorStop(1, '#9a9a9a');
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(S / 2, S / 2, S * 0.44, S * 0.48, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(S / 2 - 5, S * 0.97); g.lineTo(S / 2 + 5, S * 0.97); g.lineTo(S / 2, S * 0.9); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.ellipse(S * 0.36, S * 0.3, S * 0.09, S * 0.14, -0.5, 0, Math.PI * 2); g.fill();
    return c;
}
const BALLOON_COLORS = [0xff4d6d, 0xffc93d, 0x3ddc84, 0x2fb6ff, 0xb46bff, 0xff8a3d];

function mixColor(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

function makeCrateCanvas() {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#8a5a2b'; g.fillRect(4, 4, S - 8, S - 8);
    g.strokeStyle = '#5a3816'; g.lineWidth = 4; g.strokeRect(4, 4, S - 8, S - 8);
    g.strokeStyle = '#6e4520'; g.lineWidth = 3;
    for (const y of [20, 32, 44]) { g.beginPath(); g.moveTo(6, y); g.lineTo(S - 6, y); g.stroke(); }
    g.strokeStyle = '#c8933f'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(8, 8); g.lineTo(S - 8, S - 8); g.moveTo(S - 8, 8); g.lineTo(8, S - 8); g.stroke();
    return c;
}

function makeChuteCanvas() {
    const S = 140;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const r = S / 2 - 4, n = 8;
    for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? '#f2f2f2' : '#e0482f';
        g.beginPath(); g.moveTo(S / 2, S / 2);
        g.arc(S / 2, S / 2, r, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
        g.closePath(); g.fill();
    }
    const sh = g.createRadialGradient(S / 2 - 12, S / 2 - 12, 4, S / 2, S / 2, r);
    sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = sh; g.beginPath(); g.arc(S / 2, S / 2, r, 0, Math.PI * 2); g.fill();
    return c;
}

// Soft radial puff (white → transparent), tinted per emitter.
function makePuffCanvas() {
    const s = 64;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return c;
}

// Powerup identity: color, short label, and an icon drawer (white on badge).
const POWERUP_META = {
    SpeedBoost: { color: '#3fa9ff', label: 'SPEED!', icon: (c, s) => { // lightning bolt
        c.beginPath(); c.moveTo(s * 0.56, s * 0.2); c.lineTo(s * 0.34, s * 0.54);
        c.lineTo(s * 0.48, s * 0.54); c.lineTo(s * 0.42, s * 0.8); c.lineTo(s * 0.68, s * 0.44);
        c.lineTo(s * 0.52, s * 0.44); c.closePath(); c.fill();
    } },
    Shield: { color: '#2fd0d0', label: 'SHIELD!', icon: (c, s) => { // shield
        c.beginPath(); c.moveTo(s * 0.5, s * 0.2); c.lineTo(s * 0.74, s * 0.3);
        c.lineTo(s * 0.74, s * 0.52); c.quadraticCurveTo(s * 0.74, s * 0.72, s * 0.5, s * 0.82);
        c.quadraticCurveTo(s * 0.26, s * 0.72, s * 0.26, s * 0.52); c.lineTo(s * 0.26, s * 0.3);
        c.closePath(); c.fill();
    } },
    MegaPush: { color: '#ff4a5a', label: 'MEGA!', icon: (c, s) => { // double up-chevron
        for (const off of [0, 0.22]) {
            c.beginPath(); c.moveTo(s * 0.5, s * (0.24 + off)); c.lineTo(s * 0.72, s * (0.46 + off));
            c.lineTo(s * 0.62, s * (0.46 + off)); c.lineTo(s * 0.5, s * (0.34 + off));
            c.lineTo(s * 0.38, s * (0.46 + off)); c.lineTo(s * 0.28, s * (0.46 + off));
            c.closePath(); c.fill();
        }
    } },
    Magnet: { color: '#e8a030', label: 'MAGNET!', icon: (c, s) => { // horseshoe magnet
        c.lineWidth = s * 0.14; c.strokeStyle = c.fillStyle;
        c.beginPath(); c.arc(s * 0.5, s * 0.46, s * 0.22, Math.PI, Math.PI * 2); c.stroke();
        c.fillRect(s * 0.21, s * 0.46, s * 0.14, s * 0.22);
        c.fillRect(s * 0.65, s * 0.46, s * 0.14, s * 0.22);
    } },
    Oil: { color: '#b08a52', label: 'OIL!', icon: (c, s) => { // droplet
        c.beginPath(); c.moveTo(s * 0.5, s * 0.22);
        c.quadraticCurveTo(s * 0.74, s * 0.56, s * 0.5, s * 0.8);
        c.quadraticCurveTo(s * 0.26, s * 0.56, s * 0.5, s * 0.22); c.closePath(); c.fill();
    } },
    Repair: { color: '#2fbf5f', label: '+40 HEALTH', icon: (c, s) => { // first-aid cross
        c.fillRect(s * 0.42, s * 0.24, s * 0.16, s * 0.52);
        c.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.16);
    } },
    Blades: { color: '#8f9aa8', label: 'BLADES!', icon: (c, s) => { // saw blade
        c.beginPath();
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2, r = i % 2 ? s * 0.2 : s * 0.29;
            c.lineTo(s * 0.5 + Math.cos(a) * r, s * 0.5 + Math.sin(a) * r);
        }
        c.closePath(); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.45)';
        c.beginPath(); c.arc(s * 0.5, s * 0.5, s * 0.07, 0, Math.PI * 2); c.fill();
    } },
    Bumper: { color: '#ff5fa2', label: 'BALLOONS!', icon: (c, s) => { // three balloons
        for (const [x, y, r] of [[0.36, 0.4, 0.13], [0.62, 0.36, 0.14], [0.5, 0.56, 0.12]]) {
            c.beginPath(); c.arc(s * x, s * y, s * r, 0, Math.PI * 2); c.fill();
        }
        c.lineWidth = s * 0.03; c.strokeStyle = c.fillStyle;
        c.beginPath(); c.moveTo(s * 0.36, s * 0.53); c.lineTo(s * 0.5, s * 0.82); c.lineTo(s * 0.62, s * 0.5);
        c.moveTo(s * 0.5, s * 0.68); c.lineTo(s * 0.5, s * 0.82); c.stroke();
    } },
    Reverse: { color: '#a24aff', label: 'REVERSE!', icon: (c, s) => { // circular arrows
        c.lineWidth = s * 0.1; c.strokeStyle = c.fillStyle;
        c.beginPath(); c.arc(s * 0.5, s * 0.5, s * 0.2, 0.5, Math.PI * 1.7); c.stroke();
        c.beginPath(); c.moveTo(s * 0.5 + 0.2 * s * Math.cos(1.7 * Math.PI), s * 0.5 + 0.2 * s * Math.sin(1.7 * Math.PI));
        c.lineTo(s * 0.72, s * 0.34); c.lineTo(s * 0.64, s * 0.5); c.closePath(); c.fill();
    } },
};

function makePowerupCanvas(type) {
    const s = 64;
    const meta = POWERUP_META[type] || POWERUP_META.SpeedBoost;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    // Round badge with glow ring
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(s / 2, s * 0.4, 2, s / 2, s / 2, s * 0.44);
    g.addColorStop(0, meta.color);
    g.addColorStop(1, shadeHex(meta.color, -60));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); ctx.stroke();
    // Icon
    ctx.fillStyle = '#ffffff';
    meta.icon(ctx, s);
    return c;
}

function shadeHex(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return `rgb(${r},${g},${b})`;
}

// Small hard spark dot.
function makeSparkCanvas() {
    const s = 16;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return c;
}

class ArenaScene extends Phaser.Scene {
    constructor(store) {
        super('arena');
        this.store = store;              // { snapshot, localId }
        this.carSprites = new Map();     // id → { sprite, label }
    }

    // Car texture for a model + build + damage stage (drawn once, then reused)
    carTexture(type, cos, stage) {
        const key = lookKey(type, cos, stage);
        if (!this.textures.exists(key)) this.textures.addCanvas(key, renderCar(type, cos, { stage }));
        return key;
    }

    create() {
        for (const t of Object.keys(TYPE_SIZE)) {
            this.textures.addCanvas(`sh_${t}`, renderShadow(t));
            this.textures.addCanvas(`brk_${t}`, renderBrakeGlow(t));
        }
        this.textures.addCanvas('beam', makeBeamCanvas());
        this.textures.addCanvas('uglow', makeUnderglowCanvas());
        // Topper textures (hats) drawn from the shared cosmetics art
        for (const t of TOPPERS) {
            if (t.key === 'none') continue;
            const TS = 96;
            const tc = document.createElement('canvas');
            tc.width = tc.height = TS;
            const tctx = tc.getContext('2d');
            tctx.translate(TS / 2, TS / 2 + 8);
            tctx.rotate(-Math.PI / 2);   // topper art faces +x; sprite faces up
            tctx.scale(2.2, 2.2);
            drawTopper(tctx, t.key);
            this.textures.addCanvas(`top_${t.key}`, tc);
        }

        // Powerup icon textures
        for (const type of Object.keys(POWERUP_META)) {
            this.textures.addCanvas(`pu_${type}`, makePowerupCanvas(type));
        }
        this.puSprites = new Map();
        this.textures.addCanvas('plane', makePlaneCanvas());
        this.textures.addCanvas('crate', makeCrateCanvas());
        this.textures.addCanvas('chute', makeChuteCanvas());
        this.planeSprites = new Map();
        this.textures.addCanvas('rocket', makeRocketCanvas());
        this.textures.addCanvas('saw', makeSawCanvas());
        this.textures.addCanvas('sawBlur', makeSawBlurCanvas());
        this.textures.addCanvas('balloon', makeBalloonCanvas());
        this.bladeGfx = this.add.graphics().setDepth(5.05);
        this.rocketSprites = new Map();

        // Asphalt ground as a large tiled sprite centered on the world origin
        this.textures.addCanvas('asphalt', makeAsphaltCanvas());
        const W = 6000;
        this.ground = this.add.tileSprite(0, 0, W, W, 'asphalt').setOrigin(0.5);
        this.ground.setDepth(-10);

        // Arena decorations drawn on a graphics layer
        this.arenaGfx = this.add.graphics().setDepth(-5);
        this.lastArenaR = 0;

        // Tire marks layer (persistent-ish, drawn under cars)
        this.tireGfx = this.add.graphics().setDepth(-4);
        this.ringGfx = this.add.graphics().setDepth(3);      // glow ring under each car
        this.arrowGfx = this.add.graphics().setDepth(40);    // edge arrows to off-screen rivals
        this.tireMarks = [];

        // Dynamic layers
        this.hazardGfx = this.add.graphics().setDepth(-3);
        this.powerupGfx = this.add.graphics().setDepth(1);
        this.projectileGfx = this.add.graphics().setDepth(2);

        // ─── Particle textures + emitters ───────────────────────────────
        this.textures.addCanvas('puff', makePuffCanvas());
        this.textures.addCanvas('spark', makeSparkCanvas());

        this.smoke = this.add.particles(0, 0, 'puff', {
            speed: { min: 8, max: 45 }, angle: { min: 0, max: 360 },
            scale: { start: 0.45, end: 1.3 }, alpha: { start: 0.45, end: 0 },
            lifespan: 650, tint: 0x9a9a9a, blendMode: 'NORMAL', emitting: false,
        }).setDepth(3);

        this.flame = this.add.particles(0, 0, 'puff', {
            speed: { min: 20, max: 90 }, angle: { min: 0, max: 360 },
            scale: { start: 0.6, end: 0 }, alpha: { start: 0.9, end: 0 },
            lifespan: 340, tint: [0xffe18a, 0xff9d2a, 0xff5a1a], blendMode: 'ADD', emitting: false,
        }).setDepth(3);

        this.spark = this.add.particles(0, 0, 'spark', {
            speed: { min: 90, max: 300 }, angle: { min: 0, max: 360 },
            scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 },
            lifespan: 420, gravityY: 320, tint: [0xfff1a0, 0xffbb33, 0xff8822],
            blendMode: 'ADD', emitting: false,
        }).setDepth(8);

        // Damage + explosion effects
        this.darkSmoke = this.add.particles(0, 0, 'puff', {
            speed: { min: 10, max: 40 }, angle: { min: 0, max: 360 }, gravityY: -25,
            scale: { start: 0.55, end: 2.3 }, alpha: { start: 0.75, end: 0 },
            lifespan: 1400, tint: 0x3b3836, blendMode: 'NORMAL', emitting: false,
        }).setDepth(7);
        this.fire = this.add.particles(0, 0, 'puff', {
            speed: { min: 15, max: 60 }, angle: { min: 0, max: 360 }, gravityY: -40,
            scale: { start: 0.55, end: 0 }, alpha: { start: 0.95, end: 0 },
            lifespan: 450, tint: [0xffe08a, 0xff9d2a, 0xff4a1a], blendMode: 'ADD', emitting: false,
        }).setDepth(7.5);
        this.blast = this.add.particles(0, 0, 'puff', {
            speed: { min: 60, max: 340 }, angle: { min: 0, max: 360 },
            scale: { start: 1.3, end: 0 }, alpha: { start: 1, end: 0 },
            lifespan: 520, tint: [0xfff3b0, 0xffb347, 0xff5a1a, 0xd62a12], blendMode: 'ADD', emitting: false,
        }).setDepth(9);
        this.rocketTrail = this.add.particles(0, 0, 'puff', {
            speed: { min: 2, max: 18 }, angle: { min: 0, max: 360 },
            scale: { start: 0.28, end: 0.9 }, alpha: { start: 0.45, end: 0 },
            lifespan: 700, tint: 0xcfcfcf, blendMode: 'NORMAL', emitting: false,
        }).setDepth(5.5);
        this.confetti = this.add.particles(0, 0, 'spark', {
            speed: { min: 80, max: 260 }, angle: { min: 0, max: 360 }, gravityY: 120,
            scale: { start: 0.8, end: 0.2 }, alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 360 },
            lifespan: 700, tint: BALLOON_COLORS, blendMode: 'NORMAL', emitting: false,
        }).setDepth(8);
        this.hpGfx = this.add.graphics().setDepth(8);
        this.lockGfx = this.add.graphics().setDepth(8.5);
        this.boomGfx = this.add.graphics().setDepth(9.5);
        this.booms = [];

        // Camera
        this.cameras.main.setBackgroundColor('#0a0d13');
        this.zoom = this.baseZoom();
        this.cameras.main.setZoom(this.zoom);

        // ─── Event FX ────────────────────────────────────────────────────
        this._onCollision = (p) => {
            if (p && p.type === 'balloon') {          // boing: wobble the balloons, puff of confetti, no sparks
                const owner = p.ids && this.carSprites.get(p.ids[1]);
                if (owner) owner.squishAt = this.time.now;
                if (typeof p.x === 'number') this.confetti.emitParticleAt(p.x, p.y, 14);
                const focus = this.store.followId || this.store.localId;
                if (p.ids && p.ids[0] === focus) this.cameras.main.shake(140, 0.008);
                return;
            }
            // Shake only for hits on the car the camera is following
            const focus = this.store.followId || this.store.localId;
            if (p && Array.isArray(p.ids) && p.ids.includes(focus)) {
                const intensity = Math.min(0.022, (p.impact || 10) / 1400);
                this.cameras.main.shake(180, intensity);
            }
            if (p && typeof p.x === 'number') {
                const n = Math.min(24, 6 + Math.round((p.impact || 10) / 6));
                this.spark.emitParticleAt(p.x, p.y, n);
                this.smoke.emitParticleAt(p.x, p.y, 4);
            }
        };
        this._onEliminated = ({ id }) => {
            const e = this.carSprites.get(id);
            if (!e) return;
            this.spark.emitParticleAt(e.x, e.y, 28);
            this.smoke.emitParticleAt(e.x, e.y, 22);
            if (id === this.store.localId) this.cameras.main.shake(220, 0.012);
        };
        this._onPickup = ({ playerId, type }) => {
            const e = this.carSprites.get(playerId);
            const meta = POWERUP_META[type];
            if (!e || !meta) return;
            const t = this.add.text(e.x, e.y - 40, meta.label, {
                fontFamily: 'Arial, sans-serif', fontStyle: 'bold', fontSize: '20px',
                color: meta.color, stroke: '#000', strokeThickness: 4,
            }).setOrigin(0.5).setDepth(20);
            this.tweens.add({
                targets: t, y: e.y - 85, alpha: 0, duration: 850, ease: 'Cubic.Out',
                onComplete: () => t.destroy(),
            });
        };
        this._onExplosion = ({ x, y, big, ids }) => {
            const n = big ? 60 : 36;
            this.blast.emitParticleAt(x, y, n);
            this.darkSmoke.emitParticleAt(x, y, big ? 26 : 14);
            this.spark.emitParticleAt(x, y, big ? 30 : 18);
            this.booms.push({ x, y, t: 0, r: big ? 170 : 130 });
            const focus = this.store.followId || this.store.localId;
            const me = this.carSprites.get(focus);
            const near = me ? Math.hypot(me.x - x, me.y - y) : 9999;
            if ((ids && ids.includes(focus)) || near < 260) this.cameras.main.shake(260, big ? 0.02 : 0.014);
            else if (near < 700) this.cameras.main.shake(160, 0.005);
        };
        socket.on('explosion', this._onExplosion);
        socket.on('collision', this._onCollision);
        socket.on('playerEliminated', this._onEliminated);
        socket.on('powerupCollected', this._onPickup);
    }

    // Zoom so a phone sees a useful slice of the arena (not just its own car)
    baseZoom() {
        const m = Math.min(this.scale.width, this.scale.height);
        return Math.max(0.62, Math.min(1.0, m / 560));
    }

    drawArena(radius, base, electric, time, locked = false) {
        const g = this.arenaGfx;
        g.clear();
        // Closed-off ground outside the fence
        g.lineStyle(3000, 0x05070b, 0.62);
        g.strokeCircle(0, 0, radius + 1530);
        // Where the fence started (fades as the arena closes in)
        if (base && radius < base - 4) {
            g.lineStyle(3, 0xffb347, 0.22);
            g.strokeCircle(0, 0, base);
        }
        // Painted markings
        g.lineStyle(2, 0xffffff, 0.06);
        g.strokeCircle(0, 0, Math.min(radius, base || radius) * 0.5);
        g.strokeCircle(0, 0, 70);

        // Red / white kerb just inside the fence
        const kerbR = radius - 8;
        const segs = Math.max(24, Math.round((2 * Math.PI * kerbR) / 46));
        const step = (Math.PI * 2) / segs;
        for (let i = 0; i < segs; i++) {
            g.lineStyle(14, electric ? (i % 2 ? 0x0c3550 : 0x1a6c94) : (i % 2 ? 0xf1f1f1 : 0xd6312f), 1);
            g.beginPath();
            g.arc(0, 0, kerbR, i * step, (i + 1) * step);
            g.strokePath();
        }
        // Barrier wall (shadow, body, highlight)
        g.lineStyle(18, 0x000000, 0.35);
        g.strokeCircle(0, 0, radius + 14);
        g.lineStyle(12, electric ? 0x173246 : 0x59606b, 1);
        g.strokeCircle(0, 0, radius + 9);
        g.lineStyle(3, electric ? 0x9fe9ff : 0xa9b0bb, 1);
        g.strokeCircle(0, 0, radius + 4);
        if (locked) {          // start of round: fence locked — glows green
            const pulse = 0.5 + 0.3 * Math.sin(time * 0.008);
            g.lineStyle(20, 0x3ddc84, 0.2 * pulse);
            g.strokeCircle(0, 0, radius + 6);
            g.lineStyle(4, 0x9dffc4, pulse);
            g.strokeCircle(0, 0, radius + 4);
        }
        if (electric) {
            const pulse = 0.45 + 0.35 * Math.sin(time * 0.012);
            g.lineStyle(22, 0x4fd8ff, 0.18 * pulse);
            g.strokeCircle(0, 0, radius + 6);
            g.lineStyle(4, 0xe8fbff, pulse);
            g.strokeCircle(0, 0, radius + 4);
        }
    }

    ensureSprite(p) {
        let entry = this.carSprites.get(p.id);
        if (!entry) {
            const type = TYPE_SIZE[p.carType] ? p.carType : 'sports';
            const glow = this.add.image(p.x, p.y, 'uglow').setDepth(3.5).setBlendMode('ADD').setVisible(false);
            const shadow = this.add.image(p.x, p.y, `sh_${type}`).setDepth(4).setAlpha(0.45);
            const beam = this.add.image(p.x, p.y, 'beam').setDepth(4.5).setBlendMode('ADD').setAlpha(0.13).setOrigin(0.5, 1);
            const sprite = this.add.sprite(p.x, p.y, this.carTexture(type, p.cosmetics || fallbackLook(p.id), 0));
            sprite.setDepth(5);
            const brake = this.add.image(p.x, p.y, `brk_${type}`).setDepth(5.1).setBlendMode('ADD')
                .setOrigin(0.5, (CAR_TEX_H / 2) / (CAR_TEX_H + 40)).setVisible(false);
            const topper = this.add.sprite(p.x, p.y, 'top_crown').setDepth(6).setVisible(false);
            const label = this.add.text(p.x, p.y, p.name || '', {
                fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#fff',
                stroke: '#000', strokeThickness: 3,
            }).setOrigin(0.5, 1).setDepth(7);
            const saws = [0, 1].map(() => this.add.image(p.x, p.y, 'saw').setDepth(5.2).setVisible(false));
            const sawBlurs = [0, 1].map(() => this.add.image(p.x, p.y, 'sawBlur').setDepth(5.15).setVisible(false));
            const balloons = BALLOON_COLORS.map(col => this.add.image(p.x, p.y, 'balloon').setDepth(6.2).setTint(col).setVisible(false));
            entry = { sprite, shadow, glow, beam, brake, type, topper, label, saws, sawBlurs, balloons, squishAt: -1e9, texKey: null, x: p.x, y: p.y, a: p.angle, topperKey: null, skidL: null, skidR: null };
            this.carSprites.set(p.id, entry);
        }
        return entry;
    }

    // Lazily-created flame emitter per trail color (so each car's trail is its own color)
    getFlame(colorInt) {
        if (!this._flameByColor) this._flameByColor = new Map();
        let em = this._flameByColor.get(colorInt);
        if (!em) {
            em = this.add.particles(0, 0, 'puff', {
                speed: { min: 20, max: 90 }, angle: { min: 0, max: 360 },
                scale: { start: 0.6, end: 0 }, alpha: { start: 0.9, end: 0 },
                lifespan: 340, tint: colorInt, blendMode: 'ADD', emitting: false,
            }).setDepth(3);
            this._flameByColor.set(colorInt, em);
        }
        return em;
    }

    update(time, delta) {
        net.step(delta);                          // advance your predicted car
        const snap = net.snap || this.store.snapshot;
        if (!snap || !snap.players) return;

        const arenaR = snap.arenaRadius || 1000;
        if (Math.abs(arenaR - this.lastArenaR) > 0.5 || snap.suddenDeath || snap.fenceLock > 0 || this.wasLocked) {
            this.wasLocked = snap.fenceLock > 0;
            this.drawArena(arenaR, snap.arenaBase || arenaR, !!snap.suddenDeath, time, snap.fenceLock > 0);
            this.lastArenaR = arenaR;
        }

        const k = 1 - Math.pow(0.000001, delta / 1000); // smoothing factor (snappy, still filters jitter)
        const seen = new Set();

        for (const p of snap.players) {
            seen.add(p.id);
            const e = this.ensureSprite(p);

            // Your car: predicted locally; others: extrapolated + smoothed
            const rs = net.renderState(p.id, delta);
            if (rs) { e.x = rs.x; e.y = rs.y; e.a = rs.angle; }
            else {
                e.x += (p.x - e.x) * k;
                e.y += (p.y - e.y) * k;
                e.a = p.angle;
            }
            const isLocal = p.id === this.store.localId && net.local;
            const dashing = isLocal ? net.local.nitro > 0 : p.isDashing;
            const skidding = isLocal ? net.local.skid : p.skid;

            const sizeMult = (TYPE_SIZE[p.carType] || 1) * (p.scale || 1);
            const scale = CAR_SCALE * sizeMult;
            const rot = e.a + Math.PI / 2;   // sprite faces up; angle 0 = +x
            // health as a % of this car's own maximum (tough cars have more)
            const maxHp = (CAR_TYPES[p.carType] || {}).hp || 100;
            const hp = ((p.hp ?? maxHp) / maxHp) * 100;
            const wrecked = !p.alive && hp <= 0;          // blown up, not pushed out
            const cos = p.cosmetics || fallbackLook(p.id);

            // Body: the car's own build, redrawn with dents / cracks / scorch as it takes damage
            const stage = wrecked || hp < 22 ? 3 : hp < 45 ? 2 : hp < 70 ? 1 : 0;
            const texKey = this.carTexture(e.type, cos, stage);
            if (texKey !== e.texKey) { e.sprite.setTexture(texKey); e.texKey = texKey; }
            e.sprite.setScale(scale).setPosition(e.x, e.y).setRotation(rot);
            e.sprite.setAlpha(p.alive || wrecked ? 1 : 0.35);
            const dmg = 1 - Math.max(0, Math.min(100, hp)) / 100;
            e.sprite.setTint(wrecked ? 0x4a4440 : p.alive ? mixColor(0xffffff, 0x9a9590, dmg * 0.5) : 0x888888);
            e.shadow.setScale(scale).setPosition(e.x + 5, e.y + 8).setRotation(rot).setVisible(p.alive || wrecked);
            e.tintInt = hexToInt(resolveLook(e.type, cos).paint);

            // Brake lights glow when braking; headlights throw a beam ahead
            const isMeNow = p.id === this.store.localId;
            const braking = p.alive && (isMeNow && net.local ? net.cur.forward < -0.05 : p.braking);
            e.brake.setVisible(braking).setScale(scale).setPosition(e.x, e.y).setRotation(rot);
            const fx = Math.cos(e.a), fy = Math.sin(e.a);
            e.beam.setVisible(p.alive).setScale(0.55 * sizeMult).setRotation(rot)
                .setPosition(e.x + fx * 44 * sizeMult, e.y + fy * 44 * sizeMult)
                .setAlpha(stage >= 2 ? 0.06 : 0.13);
            // Neon underglow
            const ug = underglowColor(cos.underglow);
            e.glow.setVisible(!!ug && p.alive);
            if (ug && p.alive) {
                e.glow.setTint(hexToInt(ug)).setScale(0.5 * sizeMult).setRotation(rot).setPosition(e.x, e.y)
                    .setAlpha(0.5 + 0.15 * Math.sin(time * 0.006 + hashId(p.id)));
            }
            e.hp = hp; e.wrecked = wrecked;
            e.alive = p.alive;
            e.isMe = p.id === this.store.localId;
            e.sizeMult = sizeMult;

            // Topper (hat) overlay
            const topKey = (cos && cos.topper && cos.topper !== 'none') ? cos.topper : null;
            if (topKey !== e.topperKey) {
                if (topKey) { e.topper.setTexture(`top_${topKey}`); e.topper.setVisible(true); }
                else e.topper.setVisible(false);
                e.topperKey = topKey;
            }
            if (topKey) {
                e.topper.setPosition(e.x, e.y);
                e.topper.setRotation(rot);
                e.topper.setScale(TOPPER_SCALE * sizeMult);
                e.topper.setVisible(p.alive);
            }

            // Labels stay a readable size on screen whatever the zoom
            e.label.setScale(0.9 / this.zoom);
            e.label.setPosition(e.x, e.y - 50 * sizeMult - 6 / this.zoom);
            const watched = p.id !== this.store.localId && p.id === this.store.followId;
            e.label.setText(p.id === this.store.localId ? `★ ${p.name || ''}` : watched ? `👁 ${p.name || ''}` : (p.name || ''));
            e.label.setColor(p.id === this.store.localId ? '#8fe3ff' : watched ? '#ffd27a' : '#ffffff');
            e.label.setVisible(p.alive);

            // ─── Damage smoke / fire from the engine bay ───────────────
            if (p.alive || wrecked) {
                const hx = e.x + Math.cos(e.a) * 26 * sizeMult, hy = e.y + Math.sin(e.a) * 26 * sizeMult;
                const tk = this._tick || 0;
                if (wrecked) {
                    if (tk % 2 === 0) this.darkSmoke.emitParticleAt(e.x, e.y, 1);
                    if (tk % 3 === 0) this.fire.emitParticleAt(e.x + (Math.random() - 0.5) * 30, e.y + (Math.random() - 0.5) * 30, 1);
                } else if (hp < 22) {
                    if (tk % 2 === 0) this.fire.emitParticleAt(hx, hy, 1);
                    if (tk % 3 === 0) this.darkSmoke.emitParticleAt(hx, hy, 1);
                    if (tk % 40 === 0) this.spark.emitParticleAt(hx, hy, 3);
                } else if (hp < 45) {
                    if (tk % 4 === 0) this.darkSmoke.emitParticleAt(hx, hy, 1);
                    if (tk % 70 === 0) this.spark.emitParticleAt(hx, hy, 2);
                } else if (hp < 70) {
                    if (tk % 7 === 0) this.smoke.emitParticleAt(hx, hy, 1);
                }
            }

            // ─── Spinning saw blades (power-up) on steel arms, both sides ─
            // (they flicker in the last 1.5 s so you know they're running out)
            const bladeLeft = p.bladeLeft || 0;
            const bladesOn = p.alive && p.blades && !(bladeLeft < 1.5 && Math.floor(time / 110) % 2 === 0);
            e.bladeArms = null;
            for (let i = 0; i < 2; i++) {
                const saw = e.saws[i], blur = e.sawBlurs[i];
                saw.setVisible(bladesOn); blur.setVisible(bladesOn);
                if (!bladesOn) continue;
                const side = i ? 1 : -1, off = 44 * sizeMult;
                const fwd = 12 * sizeMult;
                const sx = e.x + Math.cos(e.a) * fwd - Math.sin(e.a) * off * side;
                const sy = e.y + Math.sin(e.a) * fwd + Math.cos(e.a) * off * side;
                saw.setPosition(sx, sy).setScale(0.5 * sizeMult);
                blur.setPosition(sx, sy).setScale(0.52 * sizeMult).setAlpha(0.7 + 0.3 * Math.random());
                saw.rotation += (side * delta) / 1000 * 30;
                // arm from the car's side to the blade hub
                const ax0 = e.x + Math.cos(e.a) * fwd - Math.sin(e.a) * 18 * sizeMult * side;
                const ay0 = e.y + Math.sin(e.a) * fwd + Math.cos(e.a) * 18 * sizeMult * side;
                (e.bladeArms = e.bladeArms || []).push([ax0, ay0, sx, sy]);
                // shower of sparks off the spinning teeth
                if (((this._tick || 0) + i) % 5 === 0) {
                    const ta = Math.random() * Math.PI * 2;
                    this.spark.emitParticleAt(sx + Math.cos(ta) * 28 * sizeMult, sy + Math.sin(ta) * 28 * sizeMult, 1);
                }
            }

            // ─── Bouncy balloons (power-up) floating on strings around the car
            const bumperLeft = p.bumperLeft || 0;
            const balloonsOn = p.alive && p.bumper && !(bumperLeft < 1.5 && Math.floor(time / 110) % 2 === 0);
            e.balloonPts = null;
            const squish = Math.max(0, 1 - (time - e.squishAt) / 260);       // wobble after a bounce
            for (let i = 0; i < e.balloons.length; i++) {
                const b = e.balloons[i];
                b.setVisible(balloonsOn);
                if (!balloonsOn) continue;
                const a = time * 0.0009 + (i / e.balloons.length) * Math.PI * 2;
                const rr = (62 + 3 * Math.sin(time * 0.004 + i)) * sizeMult;
                const bx = e.x + Math.cos(a) * rr, by = e.y + Math.sin(a) * rr * 0.92;
                const sc = 0.5 * sizeMult * (1 + 0.25 * squish * Math.sin(time * 0.05 + i));
                b.setPosition(bx, by).setScale(sc, sc * (1 - 0.15 * squish)).setRotation(a + Math.PI / 2);
                (e.balloonPts = e.balloonPts || []).push([bx, by]);
            }

            // ─── Exhaust / smoke / tire marks ───────────────────────────
            if (p.alive) {
                const rearLen = 24 * sizeMult;
                const rx = e.x - Math.cos(e.a) * rearLen;
                const ry = e.y - Math.sin(e.a) * rearLen;

                const trailFlame = this.getFlame(cssToInt(trailColor(cos ? cos.trail : 'classic', time)));
                if (dashing) {
                    trailFlame.emitParticleAt(rx, ry, 3);
                    if (this._tick % 2 === 0) this.smoke.emitParticleAt(rx, ry, 1);
                } else if (p.speedMult > 1 && this._tick % 2 === 0) {
                    trailFlame.emitParticleAt(rx, ry, 1);
                }

                // Skid marks: continuous streaks from both rear tyres
                if (skidding || dashing || p.slip > 0) {
                    const ax = e.x - Math.cos(e.a) * 28 * sizeMult, ay = e.y - Math.sin(e.a) * 28 * sizeMult;
                    const px = -Math.sin(e.a) * 17 * sizeMult, py = Math.cos(e.a) * 17 * sizeMult;
                    const L = [ax + px, ay + py], R = [ax - px, ay - py];
                    if (e.skidL) {
                        this.tireMarks.push({ x1: e.skidL[0], y1: e.skidL[1], x2: L[0], y2: L[1], life: 1 });
                        this.tireMarks.push({ x1: e.skidR[0], y1: e.skidR[1], x2: R[0], y2: R[1], life: 1 });
                    }
                    e.skidL = L; e.skidR = R;
                    if (skidding && this._tick % 4 === 0) this.smoke.emitParticleAt(ax, ay, 1);
                } else {
                    e.skidL = e.skidR = null;
                }
            }
        }

        // Fade + draw tire marks
        this._tick = (this._tick || 0) + 1;
        const tg = this.tireGfx;
        tg.clear();
        for (let i = this.tireMarks.length - 1; i >= 0; i--) {
            const m = this.tireMarks[i];
            m.life -= 0.004;
            if (m.life <= 0) { this.tireMarks.splice(i, 1); continue; }
            tg.lineStyle(5, 0x000000, 0.22 * m.life);
            tg.beginPath(); tg.moveTo(m.x1, m.y1); tg.lineTo(m.x2, m.y2); tg.strokePath();
        }
        if (this.tireMarks.length > 900) this.tireMarks.splice(0, this.tireMarks.length - 900);

        // Remove sprites for players no longer present
        for (const [id, e] of this.carSprites) {
            if (!seen.has(id)) {
                e.sprite.destroy(); e.shadow.destroy(); e.label.destroy(); e.topper && e.topper.destroy();
                e.glow.destroy(); e.beam.destroy(); e.brake.destroy();
                e.saws.forEach(sw => sw.destroy());
                e.balloons.forEach(b => b.destroy());
                e.sawBlurs.forEach(sw => sw.destroy());
                this.carSprites.delete(id);
            }
        }

        // ─── Camera: follows your car (or the one you spectate), looks ahead
        // in the direction of travel and pulls back a little at speed ──────
        const cam = this.cameras.main;
        const focusId = this.store.followId || this.store.localId;
        const me = this.carSprites.get(focusId);
        const dt = Math.max(0.001, delta / 1000);
        if (me) {
            if (this.camX === undefined || this.focusId !== focusId) {
                if (this.camX === undefined) { this.camX = me.x; this.camY = me.y; }
                this.focusId = focusId;
                this.lastFx = me.x; this.lastFy = me.y; this.velX = 0; this.velY = 0;
            }
            const vx = (me.x - this.lastFx) / dt, vy = (me.y - this.lastFy) / dt;
            this.lastFx = me.x; this.lastFy = me.y;
            if (Math.abs(vx) < 3000 && Math.abs(vy) < 3000) {
                const vk = 1 - Math.pow(0.02, dt);
                this.velX += (vx - this.velX) * vk;
                this.velY += (vy - this.velY) * vk;
            }
            const speed = Math.hypot(this.velX, this.velY);
            const lead = Math.min(170, speed * 0.3) / Math.max(1, speed);
            const tx = me.x + this.velX * lead, ty = me.y + this.velY * lead;
            const ck = 1 - Math.pow(0.004, dt);
            this.camX += (tx - this.camX) * ck;
            this.camY += (ty - this.camY) * ck;

            const targetZoom = this.baseZoom() * (1 - 0.12 * Math.min(1, speed / 550));
            this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 2.5);
            cam.setZoom(this.zoom);
            cam.centerOn(this.camX, this.camY);
        }

        // Glow ring under each car: cyan = you, red = rivals
        const rg = this.ringGfx;
        rg.clear();
        for (const [, e] of this.carSprites) {
            if (!e.alive) continue;
            const r = 50 * (e.sizeMult || 1);
            const col = e.isMe ? 0x4fd8ff : 0xff4d3d;
            rg.fillStyle(col, e.isMe ? 0.16 : 0.12);
            rg.fillCircle(e.x, e.y, r);
            rg.lineStyle(3 / this.zoom, col, e.isMe ? 0.75 : 0.55);
            rg.strokeCircle(e.x, e.y, r);
        }

        // Steel arms holding the saw blades (+ strings for balloons)
        const bgx = this.bladeGfx;
        bgx.clear();
        for (const [, e] of this.carSprites) {
            if (!e.balloonPts) continue;
            bgx.lineStyle(1.5 / this.zoom, 0xffffff, 0.55);
            for (const [bx, by] of e.balloonPts) bgx.lineBetween(e.x, e.y, bx, by);
        }
        for (const [, e] of this.carSprites) {
            if (!e.bladeArms) continue;
            for (const [x0, y0, x1, y1] of e.bladeArms) {
                bgx.lineStyle(9 * (e.sizeMult || 1), 0x1d2127, 1); bgx.lineBetween(x0, y0, x1, y1);
                bgx.lineStyle(4 * (e.sizeMult || 1), 0x7d8794, 1); bgx.lineBetween(x0, y0, x1, y1);
            }
        }

        // Health bars above every car
        const hg2 = this.hpGfx;
        hg2.clear();
        for (const [, e] of this.carSprites) {
            if (!e.alive) continue;
            const hp = Math.max(0, Math.min(100, e.hp ?? 100));
            const w = 50 / this.zoom * 0.85, h = 6 / this.zoom * 0.85;
            const bx = e.x - w / 2, by = e.y - 50 * (e.sizeMult || 1) - 2 / this.zoom;
            hg2.fillStyle(0x000000, 0.6);
            hg2.fillRect(bx - 1.5 / this.zoom, by - 1.5 / this.zoom, w + 3 / this.zoom, h + 3 / this.zoom);
            hg2.fillStyle(hp > 60 ? 0x3ddc84 : hp > 30 ? 0xffc93d : 0xff4d4d, 1);
            hg2.fillRect(bx, by, w * hp / 100, h);
        }

        // Rocket lock-on: the rival your next FIRE will aim at (same rule as the server)
        const lg = this.lockGfx;
        lg.clear();
        const meCar = this.carSprites.get(this.store.localId);
        const meSnap = snap.players.find(q => q.id === this.store.localId);
        if (meCar && meSnap && meSnap.alive && snap.live) {
            const cars = [];
            for (const [id, e] of this.carSprites) cars.push({ id, x: e.x, y: e.y, alive: e.alive });
            const tgt = pickRocketTarget({ id: this.store.localId, x: meCar.x, y: meCar.y, angle: meCar.a }, cars);
            if (tgt) {
                const ready = !(meSnap.shootCooldown > 0);
                const col = ready ? 0xff3d5a : 0x9aa3ad;
                const r = (58 + 4 * Math.sin(time * 0.012)) * ((this.carSprites.get(tgt.id) || {}).sizeMult || 1);
                const spin = time * 0.003;
                lg.lineStyle(3 / this.zoom, col, ready ? 0.95 : 0.5);
                for (let k = 0; k < 4; k++) {            // four bracket arcs
                    const a0 = spin + k * Math.PI / 2;
                    lg.beginPath(); lg.arc(tgt.x, tgt.y, r, a0, a0 + 0.9); lg.strokePath();
                }
                lg.lineStyle(2 / this.zoom, col, ready ? 0.9 : 0.4);
                for (let k = 0; k < 4; k++) {            // tick marks pointing in
                    const a = k * Math.PI / 2 + Math.PI / 4;
                    lg.lineBetween(tgt.x + Math.cos(a) * (r + 10), tgt.y + Math.sin(a) * (r + 10), tgt.x + Math.cos(a) * (r - 8), tgt.y + Math.sin(a) * (r - 8));
                }
            }
        }

        // Explosion flash + shockwave rings
        const bg = this.boomGfx;
        bg.clear();
        for (let i = this.booms.length - 1; i >= 0; i--) {
            const b = this.booms[i];
            b.t += delta / 1000;
            const k2 = b.t / 0.45;
            if (k2 >= 1) { this.booms.splice(i, 1); continue; }
            bg.fillStyle(0xff7a1a, 0.5 * (1 - k2));
            bg.fillCircle(b.x, b.y, b.r * 0.7 * (0.5 + k2));
            bg.fillStyle(0xffe6a0, 0.8 * (1 - k2) * (1 - k2));
            bg.fillCircle(b.x, b.y, b.r * 0.35 * (0.4 + k2));
            bg.lineStyle(6 * (1 - k2) + 1, 0xffe0a0, 0.8 * (1 - k2));
            bg.strokeCircle(b.x, b.y, b.r * (0.3 + k2 * 1.1));
        }

        // Arrows on the screen edge pointing at rivals you can't see
        const ag = this.arrowGfx;
        ag.clear();
        if (me) {
            const halfW = cam.width / 2 / this.zoom, halfH = cam.height / 2 / this.zoom;
            // Keep arrows clear of the HUD: more room at the top (timer, minimap)
            const z = this.zoom, size = 13 / z;
            const limL = halfW - 34 / z, limR = halfW - 34 / z, limT = halfH - 112 / z, limB = halfH - 86 / z;   // clear of the health bar + controls
            for (const [id, e] of this.carSprites) {
                if (!e.alive || id === focusId) continue;
                const dx = e.x - this.camX, dy = e.y - this.camY;
                if (Math.abs(dx) < halfW - 10 && Math.abs(dy) < halfH - 10) continue;   // on screen
                const dist = Math.hypot(dx, dy);
                if (dist > 2200) continue;
                const t = Math.min((dx < 0 ? limL : limR) / Math.max(1, Math.abs(dx)), (dy < 0 ? limT : limB) / Math.max(1, Math.abs(dy)));
                const ax = this.camX + dx * t, ay = this.camY + dy * t;
                const ang = Math.atan2(dy, dx);
                const alpha = Math.max(0.35, 1 - dist / 2200);
                const p1 = [ax + Math.cos(ang) * size * 1.3, ay + Math.sin(ang) * size * 1.3];
                const p2 = [ax + Math.cos(ang + 2.4) * size, ay + Math.sin(ang + 2.4) * size];
                const p3 = [ax + Math.cos(ang - 2.4) * size, ay + Math.sin(ang - 2.4) * size];
                ag.fillStyle(0x000000, 0.5 * alpha);
                ag.fillCircle(ax, ay, size * 1.15);
                ag.fillStyle(e.tintInt || 0xff4d3d, alpha);
                ag.fillTriangle(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
                ag.lineStyle(2 / this.zoom, 0xffffff, alpha * 0.9);
                ag.strokeTriangle(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
            }
        }

        // Dropped trap hazards (oil slick / reverse pad)
        const hg = this.hazardGfx;
        hg.clear();
        for (const hz of (snap.hazards || [])) {
            if (hz.type === 'oil') {
                hg.fillStyle(0x0a0a0a, 0.55); hg.fillEllipse(hz.x, hz.y, 96, 66);
                hg.fillStyle(0x3b2f22, 0.5); hg.fillEllipse(hz.x, hz.y, 62, 42);
                hg.fillStyle(0x6b5a3a, 0.4); hg.fillEllipse(hz.x - 8, hz.y - 6, 22, 14);
            } else {
                hg.fillStyle(0xa24aff, 0.18); hg.fillCircle(hz.x, hz.y, 36);
                hg.lineStyle(3, 0xa24aff, 0.85); hg.strokeCircle(hz.x, hz.y, 30);
                hg.lineStyle(2, 0xd9b3ff, 0.6); hg.strokeCircle(hz.x, hz.y, 18);
            }
        }

        const sNow = net.serverNow();

        // Power-ups: crates parachuting down from the cargo plane, then landed
        const puSeen = new Set();
        for (const pu of (snap.powerups || [])) {
            puSeen.add(pu.id);
            let d = this.puSprites.get(pu.id);
            if (!d) {
                d = {
                    shadow: this.add.ellipse(pu.x, pu.y, 52, 30, 0x000000, 0.3).setDepth(0.5),
                    crate: this.add.image(pu.x, pu.y, 'crate').setDepth(1),
                    icon: this.add.image(pu.x, pu.y, `pu_${pu.type}`).setDepth(1.2),
                    chute: this.add.image(pu.x, pu.y, 'chute').setDepth(45),
                    landed: false,
                };
                this.puSprites.set(pu.id, d);
            }
            const f = Math.max(0, Math.min(1, (pu.landAt - sNow) / DROP_FALL_MS));   // 1 = just dropped
            const sway = Math.sin(time * 0.004 + pu.id) * 10 * f;
            const lift = 1 + 0.7 * f;
            d.crate.setPosition(pu.x + sway, pu.y).setScale(0.75 * lift);
            const pulse = f > 0 ? 1 : 1 + 0.06 * Math.sin(time * 0.006 + pu.id);
            d.icon.setPosition(pu.x + sway, pu.y).setScale(0.44 * lift * pulse);
            d.shadow.setPosition(pu.x + 50 * f, pu.y + 70 * f).setScale(1 - 0.35 * f).setAlpha(0.32 - 0.15 * f);
            d.chute.setVisible(f > 0).setPosition(pu.x + sway, pu.y - 34 * f).setScale(0.75 + 0.35 * f).setAlpha(0.95);
            if (f === 0 && !d.landed) {
                d.landed = true;
                this.smoke.emitParticleAt(pu.x, pu.y, 8);   // dust as it touches down
            }
        }
        for (const [id, d] of this.puSprites) {
            if (!puSeen.has(id)) {
                d.shadow.destroy(); d.crate.destroy(); d.icon.destroy(); d.chute.destroy();
                this.puSprites.delete(id);
            }
        }

        // Cargo planes (fly high above everything; shadow on the ground)
        const plSeen = new Set();
        const sinceSnap = Math.max(0, Math.min(0.3, (sNow - snap.timestamp) / 1000));
        for (const pl of (snap.planes || [])) {
            plSeen.add(pl.id);
            let d = this.planeSprites.get(pl.id);
            if (!d) {
                d = {
                    shadow: this.add.image(pl.x, pl.y, 'plane').setDepth(2).setTint(0x000000).setAlpha(0.22),
                    plane: this.add.image(pl.x, pl.y, 'plane').setDepth(50),
                };
                this.planeSprites.set(pl.id, d);
            }
            const x = pl.x + Math.cos(pl.angle) * PLANE_SPEED * sinceSnap;
            const y = pl.y + Math.sin(pl.angle) * PLANE_SPEED * sinceSnap;
            d.plane.setPosition(x, y).setRotation(pl.angle).setScale(1.25);
            d.shadow.setPosition(x + 140, y + 190).setRotation(pl.angle).setScale(1.0);
        }
        for (const [id, d] of this.planeSprites) {
            if (!plSeen.has(id)) { d.plane.destroy(); d.shadow.destroy(); this.planeSprites.delete(id); }
        }

        // Rockets (moved forward from the last snapshot) with flame + smoke trail
        const rSeen = new Set();
        for (const pr of (snap.projectiles || [])) {
            rSeen.add(pr.id);
            let r = this.rocketSprites.get(pr.id);
            if (!r) { r = this.add.image(pr.x, pr.y, 'rocket').setDepth(6); this.rocketSprites.set(pr.id, r); }
            const x = pr.x + pr.vx * sinceSnap, y = pr.y + pr.vy * sinceSnap;
            const ang = Math.atan2(pr.vy, pr.vx);
            r.setPosition(x, y).setRotation(ang).setScale(0.85);
            const tx = x - Math.cos(ang) * 30, ty = y - Math.sin(ang) * 30;
            this.flame.emitParticleAt(tx, ty, 2);
            this.rocketTrail.emitParticleAt(tx, ty, 1);
        }
        for (const [id, r] of this.rocketSprites) {
            if (!rSeen.has(id)) { r.destroy(); this.rocketSprites.delete(id); }
        }
    }

    shutdownScene() {
        socket.off('collision', this._onCollision);
        socket.off('explosion', this._onExplosion);
        socket.off('playerEliminated', this._onEliminated);
        socket.off('powerupCollected', this._onPickup);
    }
}

export default function PhaserGame({ snapshot, localId, followId }) {
    const containerRef = useRef(null);
    const storeRef = useRef({ snapshot, localId });
    const gameRef = useRef(null);

    // Keep the store fresh for the scene's update loop
    storeRef.current.snapshot = snapshot;
    storeRef.current.localId = localId;
    storeRef.current.followId = followId;

    useEffect(() => {
        const scene = new ArenaScene(storeRef.current);
        const game = new Phaser.Game({
            type: Phaser.AUTO,
            parent: containerRef.current,
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundColor: '#0a0d13',
            scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
            scene,
            render: { antialias: true, pixelArt: false },
        });
        gameRef.current = game;

        return () => {
            scene.shutdownScene?.();
            game.destroy(true);
            gameRef.current = null;
        };
    }, []);

    return <div ref={containerRef} className="full-screen" style={{ position: 'absolute', inset: 0 }} />;
}
