// ─── Detailed top-down car renderer ───────────────────────────────────────
// Draws every car from code: a body shape per model, shaded paint with a
// clear-coat highlight, glass with reflections, lights, mirrors, panel gaps,
// grilles and exhausts — plus bolt-on parts (spoilers, bonnets, decals, rims,
// window tint) and damage (scratches, dents, cracked glass, scorch marks).
// Used by the menus and by the in-match renderer, so a car looks the same
// everywhere. Cars face UP in the image (nose at the top).

import { PAINTS, WHEELS, DEFAULT_COSMETICS, decalColor } from './cosmetics';

export const CAR_TEX_W = 144;       // px at res 1 (≈ 2.85 px per world px)
export const CAR_TEX_H = 264;
export const CAR_COLOR = {          // factory paint per model
    sports: '#1199dd', muscle: '#cc2244', truck: '#dd8800', rally: '#22aa44',
    kart: '#ccaa00', suv: '#00aaaa', drift: '#9944cc', supercar: '#cc5522',
};

// Model shapes (canvas px at res 1). Body widths: front / widest / rear.
// cab = greenhouse start/end (fraction of length), ws = windshield end,
// rw = rear-window start, cw = greenhouse width front/back.
const SPECS = {
    sports:   { L: 244, fw: 100, mw: 124, rw: 118, nose: 0.55, tail: 0.80, cab: [0.36, 0.70], ws: 0.47, rwin: 0.63, cw: [84, 90], wheel: [22, 44], lights: 'slim', exhaust: 'twin', defaults: { spoiler: 'lip', decal: 'none', hood: 'vents' } },
    muscle:   { L: 250, fw: 118, mw: 128, rw: 126, nose: 0.86, tail: 0.92, cab: [0.40, 0.74], ws: 0.50, rwin: 0.67, cw: [94, 100], wheel: [24, 46], lights: 'quad', grille: true, exhaust: 'dual', defaults: { spoiler: 'lip', decal: 'stripes', hood: 'bulge' } },
    truck:    { L: 252, fw: 122, mw: 130, rw: 128, nose: 0.90, tail: 0.96, cab: [0.25, 0.50], ws: 0.34, rwin: 0.47, cw: [106, 108], wheel: [27, 50], lights: 'square', grille: true, exhaust: 'side', bed: [0.54, 0.96], bullbar: true, defaults: { spoiler: 'none', decal: 'side', hood: 'scoop' } },
    rally:    { L: 234, fw: 110, mw: 122, rw: 118, nose: 0.72, tail: 0.88, cab: [0.30, 0.86], ws: 0.42, rwin: 0.80, cw: [96, 98], wheel: [22, 42], lights: 'rally', exhaust: 'single', roofRack: true, mudflaps: true, defaults: { spoiler: 'wing', decal: 'number', hood: 'vents' } },
    kart:     { L: 236, fw: 60, mw: 120, rw: 124, kart: true, wheel: [26, 40], defaults: { spoiler: 'wing', decal: 'number', hood: 'stock' } },
    suv:      { L: 252, fw: 120, mw: 128, rw: 126, nose: 0.88, tail: 0.94, cab: [0.30, 0.90], ws: 0.40, rwin: 0.85, cw: [104, 106], wheel: [26, 48], lights: 'square', grille: true, exhaust: 'single', roofRails: true, spare: true, defaults: { spoiler: 'none', decal: 'none', hood: 'stock' } },
    drift:    { L: 242, fw: 108, mw: 130, rw: 128, nose: 0.62, tail: 0.86, cab: [0.38, 0.70], ws: 0.49, rwin: 0.63, cw: [86, 92], wheel: [24, 44], lights: 'slim', exhaust: 'single', flares: true, defaults: { spoiler: 'wing', decal: 'side', hood: 'carbon' } },
    supercar: { L: 248, fw: 94, mw: 132, rw: 132, nose: 0.48, tail: 0.94, cab: [0.30, 0.56], ws: 0.42, rwin: 0.53, cw: [78, 90], wheel: [24, 46], lights: 'slim', exhaust: 'quad', engineVents: true, intakes: true, defaults: { spoiler: 'gt', decal: 'none', hood: 'stock' } },
};

const CX = CAR_TEX_W / 2, CY = CAR_TEX_H / 2;

// ─── helpers ──────────────────────────────────────────────────────────────
function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, amt) {
    const [r, g, b] = hexToRgb(hex);
    const f = (c) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function rng(seed) {            // small deterministic PRNG (same damage every time)
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}
function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

// Smooth closed outline through key points (quadratic curves via midpoints)
function smoothPath(g, pts) {
    const n = pts.length;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    g.beginPath();
    const m0 = mid(pts[n - 1], pts[0]);
    g.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
        const p = pts[i], m = mid(p, pts[(i + 1) % n]);
        g.quadraticCurveTo(p[0], p[1], m[0], m[1]);
    }
    g.closePath();
}

function yAt(s, t) { return CY - s.L / 2 + t * s.L; }

