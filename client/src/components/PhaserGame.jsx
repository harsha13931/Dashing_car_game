import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { socket } from '../net/socket';

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
// Server collision radius = 25 * size → diameter 50*size. Kenney car is 71px wide,
// so width ≈ collision diameter when scale = 50*size/71 ≈ 0.7*size.
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
        socket.on('collision', this._onCollision);
        socket.on('playerEliminated', this._onEliminated);
    }

    drawArena(radius, danger) {
        const g = this.arenaGfx;
        g.clear();
        // Outer void ring
        g.lineStyle(44, 0x2a2f38, 1);
        g.strokeCircle(0, 0, radius + 22);
        // Hazard inner line
        g.lineStyle(4, 0xe8a030, 0.5);
        g.strokeCircle(0, 0, radius);
        // Danger zone ring
        if (danger && danger < radius) {
            g.lineStyle(3, 0xff3344, 0.35);
            g.strokeCircle(0, 0, danger);
        }
        // Center marker
        g.lineStyle(2, 0xffffff, 0.05);
        g.strokeCircle(0, 0, radius * 0.5);
        g.strokeCircle(0, 0, 60);
    }

    ensureSprite(p) {
        let entry = this.carSprites.get(p.id);
        if (!entry) {
            const variant = CAR_VARIANT[p.carType] || 1;
            const color = colorForId(p.id);
            const sprite = this.add.sprite(p.x, p.y, `car_${color}_${variant}`);
            sprite.setDepth(5);
            const label = this.add.text(p.x, p.y, p.name || '', {
                fontFamily: 'Arial, sans-serif', fontSize: '15px', color: '#fff',
                stroke: '#000', strokeThickness: 3,
            }).setOrigin(0.5, 1).setDepth(6);
            entry = { sprite, label, x: p.x, y: p.y, a: p.angle };
            this.carSprites.set(p.id, entry);
        }
        return entry;
    }

    update(time, delta) {
        const snap = this.store.snapshot;
        if (!snap || !snap.players) return;

        const arenaR = snap.arenaRadius || 1000;
        if (arenaR !== this.lastArenaR) {
            this.drawArena(arenaR, snap.dangerZone);
            this.lastArenaR = arenaR;
        }

        const k = 1 - Math.pow(0.0001, delta / 1000); // smoothing factor
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
            e.sprite.setScale(scale);
            e.sprite.setPosition(e.x, e.y);
            e.sprite.setRotation(e.a + Math.PI / 2);   // sprite faces up; angle 0 = +x
            e.sprite.setAlpha(p.alive ? 1 : 0.35);

            e.label.setPosition(e.x, e.y - 34 * sizeMult);
            e.label.setText(p.id === this.store.localId ? `★ ${p.name || ''}` : (p.name || ''));
            e.label.setColor(p.id === this.store.localId ? '#8fe3ff' : '#ffffff');
            e.label.setVisible(p.alive);

            // ─── Exhaust / smoke / tire marks ───────────────────────────
            if (p.alive) {
                const rearLen = 24 * sizeMult;
                const rx = e.x - Math.cos(e.a) * rearLen;
                const ry = e.y - Math.sin(e.a) * rearLen;

                if (p.isDashing) {
                    this.flame.emitParticleAt(rx, ry, 3);
                    if (this._tick % 2 === 0) this.smoke.emitParticleAt(rx, ry, 1);
                } else if (p.speedMult > 1 && this._tick % 2 === 0) {
                    this.flame.emitParticleAt(rx, ry, 1);
                }

                // Tire marks while dashing or slipping
                if (p.isDashing || p.slip > 0) {
                    const perp = e.a + Math.PI / 2;
                    const w = 5 * sizeMult;
                    this.tireMarks.push({
                        x1: rx + Math.cos(perp) * w, y1: ry + Math.sin(perp) * w,
                        x2: rx - Math.cos(perp) * w, y2: ry - Math.sin(perp) * w,
                        life: 1,
                    });
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
            tg.lineStyle(3, 0x000000, 0.18 * m.life);
            tg.beginPath(); tg.moveTo(m.x1, m.y1); tg.lineTo(m.x2, m.y2); tg.strokePath();
        }
        if (this.tireMarks.length > 600) this.tireMarks.splice(0, this.tireMarks.length - 600);

        // Remove sprites for players no longer present
        for (const [id, e] of this.carSprites) {
            if (!seen.has(id)) {
                e.sprite.destroy(); e.label.destroy();
                this.carSprites.delete(id);
            }
        }

        // Camera follows the local player
        const me = this.carSprites.get(this.store.localId);
        if (me) this.cameras.main.centerOn(me.x, me.y);

        // Powerups
        const pg = this.powerupGfx;
        pg.clear();
        for (const pu of (snap.powerups || [])) {
            pg.fillStyle(0xe8a030, 0.25);
            pg.fillCircle(pu.x, pu.y, 20);
            pg.lineStyle(2, 0xe8a030, 0.8);
            pg.strokeCircle(pu.x, pu.y, 16);
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
