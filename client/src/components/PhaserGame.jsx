import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { socket } from '../net/socket';
import { paintColor, trailColor, drawTopper, TOPPERS } from '../cosmetics';
import { CAR_COLOR } from '../carArt';

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
// Representative tint per player color slot (used when paint = factory)
const SLOT_HEX = { blue: '#2f9fe6', red: '#e04a4a', green: '#37c06a', yellow: '#e8c233', black: '#5a616c' };

// Desaturate a car image so it can be tinted to any paint color.
function makeNeutralCanvas(srcImage) {
    const w = srcImage.width, h = srcImage.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(srcImage, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = Math.max(0, Math.min(255, luma * 1.25 + 60)); // lift to light gray
        d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(id, 0, 0);
    return c;
}

// ─── Art mapping ───────────────────────────────────────────────────────────
const CAR_COLORS = ['blue', 'red', 'green', 'yellow', 'black'];
const CAR_VARIANT = {           // car type → Kenney body style (1-5)
    sports: 3, muscle: 1, truck: 4, rally: 5,
    kart: 2, suv: 4, drift: 3, supercar: 2,
};
const TYPE_SIZE = {             // matches server carStats.size for hitbox accuracy
    sports: 0.9, muscle: 1.1, truck: 1.4, rally: 0.95,
    kart: 0.7, suv: 1.2, drift: 0.95, supercar: 0.85,
};
// Server hitbox is a 88×46 box × size; the Kenney car (131×71px) at 0.7 scale
// is 92×50 — so what you see is what you hit.
const BASE_SPRITE_SCALE = 0.7;

function hashId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h);
}
function colorForId(id) {
    return CAR_COLORS[hashId(id) % CAR_COLORS.length];
}