function bodyPoints(s) {
    const y0 = CY - s.L / 2;
    const R = [
        [s.nose * s.fw / 2, 0], [s.fw / 2, 0.05], [s.mw / 2 * 0.98, 0.17], [s.mw / 2 * 0.94, 0.30],
        [s.mw / 2 * 0.93, 0.55], [s.mw / 2, 0.74], [s.rw / 2, 0.90], [s.tail * s.rw / 2, 1],
    ];
    const right = R.map(([x, t]) => [CX + x, y0 + t * s.L]);
    const left = R.slice().reverse().map(([x, t]) => [CX - x, y0 + t * s.L]);
    return [...right, ...left];
}

function greenhousePath(g, s, inset = 0) {
    const yA = yAt(s, s.cab[0]) + inset, yB = yAt(s, s.cab[1]) - inset;
    const wA = s.cw[0] / 2 - inset, wB = s.cw[1] / 2 - inset;
    smoothPath(g, [
        [CX - wA * 0.82, yA], [CX + wA * 0.82, yA], [CX + wA, yA + 10], [CX + wB, yB - 8],
        [CX + wB * 0.86, yB], [CX - wB * 0.86, yB], [CX - wB, yB - 8], [CX - wA, yA + 10],
    ]);
}

function glassFill(g, tint, y0, y1) {
    const grd = g.createLinearGradient(0, y0, 0, y1);
    if (tint === 'dark') { grd.addColorStop(0, '#0b0e12'); grd.addColorStop(1, '#030405'); }
    else if (tint === 'mirror') { grd.addColorStop(0, '#d7e3ef'); grd.addColorStop(0.5, '#7f93a8'); grd.addColorStop(1, '#c4d2df'); }
    else { grd.addColorStop(0, '#2c4258'); grd.addColorStop(1, '#141e29'); }
    return grd;
}

function carbonPattern(g) {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const x = c.getContext('2d');
    x.fillStyle = '#1b1d21'; x.fillRect(0, 0, 8, 8);
    x.fillStyle = '#2d3036'; x.fillRect(0, 0, 4, 4); x.fillRect(4, 4, 4, 4);
    x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(0, 0, 4, 1); x.fillRect(4, 4, 4, 1);
    return g.createPattern(c, 'repeat');
}

// ─── public: resolve 'stock' parts and paint for a model ─────────────────
export function resolveLook(type, cos) {
    const s = SPECS[type] || SPECS.sports;
    const c = { ...DEFAULT_COSMETICS, ...(cos || {}) };
    const pick = (k) => (c[k] === 'stock' || !c[k]) ? (s.defaults[k] || 'none') : c[k];
    const paint = (PAINTS.find(p => p.key === c.paint) || PAINTS[0]).color || CAR_COLOR[type] || '#888888';
    return {
        paint, finish: c.finish || 'gloss',
        decal: pick('decal'), decalColor: decalColor(c.decalColor), spoiler: pick('spoiler'), hood: pick('hood'),
        rim: (WHEELS.find(w => w.key === c.wheel) || WHEELS[0]).rim, tint: c.tint || 'stock',
        number: c.number || 7,
    };
}

export function lookKey(type, cos, stage = 0) {
    const l = resolveLook(type, cos);
    return `car_${type}_${hashStr(JSON.stringify(l)).toString(36)}_${stage}`;
}

// ─── public: draw a car into a new canvas ────────────────────────────────
//   stage: 0 pristine … 3 wrecked-looking (scorched)
export function renderCar(type, cos, { stage = 0, res = 1 } = {}) {
    const s = SPECS[type] || SPECS.sports;
    const look = resolveLook(type, cos);
    const c = document.createElement('canvas');
    c.width = Math.round(CAR_TEX_W * res);
    c.height = Math.round(CAR_TEX_H * res);
    const g = c.getContext('2d');
    g.scale(res, res);
    if (s.kart) drawKart(g, s, look, stage);
    else drawCar(g, s, look, stage, type);
    return c;
}

// Soft black silhouette for the drop shadow
export function renderShadow(type) {
    const s = SPECS[type] || SPECS.sports;
    const pad = 16;
    const c = document.createElement('canvas');
    c.width = CAR_TEX_W + pad * 2; c.height = CAR_TEX_H + pad * 2;
    const g = c.getContext('2d');
    g.translate(pad, pad);
    try { g.filter = 'blur(5px)'; } catch (_) { /* ignore */ }
    g.fillStyle = 'rgba(0,0,0,0.85)';
    if (s.kart) { roundRect(g, CX - s.mw / 2, CY - s.L / 2 + 10, s.mw, s.L - 20, 20); g.fill(); }
    else { smoothPath(g, bodyPoints(s)); g.fill(); }
    return c;
}

// Red glow for the brake lights (drawn additively over the car)
export function renderBrakeGlow(type) {
    const s = SPECS[type] || SPECS.sports;
    const c = document.createElement('canvas');
    c.width = CAR_TEX_W; c.height = CAR_TEX_H + 40;
    const g = c.getContext('2d');
    const y = CY + s.L / 2 - 6;
    const xs = s.kart ? [CX - 14, CX + 14] : [CX - s.rw * 0.33, CX + s.rw * 0.33];
    for (const x of xs) {
        const grd = g.createRadialGradient(x, y, 1, x, y, 26);
        grd.addColorStop(0, 'rgba(255,60,60,1)');
        grd.addColorStop(0.35, 'rgba(255,30,30,0.6)');
        grd.addColorStop(1, 'rgba(255,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x - 26, y - 26, 52, 52);
    }
    return c;
}

// Where things sit on each model (for in-game effects), in canvas px from centre
export function carAnchors(type) {
    const s = SPECS[type] || SPECS.sports;
    return { front: -s.L / 2, rear: s.L / 2, halfWidth: s.mw / 2 };
}

// ─── the drawing ─────────────────────────────────────────────────────────
function drawWheel(g, x, y, w, h, rim) {
    roundRect(g, x - w / 2, y - h / 2, w, h, 6);
    g.fillStyle = '#121315'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    for (let k = y - h / 2 + 4; k < y + h / 2 - 2; k += 5) { g.beginPath(); g.moveTo(x - w / 2 + 2, k); g.lineTo(x + w / 2 - 2, k); g.stroke(); }
    // rim lip on the outer sidewall
    g.fillStyle = rim;
    const side = x < CX ? -1 : 1;
    roundRect(g, x + side * (w / 2 - 5) - 2, y - h * 0.32, 4, h * 0.64, 2); g.fill();
}

function drawCar(g, s, look, stage, type) {
    const y0 = CY - s.L / 2, y1 = CY + s.L / 2;
    const P = bodyPoints(s);
    const [ww, wh] = s.wheel;

    // Tyres (peek out from under the arches)
    const wx = s.mw / 2 - ww * 0.32;
    for (const [t, ex] of [[0.17, 0], [0.74, 2]]) {
        drawWheel(g, CX - wx - ex, yAt(s, t), ww + ex, wh, look.rim);
        drawWheel(g, CX + wx + ex, yAt(s, t), ww + ex, wh, look.rim);
    }

    // Body paint
    smoothPath(g, P);
    g.fillStyle = look.paint; g.fill();

    g.save();
    smoothPath(g, P); g.clip();

    // Curvature: darker flanks, lighter spine
    const k = look.finish === 'matte' ? 0.55 : 1;
    const lat = g.createLinearGradient(CX - s.mw / 2, 0, CX + s.mw / 2, 0);
    lat.addColorStop(0, `rgba(0,0,0,${0.42 * k})`); lat.addColorStop(0.16, `rgba(0,0,0,${0.08 * k})`);
    lat.addColorStop(0.42, `rgba(255,255,255,${0.14 * k})`); lat.addColorStop(0.58, `rgba(255,255,255,${0.10 * k})`);
    lat.addColorStop(0.84, `rgba(0,0,0,${0.08 * k})`); lat.addColorStop(1, `rgba(0,0,0,${0.45 * k})`);
    g.fillStyle = lat; g.fillRect(0, 0, CAR_TEX_W, CAR_TEX_H);
    const lon = g.createLinearGradient(0, y0, 0, y1);
    lon.addColorStop(0, 'rgba(0,0,0,0.25)'); lon.addColorStop(0.08, 'rgba(0,0,0,0)');
    lon.addColorStop(0.92, 'rgba(0,0,0,0)'); lon.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = lon; g.fillRect(0, 0, CAR_TEX_W, CAR_TEX_H);

    // Finish
    if (look.finish === 'chrome') {
        const ch = g.createLinearGradient(CX - s.mw / 2, y0, CX + s.mw / 2, y1);
        ['rgba(255,255,255,0.55)', 'rgba(0,0,0,0.35)', 'rgba(255,255,255,0.45)', 'rgba(0,0,0,0.4)', 'rgba(255,255,255,0.5)', 'rgba(0,0,0,0.3)']
            .forEach((col, i, a) => ch.addColorStop(i / (a.length - 1), col));
        g.fillStyle = ch; g.fillRect(0, 0, CAR_TEX_W, CAR_TEX_H);
    } else if (look.finish === 'metallic') {
        const r = rng(hashStr(type + 'flake'));
        for (let i = 0; i < 420; i++) {
            g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
            g.fillRect(CX - s.mw / 2 + r() * s.mw, y0 + r() * s.L, 1, 1);
        }
    } else if (look.finish === 'matte') {
        g.fillStyle = 'rgba(70,70,70,0.12)'; g.fillRect(0, 0, CAR_TEX_W, CAR_TEX_H);
    }

    // Decals (under the glass)
    drawDecal(g, s, look);

    // Bonnet option
    drawHood(g, s, look);

    // Clear-coat highlight streaks on bonnet and boot (not on matte)
    if (look.finish !== 'matte') {
        const hl = (x, y, rx, ry, a) => {
            const grd = g.createRadialGradient(x, y, 1, x, y, ry);
            grd.addColorStop(0, `rgba(255,255,255,${a})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
            g.save(); g.translate(x, y); g.scale(rx / ry, 1); g.translate(-x, -y);
            g.fillStyle = grd; g.beginPath(); g.arc(x, y, ry, 0, Math.PI * 2); g.fill(); g.restore();
        };
        hl(CX - s.fw * 0.18, yAt(s, 0.2), 10, 34, look.finish === 'chrome' ? 0.5 : 0.32);
        hl(CX - s.rw * 0.18, yAt(s, 0.85), 9, 18, 0.22);
    }

    // Panel gaps: bonnet, doors, boot
    g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 1.1;
    const cowl = yAt(s, s.cab[0]) - 4;
    g.beginPath();
    g.moveTo(CX - s.fw * 0.36, y0 + 10); g.quadraticCurveTo(CX - s.cw[0] * 0.5, cowl - 20, CX - s.cw[0] * 0.48, cowl);
    g.moveTo(CX + s.fw * 0.36, y0 + 10); g.quadraticCurveTo(CX + s.cw[0] * 0.5, cowl - 20, CX + s.cw[0] * 0.48, cowl);
    g.moveTo(CX - s.cw[0] * 0.48, cowl); g.quadraticCurveTo(CX, cowl + 4, CX + s.cw[0] * 0.48, cowl);
    const doorY = yAt(s, (s.cab[0] + s.cab[1]) / 2 + 0.02);
    g.moveTo(CX - s.mw * 0.47, doorY); g.lineTo(CX - s.cw[1] * 0.5 - 2, doorY);
    g.moveTo(CX + s.mw * 0.47, doorY); g.lineTo(CX + s.cw[1] * 0.5 + 2, doorY);
    if (!s.bed) {
        const boot = yAt(s, s.cab[1]) + 5;
        g.moveTo(CX - s.cw[1] * 0.46, boot); g.quadraticCurveTo(CX, boot + 4, CX + s.cw[1] * 0.46, boot);
    }
    g.stroke();

    // Side intakes (supercar), fender flares (drift)
    if (s.intakes) {
        g.fillStyle = '#121418';
        for (const sd of [-1, 1]) {
            g.beginPath();
            g.moveTo(CX + sd * s.mw * 0.47, yAt(s, 0.5)); g.lineTo(CX + sd * s.mw * 0.36, yAt(s, 0.56));
            g.lineTo(CX + sd * s.mw * 0.36, yAt(s, 0.64)); g.lineTo(CX + sd * s.mw * 0.47, yAt(s, 0.62));
            g.closePath(); g.fill();
        }
    }
    if (s.flares) {
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2;
        for (const t of [0.17, 0.74]) for (const sd of [-1, 1]) {
            const a0 = sd < 0 ? -1.1 : Math.PI - 1.1;           // the half of the arch inside the body
            g.beginPath(); g.arc(CX + sd * (s.mw / 2 - 2), yAt(s, t), wh * 0.62, a0, a0 + 2.2); g.stroke();
        }
    }
    g.restore();

    // Pickup bed / greenhouse
    if (s.bed) drawBed(g, s, look);
    drawGreenhouse(g, s, look);

    // Engine cover vents (supercar)
    if (s.engineVents) {
        g.fillStyle = '#15171b';
        for (let i = 0; i < 6; i++) {
            const y = yAt(s, 0.6 + i * 0.045);
            roundRect(g, CX - 26, y, 52, 4, 2); g.fill();
        }
    }

    // Mirrors
    for (const sd of [-1, 1]) {
        const mx = CX + sd * (s.cw[0] / 2 + 9), my = yAt(s, s.cab[0]) + 14;
        g.save(); g.translate(mx, my); g.rotate(sd * 0.35);
        roundRect(g, -6, -4, 12, 8, 3); g.fillStyle = look.paint; g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.stroke();
        g.restore();
    }

    // Grille, bull bar
    if (s.grille) {
        roundRect(g, CX - s.fw * 0.22, y0 + 2, s.fw * 0.44, 8, 3);
        g.fillStyle = '#16181c'; g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
        for (let x = CX - s.fw * 0.2; x < CX + s.fw * 0.2; x += 5) { g.beginPath(); g.moveTo(x, y0 + 3); g.lineTo(x, y0 + 9); g.stroke(); }
    }
    if (s.bullbar) {
        g.strokeStyle = '#2a2d33'; g.lineWidth = 5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(CX - s.fw * 0.42, y0 + 2); g.quadraticCurveTo(CX, y0 - 9, CX + s.fw * 0.42, y0 + 2); g.stroke();
        g.strokeStyle = '#7d8590'; g.lineWidth = 1.5; g.stroke();
    }

    // Lights
    drawLights(g, s, look, stage);

    // Exhausts
    g.fillStyle = '#9aa1ab';
    const ex = (x) => { g.beginPath(); g.arc(x, y1 + 1, 3.2, 0, Math.PI * 2); g.fill(); g.fillStyle = '#25282d'; g.beginPath(); g.arc(x, y1 + 1, 1.6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#9aa1ab'; };
    if (s.exhaust === 'twin') { ex(CX - 6); ex(CX + 6); }
    else if (s.exhaust === 'dual') { ex(CX - s.rw * 0.3); ex(CX + s.rw * 0.3); }
    else if (s.exhaust === 'quad') { ex(CX - 14); ex(CX - 6); ex(CX + 6); ex(CX + 14); }
    else if (s.exhaust === 'single') ex(CX + s.rw * 0.28);

    // Spare wheel (SUV), mud flaps (rally)
    if (s.spare) {
        g.fillStyle = '#121315'; g.beginPath(); g.arc(CX, y1 - 3, 14, Math.PI, 0); g.fill();
        g.fillStyle = look.rim; g.beginPath(); g.arc(CX, y1 - 3, 6, Math.PI, 0); g.fill();
    }
    if (s.mudflaps) {
        g.fillStyle = '#18191c';
        for (const sd of [-1, 1]) { roundRect(g, CX + sd * (s.mw / 2 - 12) - 7, yAt(s, 0.74) + wh / 2 + 1, 14, 4, 1); g.fill(); }
    }

    // Spoiler sits on top of everything at the back
    drawSpoiler(g, s, look);

    // Outline + clear-coat rim light
    smoothPath(g, P);
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.6; g.stroke();

    if (stage > 0) drawDamage(g, s, P, stage, type);
}

function drawGreenhouse(g, s, look) {
    const yA = yAt(s, s.cab[0]), yB = yAt(s, s.cab[1]);
    // Glass base (whole greenhouse)
    greenhousePath(g, s);
    g.fillStyle = glassFill(g, look.tint, yA, yB); g.fill();
    // Roof panel (paint) between windshield and rear window
    const yW = yAt(s, s.ws), yR = yAt(s, s.rwin);
    g.save();
    greenhousePath(g, s); g.clip();
    const roofW = (s.cw[0] + s.cw[1]) / 2 - 10;
    roundRect(g, CX - roofW / 2, yW, roofW, yR - yW, 10);
    g.fillStyle = shade(look.paint, 0.06); g.fill();
    const rg = g.createLinearGradient(CX - roofW / 2, 0, CX + roofW / 2, 0);
    rg.addColorStop(0, 'rgba(0,0,0,0.3)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.12)');
    rg.addColorStop(0.65, 'rgba(255,255,255,0.05)'); rg.addColorStop(1, 'rgba(0,0,0,0.32)');
    g.fillStyle = rg; g.fillRect(CX - roofW / 2, yW, roofW, yR - yW);
    // Reflection streaks on windshield and rear window
    g.strokeStyle = look.tint === 'mirror' ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.22)';
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(CX - roofW * 0.35, yW - 2); g.lineTo(CX - roofW * 0.05, yA + 4); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(CX + roofW * 0.05, yR + 4); g.lineTo(CX + roofW * 0.3, yB - 3); g.stroke();
    g.restore();
    // Roof rack / rails
    if (s.roofRack) {
        g.strokeStyle = '#1b1d21'; g.lineWidth = 2.5;
        roundRect(g, CX - roofW / 2 + 6, yW + 8, roofW - 12, yR - yW - 16, 4); g.stroke();
        g.lineWidth = 1.5;
        for (let y = yW + 18; y < yR - 10; y += 12) { g.beginPath(); g.moveTo(CX - roofW / 2 + 6, y); g.lineTo(CX + roofW / 2 - 6, y); g.stroke(); }
    }
    if (s.roofRails) {
        g.strokeStyle = '#1b1d21'; g.lineWidth = 3;
        for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(CX + sd * (roofW / 2 - 4), yW + 6); g.lineTo(CX + sd * (roofW / 2 - 4), yR - 6); g.stroke(); }
    }
    // Greenhouse outline (window rubber)
    greenhousePath(g, s);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.4; g.stroke();
}

function drawBed(g, s, look) {
    const yA = yAt(s, s.bed[0]), yB = yAt(s, s.bed[1]);
    const w = s.rw - 22;
    roundRect(g, CX - w / 2, yA, w, yB - yA, 6);
    g.fillStyle = '#2a2c30'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2;
    for (let x = CX - w / 2 + 10; x < CX + w / 2 - 6; x += 12) { g.beginPath(); g.moveTo(x, yA + 6); g.lineTo(x, yB - 6); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.5;
    roundRect(g, CX - w / 2, yA, w, yB - yA, 6); g.stroke();
    // roll bar with lights
    g.fillStyle = '#1e2024'; roundRect(g, CX - w / 2 - 2, yA - 3, w + 4, 6, 3); g.fill();
    g.fillStyle = '#ffeeb0';
    for (const x of [-22, -8, 8, 22]) { g.beginPath(); g.arc(CX + x, yA, 2.4, 0, Math.PI * 2); g.fill(); }
}

function drawHood(g, s, look) {
    const y0 = CY - s.L / 2, cowl = yAt(s, s.cab[0]) - 6;
    if (look.hood === 'bulge') {
        const w = s.fw * 0.34;
        const grd = g.createLinearGradient(CX - w / 2, 0, CX + w / 2, 0);
        grd.addColorStop(0, 'rgba(0,0,0,0.25)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.18)'); grd.addColorStop(1, 'rgba(0,0,0,0.25)');
        roundRect(g, CX - w / 2, y0 + 16, w, cowl - y0 - 20, 10); g.fillStyle = grd; g.fill();
    } else if (look.hood === 'scoop') {
        const sy = yAt(s, 0.16);
        roundRect(g, CX - 18, sy - 4, 36, 30, 8); g.fillStyle = shade(look.paint, 0.08); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.2; g.stroke();
        roundRect(g, CX - 14, sy - 2, 28, 9, 4); g.fillStyle = '#0d0e10'; g.fill();
    } else if (look.hood === 'vents') {
        g.fillStyle = '#121418';
        for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) {
            roundRect(g, CX + sd * 20 - 9, yAt(s, 0.12) + i * 7, 18, 3.5, 1.5); g.fill();
        }
    } else if (look.hood === 'carbon') {
        g.save();
        g.beginPath();
        g.moveTo(CX - s.fw * 0.36, y0 + 10); g.quadraticCurveTo(CX - s.cw[0] * 0.5, cowl - 18, CX - s.cw[0] * 0.48, cowl);
        g.quadraticCurveTo(CX, cowl + 4, CX + s.cw[0] * 0.48, cowl);
        g.quadraticCurveTo(CX + s.cw[0] * 0.5, cowl - 18, CX + s.fw * 0.36, y0 + 10);
        g.quadraticCurveTo(CX, y0 + 2, CX - s.fw * 0.36, y0 + 10);
        g.closePath();
        g.fillStyle = carbonPattern(g); g.fill();
        const sh = g.createLinearGradient(CX - s.fw / 2, 0, CX + s.fw / 2, 0);
        sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.4, 'rgba(255,255,255,0.12)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = sh; g.fill();
        g.restore();
    }
}

function drawDecal(g, s, look) {
    const y0 = CY - s.L / 2, y1 = CY + s.L / 2, col = look.decalColor;
    if (look.decal === 'stripes') {
        g.fillStyle = col;
        g.fillRect(CX - 13, y0, 9, s.L); g.fillRect(CX + 4, y0, 9, s.L);
    } else if (look.decal === 'side') {
        g.fillStyle = col;
        for (const sd of [-1, 1]) {
            g.beginPath();
            g.moveTo(CX + sd * s.mw * 0.42, yAt(s, 0.08)); g.lineTo(CX + sd * s.mw * 0.36, yAt(s, 0.08));
            g.lineTo(CX + sd * s.mw * 0.36, yAt(s, 0.88)); g.lineTo(CX + sd * s.mw * 0.44, yAt(s, 0.92));
            g.closePath(); g.fill();
        }
    } else if (look.decal === 'flames') {
        const grd = g.createLinearGradient(0, y0, 0, yAt(s, 0.36));
        grd.addColorStop(0, '#ffe45a'); grd.addColorStop(0.45, '#ff8a1a'); grd.addColorStop(1, col);
        g.fillStyle = grd;
        const tongues = [[-0.36, 0.30], [-0.2, 0.36], [-0.04, 0.27], [0.12, 0.35], [0.28, 0.31], [0.38, 0.24]];
        g.beginPath();
        g.moveTo(CX - s.fw / 2, y0);
        for (const [fx, ft] of tongues) {
            const x = CX + fx * s.fw, y = yAt(s, ft);
            g.quadraticCurveTo(x - 10, y - 18, x, y);
            g.quadraticCurveTo(x + 2, y - 26, x + 12, yAt(s, ft - 0.08));
        }
        g.lineTo(CX + s.fw / 2, y0);
        g.closePath(); g.fill();
    } else if (look.decal === 'number') {
        const y = yAt(s, 0.2);
        g.fillStyle = '#f4f4f4'; g.beginPath(); g.arc(CX, y, 17, 0, Math.PI * 2); g.fill();
        g.strokeStyle = col === '#f4f4f4' ? '#16181c' : col; g.lineWidth = 3; g.stroke();
        g.save(); g.translate(CX, y); g.rotate(Math.PI / 2);   // reads correctly when driving right
        g.fillStyle = '#16181c'; g.font = 'bold 22px Arial Black, Arial, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(look.number), 0, 1);
        g.restore();
    } else if (look.decal === 'checker') {
        const sq = 8, y = yAt(s, 0.1);
        for (let row = 0; row < 2; row++) for (let x = CX - s.mw / 2; x < CX + s.mw / 2; x += sq) {
            g.fillStyle = ((x - CX + s.mw) / sq + row) % 2 < 1 ? col : '#16181c';
            g.fillRect(x, y + row * sq, sq, sq);
        }
    }
    // Rear valance under the boot
    if (look.decal !== 'none') { g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, y1 - 6, CAR_TEX_W, 6); }
}

function drawLights(g, s, look, stage) {
    const y0 = CY - s.L / 2, y1 = CY + s.L / 2;
    const head = (x, y, rx, ry, rot, broken) => {
        g.save(); g.translate(x, y); g.rotate(rot);
        const grd = g.createRadialGradient(0, 0, 1, 0, 0, rx + 4);
        grd.addColorStop(0, broken ? '#2a2c30' : '#ffffff'); grd.addColorStop(0.55, broken ? '#1b1c1f' : '#dff3ff');
        grd.addColorStop(1, broken ? 'rgba(0,0,0,0)' : 'rgba(170,220,255,0)');
        g.fillStyle = grd; g.beginPath(); g.ellipse(0, 0, rx + 3, ry + 3, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = broken ? '#202226' : '#f2fbff'; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.stroke();
        g.restore();
    };
    const brokenL = stage >= 2, brokenR = stage >= 3;
    const hx = s.fw * 0.33, hy = y0 + 7;
    if (s.lights === 'slim') { head(CX - hx, hy + 2, 12, 4, -0.35, brokenL); head(CX + hx, hy + 2, 12, 4, 0.35, brokenR); }
    else if (s.lights === 'quad') {
        head(CX - hx - 5, hy, 5, 5, 0, brokenL); head(CX - hx + 7, hy, 5, 5, 0, brokenL);
        head(CX + hx + 5, hy, 5, 5, 0, brokenR); head(CX + hx - 7, hy, 5, 5, 0, brokenR);
    } else if (s.lights === 'square') { head(CX - hx, hy, 11, 5, 0, brokenL); head(CX + hx, hy, 11, 5, 0, brokenR); }
    else if (s.lights === 'rally') {
        head(CX - hx, hy + 2, 10, 5, -0.2, brokenL); head(CX + hx, hy + 2, 10, 5, 0.2, brokenR);
        for (const x of [-21, -7, 7, 21]) head(CX + x, y0 + 1, 4.5, 4.5, 0, stage >= 2 && x < 0);
    }
    // Tail lights
    for (const sd of [-1, 1]) {
        g.save(); g.translate(CX + sd * s.rw * 0.33, y1 - 5);
        roundRect(g, -11, -3.5, 22, 7, 3);
        const tg = g.createLinearGradient(0, -3.5, 0, 3.5);
        tg.addColorStop(0, '#ff5a5a'); tg.addColorStop(1, '#8a0d12');
        g.fillStyle = tg; g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.stroke();
        g.restore();
    }
}

function drawSpoiler(g, s, look) {
    const y1 = CY + s.L / 2;
    if (look.spoiler === 'lip') {
        roundRect(g, CX - s.rw * 0.4, y1 - 8, s.rw * 0.8, 4, 2);
        g.fillStyle = '#18191c'; g.fill();
    } else if (look.spoiler === 'wing') {
        g.fillStyle = '#1d1f23';
        g.fillRect(CX - s.rw * 0.3, y1 - 18, 5, 10); g.fillRect(CX + s.rw * 0.3 - 5, y1 - 18, 5, 10);
        roundRect(g, CX - s.rw * 0.46, y1 - 16, s.rw * 0.92, 9, 3);
        g.fillStyle = look.paint; g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.2; g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(CX - s.rw * 0.44, y1 - 15, s.rw * 0.88, 2);
    } else if (look.spoiler === 'gt') {
        g.fillStyle = '#16181c';
        g.fillRect(CX - s.rw * 0.24, y1 - 22, 5, 14); g.fillRect(CX + s.rw * 0.24 - 5, y1 - 22, 5, 14);
        const w = Math.min(CAR_TEX_W - 4, s.rw * 1.06);
        roundRect(g, CX - w / 2, y1 - 20, w, 12, 3);
        g.fillStyle = carbonPattern(g); g.fill();
        g.strokeStyle = '#0b0c0e'; g.lineWidth = 1.4; g.stroke();
        g.fillStyle = '#0b0c0e';
        g.fillRect(CX - w / 2 - 1, y1 - 24, 4, 20); g.fillRect(CX + w / 2 - 3, y1 - 24, 4, 20);
    }
}

function drawDamage(g, s, P, stage, type) {
    const r = rng(hashStr(type + 'dmg'));
    const y0 = CY - s.L / 2;
    g.save();
    if (P) { smoothPath(g, P); g.clip(); }
    // Scratches + scuffs
    const n = stage * 7;
    for (let i = 0; i < n; i++) {
        const x = CX + (r() - 0.5) * s.mw, y = y0 + r() * s.L, len = 6 + r() * 18, a = r() * Math.PI;
        g.strokeStyle = r() > 0.5 ? 'rgba(235,235,235,0.55)' : 'rgba(20,20,20,0.5)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
    // Dents: a shallow crumple — shadowed on one side, catching light on the other
    for (let i = 0; i < stage * 2; i++) {
        const x = CX + (r() - 0.5) * s.mw * 0.8, y = y0 + (i % 2 ? 0.06 : 0.86) * s.L + r() * 26;
        const rx = 8 + r() * 8, ry = 5 + r() * 5, rot = r() * Math.PI;
        g.save(); g.translate(x, y); g.rotate(rot);
        const grd = g.createRadialGradient(-rx * 0.25, -ry * 0.25, 1, 0, 0, rx);
        grd.addColorStop(0, 'rgba(0,0,0,0.32)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
        g.beginPath(); g.ellipse(0, 0, rx * 0.8, ry * 0.8, 0, 0.2, 1.6); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        g.beginPath(); g.ellipse(0, 0, rx * 0.6, ry * 0.6, 0, 3.4, 4.8); g.stroke();
        g.restore();
    }
    // Scorched bonnet + soot
    if (stage >= 3) {
        const hy = yAt(s, 0.17);
        const sc = g.createRadialGradient(CX, hy, 4, CX, hy, s.fw * 0.7);
        sc.addColorStop(0, 'rgba(10,8,6,0.85)'); sc.addColorStop(0.6, 'rgba(25,18,12,0.5)'); sc.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = sc; g.fillRect(0, 0, CAR_TEX_W, CAR_TEX_H);
        g.fillStyle = 'rgba(30,25,20,0.25)'; g.fillRect(0, 0, CAR_TEX_W, CAR_TEX_H);
    }
    g.restore();
    // Cracked windscreen
    if (stage >= 2 && s.cab) {
        const cx = CX - 10 + r() * 20, cy = yAt(s, (s.cab[0] + s.ws) / 2);
        g.strokeStyle = 'rgba(235,245,255,0.75)'; g.lineWidth = 0.9;
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2 + r() * 0.4, len = 10 + r() * 16;
            g.beginPath(); g.moveTo(cx, cy);
            g.lineTo(cx + Math.cos(a) * len * 0.5 + (r() - 0.5) * 3, cy + Math.sin(a) * len * 0.5);
            g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.stroke();
        }
        g.beginPath();
        for (let i = 0; i <= 9; i++) {
            const a = (i / 9) * Math.PI * 2, rr = 6 + r() * 3;
            i ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.stroke();
    }
}

// Go-kart: open frame, exposed slicks, driver in a helmet
function drawKart(g, s, look, stage) {
    const y0 = CY - s.L / 2, y1 = CY + s.L / 2;
    // Tyres
    const tyre = (x, y, w, h) => drawWheel(g, x, y, w, h, look.rim);
    tyre(CX - 46, yAt(s, 0.2), 24, 40); tyre(CX + 46, yAt(s, 0.2), 24, 40);
    tyre(CX - 50, yAt(s, 0.8), 30, 44); tyre(CX + 50, yAt(s, 0.8), 30, 44);
    // Chassis tubes
    g.strokeStyle = '#3a3e45'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(CX - 34, yAt(s, 0.2)); g.lineTo(CX + 34, yAt(s, 0.2));
    g.moveTo(CX - 36, yAt(s, 0.8)); g.lineTo(CX + 36, yAt(s, 0.8));
    g.moveTo(CX - 24, yAt(s, 0.18)); g.lineTo(CX - 28, yAt(s, 0.86));
    g.moveTo(CX + 24, yAt(s, 0.18)); g.lineTo(CX + 28, yAt(s, 0.86));
    g.stroke();
    const paintPart = (draw) => {
        draw(); g.fillStyle = look.paint; g.fill();
        g.save(); draw(); g.clip();
        const lat = g.createLinearGradient(CX - 60, 0, CX + 60, 0);
        lat.addColorStop(0, 'rgba(0,0,0,0.35)'); lat.addColorStop(0.5, 'rgba(255,255,255,0.15)'); lat.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = lat; g.fillRect(0, 0, CAR_TEX_W, CAR_TEX_H);
        g.restore();
        draw(); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.4; g.stroke();
    };
    // Nose cone + front bumper
    paintPart(() => smoothPath(g, [[CX - 16, y0 + 4], [CX + 16, y0 + 4], [CX + 26, yAt(s, 0.12)], [CX + 22, yAt(s, 0.36)], [CX - 22, yAt(s, 0.36)], [CX - 26, yAt(s, 0.12)]]));
    // Side pods
    for (const sd of [-1, 1]) paintPart(() => roundRect(g, CX + sd * 36 - 10, yAt(s, 0.36), 20, s.L * 0.34, 8));
    if (look.decal === 'number') {
        g.fillStyle = '#f4f4f4'; g.beginPath(); g.arc(CX, yAt(s, 0.16), 11, 0, Math.PI * 2); g.fill();
        g.save(); g.translate(CX, yAt(s, 0.16)); g.rotate(Math.PI / 2);
        g.fillStyle = '#16181c'; g.font = 'bold 15px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(look.number), 0, 1); g.restore();
    } else if (look.decal !== 'none') {
        g.fillStyle = look.decalColor; g.fillRect(CX - 3, y0 + 6, 6, s.L * 0.3);
    }
    // Steering wheel, seat, driver
    g.strokeStyle = '#111'; g.lineWidth = 3;
    g.beginPath(); g.arc(CX, yAt(s, 0.42), 11, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    roundRect(g, CX - 20, yAt(s, 0.44), 40, 40, 10); g.fillStyle = '#1a1b1e'; g.fill();
    const hy = yAt(s, 0.53);
    const hg = g.createRadialGradient(CX - 5, hy - 5, 2, CX, hy, 17);
    hg.addColorStop(0, shade(look.paint, 0.45)); hg.addColorStop(1, shade(look.paint, -0.35));
    g.fillStyle = hg; g.beginPath(); g.arc(CX, hy, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = look.tint === 'mirror' ? '#9fb3c8' : '#0f141a';
    g.beginPath(); g.arc(CX, hy - 3, 13, Math.PI * 1.15, Math.PI * 1.85); g.lineTo(CX, hy - 3); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(CX - 6, hy - 6, 3, 0, Math.PI * 2); g.fill();
    // Engine + exhaust
    roundRect(g, CX - 18, yAt(s, 0.68), 36, 26, 5); g.fillStyle = '#4a4f57'; g.fill();
    g.fillStyle = '#2b2e33'; for (let i = 0; i < 4; i++) g.fillRect(CX - 14, yAt(s, 0.70) + i * 5, 28, 2);
    g.fillStyle = '#9aa1ab'; g.beginPath(); g.arc(CX + 14, y1 - 10, 4, 0, Math.PI * 2); g.fill();
    // Rear bumper + lights
    g.strokeStyle = '#2c2f35'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(CX - 40, y1 - 4); g.lineTo(CX + 40, y1 - 4); g.stroke();
    g.fillStyle = '#d42020';
    roundRect(g, CX - 22, y1 - 7, 12, 5, 2); g.fill(); roundRect(g, CX + 10, y1 - 7, 12, 5, 2); g.fill();
    drawSpoiler(g, { ...s, rw: 96 }, look);
    if (stage > 0) drawDamage(g, { ...s, mw: 70 }, null, stage, 'kart');
}