// ─── Procedural asphalt tile (offscreen canvas → Phaser texture) ────────────
function makeAsphaltCanvas() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#20242c';
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

    preload() {
        for (const col of CAR_COLORS) {
            for (let n = 1; n <= 5; n++) {
                this.load.image(`car_${col}_${n}`, `/assets/game/cars/car_${col}_${n}.png`);
            }
        }
    }

    create() {
        // Neutral (tintable) car textures, one per body variant
        for (let v = 1; v <= 5; v++) {
            const src = this.textures.get(`car_blue_${v}`).getSourceImage();
            this.textures.addCanvas(`car_neutral_${v}`, makeNeutralCanvas(src));
        }
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

        // Camera
        this.cameras.main.setBackgroundColor('#0a0d13');
        this.cameras.main.setZoom(0.85);

        // ─── Event FX ────────────────────────────────────────────────────
        this._onCollision = (p) => {
            const intensity = Math.min(0.022, (p?.impact || 10) / 1400);
            this.cameras.main.shake(180, intensity);
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
            this.cameras.main.shake(220, 0.012);
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
        socket.on('collision', this._onCollision);
        socket.on('playerEliminated', this._onEliminated);
        socket.on('powerupCollected', this._onPickup);
    }

    drawArena(radius, base, electric, time) {
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
            const variant = CAR_VARIANT[p.carType] || 1;
            const shadow = this.add.sprite(p.x, p.y, `car_neutral_${variant}`)
                .setDepth(4).setTint(0x000000).setAlpha(0.38);
            const sprite = this.add.sprite(p.x, p.y, `car_neutral_${variant}`);
            sprite.setDepth(5);
            const topper = this.add.sprite(p.x, p.y, 'top_crown').setDepth(6).setVisible(false);
            const label = this.add.text(p.x, p.y, p.name || '', {
                fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#fff',
                stroke: '#000', strokeThickness: 3,
            }).setOrigin(0.5, 1).setDepth(7);
            entry = { sprite, shadow, topper, label, x: p.x, y: p.y, a: p.angle, topperKey: null, skidL: null, skidR: null };
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
        const snap = this.store.snapshot;
        if (!snap || !snap.players) return;

        const arenaR = snap.arenaRadius || 1000;
        if (Math.abs(arenaR - this.lastArenaR) > 0.5 || snap.suddenDeath) {
            this.drawArena(arenaR, snap.arenaBase || arenaR, !!snap.suddenDeath, time);
            this.lastArenaR = arenaR;
        }

        const k = 1 - Math.pow(0.000001, delta / 1000); // smoothing factor (snappy, still filters jitter)
        const seen = new Set();

        for (const p of snap.players) {
            seen.add(p.id);
            const e = this.ensureSprite(p);

            // Smooth position
            e.x += (p.x - e.x) * k;
            e.y += (p.y - e.y) * k;

            // Smooth angle (shortest path)
            let da = p.angle - e.a;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            e.a += da * k;

            const sizeMult = (TYPE_SIZE[p.carType] || 1) * (p.scale || 1);
            const scale = BASE_SPRITE_SCALE * sizeMult;
            const rot = e.a + Math.PI / 2;   // sprite faces up; angle 0 = +x
            e.sprite.setScale(scale);
            e.sprite.setPosition(e.x, e.y);
            e.sprite.setRotation(rot);
            e.sprite.setAlpha(p.alive ? 1 : 0.35);
            e.shadow.setScale(scale);
            e.shadow.setPosition(e.x + 5, e.y + 8);
            e.shadow.setRotation(rot);
            e.shadow.setVisible(p.alive);

            // Paint: custom color, else slot color (tinted neutral car)
            const cos = p.cosmetics || null;
            // Custom paint → that; a player's factory paint → the car's showroom color;
            // bots (no cosmetics) → a slot color so they're easy to tell apart
            const paintHex = (cos && (paintColor(cos.paint) || CAR_COLOR[p.carType])) || SLOT_HEX[colorForId(p.id)];
            e.sprite.setTint(p.alive ? hexToInt(paintHex) : 0x777777);

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
                e.topper.setScale(scale);
                e.topper.setVisible(p.alive);
            }

            e.label.setPosition(e.x, e.y - 50 * sizeMult);
            e.label.setText(p.id === this.store.localId ? `★ ${p.name || ''}` : (p.name || ''));
            e.label.setColor(p.id === this.store.localId ? '#8fe3ff' : '#ffffff');
            e.label.setVisible(p.alive);

            // ─── Exhaust / smoke / tire marks ───────────────────────────
            if (p.alive) {
                const rearLen = 24 * sizeMult;
                const rx = e.x - Math.cos(e.a) * rearLen;
                const ry = e.y - Math.sin(e.a) * rearLen;

                const trailFlame = this.getFlame(cssToInt(trailColor(cos ? cos.trail : 'classic', time)));
                if (p.isDashing) {
                    trailFlame.emitParticleAt(rx, ry, 3);
                    if (this._tick % 2 === 0) this.smoke.emitParticleAt(rx, ry, 1);
                } else if (p.speedMult > 1 && this._tick % 2 === 0) {
                    trailFlame.emitParticleAt(rx, ry, 1);
                }

                // Skid marks: continuous streaks from both rear tyres
                if (p.skid || p.isDashing || p.slip > 0) {
                    const ax = e.x - Math.cos(e.a) * 28 * sizeMult, ay = e.y - Math.sin(e.a) * 28 * sizeMult;
                    const px = -Math.sin(e.a) * 17 * sizeMult, py = Math.cos(e.a) * 17 * sizeMult;
                    const L = [ax + px, ay + py], R = [ax - px, ay - py];
                    if (e.skidL) {
                        this.tireMarks.push({ x1: e.skidL[0], y1: e.skidL[1], x2: L[0], y2: L[1], life: 1 });
                        this.tireMarks.push({ x1: e.skidR[0], y1: e.skidR[1], x2: R[0], y2: R[1], life: 1 });
                    }
                    e.skidL = L; e.skidR = R;
                    if (p.skid && this._tick % 4 === 0) this.smoke.emitParticleAt(ax, ay, 1);
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
                this.carSprites.delete(id);
            }
        }

        // Camera follows the local player
        const me = this.carSprites.get(this.store.localId);
        if (me) this.cameras.main.centerOn(me.x, me.y);

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

        // Powerups (distinct icon sprites with a gentle pulse)
        const puSeen = new Set();
        for (const pu of (snap.powerups || [])) {
            puSeen.add(pu.id);
            let sp = this.puSprites.get(pu.id);
            if (!sp) {
                sp = this.add.image(pu.x, pu.y, `pu_${pu.type}`).setDepth(1);
                this.puSprites.set(pu.id, sp);
            }
            const pulse = 0.5 + 0.045 * Math.sin(time * 0.005 + pu.x);
            sp.setScale(pulse);
            sp.setPosition(pu.x, pu.y);
        }
        for (const [id, sp] of this.puSprites) {
            if (!puSeen.has(id)) { sp.destroy(); this.puSprites.delete(id); }
        }

        // Projectiles
        const jg = this.projectileGfx;
        jg.clear();
        for (const pr of (snap.projectiles || [])) {
            jg.fillStyle(0xffcc33, 1);
            jg.fillCircle(pr.x, pr.y, 5);
        }
    }

    shutdownScene() {
        socket.off('collision', this._onCollision);
        socket.off('playerEliminated', this._onEliminated);
        socket.off('powerupCollected', this._onPickup);
    }
}

export default function PhaserGame({ snapshot, localId }) {
    const containerRef = useRef(null);
    const storeRef = useRef({ snapshot, localId });
    const gameRef = useRef(null);

    // Keep the store fresh for the scene's update loop
    storeRef.current.snapshot = snapshot;
    storeRef.current.localId = localId;

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
