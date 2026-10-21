import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { socket } from '../net/socket';
import { net, PLANE_SPEED, DROP_FALL_MS } from '../net/netcode';
import { CAR_TYPES, pickRocketTarget, ARENAS } from '../../../shared/physics.mjs';
import { trailColor } from '../cosmetics';
import { resolveLook } from '../carRender';
import { isLowGfx, switchToLowAuto } from '../gfx';
import { POWERUP_META, makePowerupCanvas } from '../powerupArt';
import { buildCar, disposeCar } from './carModel';
import { ArenaWorld } from './arenaWorld';
import { Particles } from './particles';

// ─── 3D arena renderer ─────────────────────────────────────────────────────
// Draws exactly what the server says (snapshots + events) with an angled
// follow camera. Physics, prediction and netcode are untouched: positions
// come from net.renderState(), effects are triggered by server events.

const EMOTE_TEXT = ['GG', '😂', '😡', '🔥', '👋', '😱'];
const TYPE_SIZE = Object.fromEntries(Object.entries(CAR_TYPES).map(([k, c]) => [k, c.size]));
const FOV = 36, ELEV = 58 * Math.PI / 180;
const BALLOON_COLORS = [0xff4d6d, 0xffc93d, 0x3ddc84, 0x2fb6ff, 0xb46bff, 0xff8a3d];

const cssToInt = (c) => {
    if (!c) return 0xffffff;
    if (c[0] === '#') return parseInt(c.slice(1), 16);
    const m = c.match(/\d+/g);
    return m ? (+m[0] << 16) | (+m[1] << 8) | +m[2] : 0xffffff;
};

// Text → sprite (cached canvas textures)
const textCache = new Map();
function textSprite(text, { color = '#ffffff', size = 34, bg = null, bold = true, pad = 10 } = {}) {
    const key = `${text}|${color}|${size}|${bg}`;
    let entry = textCache.get(key);
    if (!entry) {
        const c = document.createElement('canvas');
        const g = c.getContext('2d');
        const font = `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
        g.font = font;
        const w = Math.ceil(g.measureText(text).width) + pad * 2, h = Math.ceil(size * 1.35) + pad;
        c.width = w; c.height = h;
        g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
        if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, h / 2.6); g.fill(); }
        g.lineWidth = Math.max(3, size / 7); g.strokeStyle = 'rgba(0,0,0,0.85)';
        g.strokeText(text, w / 2, h / 2 + 1);
        g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 1);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        entry = { tex: t, aspect: w / h };
        textCache.set(key, entry);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: entry.tex, depthTest: false, transparent: true }));
    s.userData.aspect = entry.aspect;
    s.renderOrder = 30;
    return s;
}

function sawGeometry() {
    const sh = new THREE.Shape();
    const teeth = 14, R = 26, r = 19;
    for (let i = 0; i <= teeth * 2; i++) {
        const a = i / (teeth * 2) * Math.PI * 2, rad = i % 2 ? r : R;
        if (i === 0) sh.moveTo(Math.cos(a) * rad, Math.sin(a) * rad); else sh.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    const hole = new THREE.Path(); hole.absarc(0, 0, 5, 0, Math.PI * 2, true); sh.holes.push(hole);
    return new THREE.ExtrudeGeometry(sh, { depth: 2.5, bevelEnabled: false }).rotateX(Math.PI / 2);
}

function shieldMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x4fc3ff) } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
            void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); float band = 0.08 * sin(uTime * 6.0 + vN.y * 18.0);
            gl_FragColor = vec4(uColor, clamp(f * 0.95 + 0.1 + band, 0.0, 1.0)); }`,
    });
}

function crateTexture(type) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#c28a48'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#6b4520'; g.lineWidth = 10; g.strokeRect(5, 5, 118, 118);
    const icon = makePowerupCanvas(type);
    g.drawImage(icon, 24, 24, 80, 80);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

class View3D {
    constructor(container, store) {
        this.container = container;
        this.store = store;
        this.low = isLowGfx();
        const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;

        const r = this.renderer = new THREE.WebGLRenderer({ antialias: !this.low, powerPreference: 'high-performance' });
        r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.low ? 1 : 1.75));
        r.setSize(w, h);
        r.outputColorSpace = THREE.SRGBColorSpace;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.05;
        r.shadowMap.enabled = !this.low;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
        r.domElement.style.display = 'block';
        container.appendChild(r.domElement);

        // 2D overlay for edge arrows (rivals off screen)
        this.overlay = document.createElement('canvas');
        Object.assign(this.overlay.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
        container.appendChild(this.overlay);

        const scene = this.scene = new THREE.Scene();
        scene.background = new THREE.Color(0xd99a64);
        scene.fog = new THREE.Fog(0xd99a64, 1700, 3600);
        const pmrem = new THREE.PMREMGenerator(r);
        this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
        scene.environment = this.envTex;
        scene.environmentIntensity = 0.35;

        scene.add(new THREE.HemisphereLight(0xfff1dc, 0x8a4f2c, 1.15));
        const sun = this.sun = new THREE.DirectionalLight(0xffe2b8, 2.3);
        sun.castShadow = !this.low;
        sun.shadow.mapSize.set(2048, 2048);
        const sc = sun.shadow.camera;
        sc.left = -800; sc.right = 800; sc.top = 800; sc.bottom = -800; sc.near = 100; sc.far = 2400;
        sun.shadow.bias = -0.0008;
        sun.shadow.normalBias = 1.5;
        scene.add(sun, sun.target);

        this.camera = new THREE.PerspectiveCamera(FOV, w / h, 10, 6000);
        this.world = new ArenaWorld(scene, { envMap: this.envTex, low: this.low });
        this.world.serverNow = () => net.serverNow();
        this.fxAdd = new Particles(scene, { max: this.low ? 700 : 1600, additive: true });
        this.fxSmoke = new Particles(scene, { max: this.low ? 500 : 1100, additive: false });

        this.cars = new Map();
        this.rockets = new Map();
        this.crates = new Map();
        this.planes = new Map();
        this.hazards = new Map();
        this.booms = [];
        this.texts = [];
        this.emotes = [];
        this.debris = [];
        this.shake = 0;
        this.focus = null;
        this.zoomK = 1;

        this.makeShared();
        this.makeSkids();
        this.bindEvents();

        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(container);
        this.last = performance.now();
        this.frames = 0; this.fpsT = 0; this.slow = 0;
        const loop = (t) => { this.raf = requestAnimationFrame(loop); this.frame(t); };
        this.raf = requestAnimationFrame(loop);

        // The joystick asks us how screen directions map onto the ground
        window.__dashView = { screenToWorldAngle: (dx, dy) => this.screenToWorldAngle(dx, dy), view: this };
    }

    makeShared() {
        this.geo = {
            ring: new THREE.RingGeometry(46, 52, 40).rotateX(-Math.PI / 2),
            disc: new THREE.CircleGeometry(46, 32).rotateX(-Math.PI / 2),
            saw: sawGeometry(),
            arm: new THREE.BoxGeometry(1, 3, 4),
            balloon: new THREE.SphereGeometry(9, 14, 10),
            shield: new THREE.SphereGeometry(1, 24, 16),
            blob: new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
            flash: new THREE.SphereGeometry(1, 16, 10),
            shock: new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2),
            debris: new THREE.BoxGeometry(5, 3, 4),
            arc: new THREE.TorusGeometry(1, 0.06, 4, 16, 0.9).rotateX(Math.PI / 2),
            crate: new THREE.BoxGeometry(30, 30, 30),
            chute: new THREE.SphereGeometry(30, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            bomb: new THREE.SphereGeometry(10, 16, 12),
            tracer: new THREE.BoxGeometry(46, 3.2, 3.2),
            rocketBody: new THREE.CylinderGeometry(5.5, 5.5, 40, 12).rotateZ(Math.PI / 2),
            rocketNose: new THREE.ConeGeometry(5.5, 15, 12).rotateZ(-Math.PI / 2),
            rocketFins: new THREE.BoxGeometry(11, 1.6, 22),
            rocketFlame: new THREE.ConeGeometry(5, 30, 10).rotateZ(Math.PI / 2),
        };
        this.mat = {
            blob: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
            saw: new THREE.MeshStandardMaterial({ color: 0xd6dbe2, metalness: 0.9, roughness: 0.25 }),
            arm: new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.6, roughness: 0.4 }),
            debris: new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.5, metalness: 0.6 }),
            chute: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide }),
            bomb: new THREE.MeshStandardMaterial({ color: 0x1d1f24, metalness: 0.4, roughness: 0.3 }),
            tracer: new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
            rocketBody: new THREE.MeshStandardMaterial({ color: 0xe8ebef, metalness: 0.5, roughness: 0.35 }),
            rocketRed: new THREE.MeshStandardMaterial({ color: 0xd6312f, roughness: 0.5 }),
            rocketFlame: new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
            gunDark: new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.8, roughness: 0.3 }),
            gunSteel: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.9, roughness: 0.25 }),
            gunAmmo: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 }),
        };
        // Gatling tracers: one instanced mesh for every bullet in flight
        this.tracers = new THREE.InstancedMesh(this.geo.tracer, this.mat.tracer, 200);
        this.tracers.count = 0;
        this.tracers.frustumCulled = false;
        this.scene.add(this.tracers);
        // explosion flash + shockwave pool
        this.boomPool = [];
        for (let i = 0; i < 10; i++) {
            const flash = new THREE.Mesh(this.geo.flash, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            const shock = new THREE.Mesh(this.geo.shock, new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
            flash.visible = shock.visible = false;
            this.scene.add(flash, shock);
            this.boomPool.push({ flash, shock, t: 1, r: 1 });
        }
        for (let i = 0; i < 40; i++) {
            const m = new THREE.Mesh(this.geo.debris, this.mat.debris);
            m.visible = false; m.castShadow = !this.low;
            this.scene.add(m);
            this.debris.push({ m, v: new THREE.Vector3(), life: 0 });
        }
        // rocket lock-on reticle (four rotating brackets)
        this.lock = new THREE.Group();
        this.lockMat = new THREE.MeshBasicMaterial({ color: 0xff3d5a, transparent: true, depthWrite: false });
        for (let k = 0; k < 4; k++) {
            const a = new THREE.Mesh(this.geo.arc, this.lockMat);
            a.rotation.y = k * Math.PI / 2;
            this.lock.add(a);
        }
        this.lock.visible = false;
        this.scene.add(this.lock);
        // bomb (Hot Bomb mode)
        this.bomb = new THREE.Group();
        const ball = new THREE.Mesh(this.geo.bomb, this.mat.bomb); ball.castShadow = true;
        const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc9a36b }));
        fuse.position.set(4, 10, 0); fuse.rotation.z = -0.5;
        this.bomb.add(ball, fuse);
        this.bomb.visible = false;
        this.scene.add(this.bomb);
        this.bombText = null;
    }

    // Skid marks: a ring buffer of dark quads lying on the floor
    makeSkids() {
        const MAX = this.low ? 0 : 1600;
        this.skidMax = MAX;
        this.skidNext = 0;
        if (!MAX) return;
        const geo = new THREE.BufferGeometry();
        this.skidPos = new Float32Array(MAX * 4 * 3);
        this.skidCol = new Float32Array(MAX * 4 * 4);
        const idx = new Uint32Array(MAX * 6);
        for (let i = 0; i < MAX; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6); }
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(this.skidCol, 4).setUsage(THREE.DynamicDrawUsage));
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.skidGeo = geo;
        this.skidLife = new Float32Array(MAX);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
        m.position.y = 1.1; m.renderOrder = 3;
        this.scene.add(m);
    }
    addSkid(x0, z0, x1, z1, w = 3.2) {
        if (!this.skidMax) return;
        const i = this.skidNext; this.skidNext = (i + 1) % this.skidMax;
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
        const px = -dz / l * w, pz = dx / l * w;
        this.skidPos.set([x0 + px, 0, z0 + pz, x0 - px, 0, z0 - pz, x1 + px, 0, z1 + pz, x1 - px, 0, z1 - pz], i * 12);
        this.skidLife[i] = 1;
    }
    updateSkids(dt) {
        if (!this.skidMax) return;
        for (let i = 0; i < this.skidMax; i++) {
            if (this.skidLife[i] <= 0) continue;
            this.skidLife[i] = Math.max(0, this.skidLife[i] - dt * 0.12);
            const a = 0.32 * this.skidLife[i];
            for (let v = 0; v < 4; v++) this.skidCol.set([0.08, 0.05, 0.04, a], (i * 4 + v) * 4);
        }
        this.skidGeo.attributes.position.needsUpdate = true;
        this.skidGeo.attributes.color.needsUpdate = true;
    }

    bindEvents() {
        const P = (x, y) => ({ x, z: y });
        this._onCollision = (e) => {
            if (!e || typeof e.x !== 'number') return;
            const p = P(e.x, e.y), n = Math.min(26, 6 + Math.round((e.impact || 10) / 14));
            if (e.type === 'bullet') {
                this.fxAdd.emit({ x: p.x, y: 18, z: p.z, spread: 220, up: 0.6, life: 0.22, size: [6, 1], color: [0xffffff, 0xffb02a], alpha: [1, 0], gravity: 400, count: 6 });
                return;
            }
            this.fxAdd.emit({ x: p.x, y: 14, z: p.z, spread: 260, up: 0.9, life: 0.4, size: [7, 1], color: [0xfff1a0, 0xff8822], alpha: [1, 0], gravity: 500, drag: 2, count: n });
            if (e.type === 'balloon') this.fxAdd.emit({ x: p.x, y: 20, z: p.z, spread: 200, life: 0.6, size: [9, 3], color: [BALLOON_COLORS[Math.floor(Math.random() * 6)], 0xffffff], alpha: [1, 0], gravity: 200, count: 10 });
            this.fxSmoke.emit({ x: p.x, y: 6, z: p.z, spread: 40, life: 0.8, size: [16, 40], color: [0xd9b08a, 0xc9a07a], alpha: [0.5, 0], count: 3 });
            const focus = this.store.followId || this.store.localId;
            if (Array.isArray(e.ids) && e.ids.includes(focus)) this.shake = Math.max(this.shake, Math.min(1, (e.impact || 10) / 500));
        };
        this._onExplosion = ({ x, y, big, ids }) => {
            const p = P(x, y), s = big ? 1.4 : 1;
            const b = this.boomPool.find(q => q.t >= 1) || this.boomPool[0];
            b.t = 0; b.x = p.x; b.z = p.z; b.r = (big ? 120 : 90);
            this.fxAdd.emit({ x: p.x, y: 18, z: p.z, spread: 330 * s, up: 0.8, life: 0.55, size: [46 * s, 8], color: [0xfff3b0, 0xd62a12], alpha: [1, 0], gravity: -40, drag: 3, count: big ? 60 : 36 });
            this.fxAdd.emit({ x: p.x, y: 18, z: p.z, spread: 420, up: 1, life: 0.6, size: [8, 1], color: [0xfff1a0, 0xff8822], alpha: [1, 0], gravity: 600, drag: 1.5, count: big ? 30 : 18 });
            this.fxSmoke.emit({ x: p.x, y: 20, z: p.z, spread: 70 * s, up: 0.9, upScale: 0.8, life: 1.6, size: [40 * s, 120 * s], color: [0x3b3836, 0x6b6560], alpha: [0.75, 0], gravity: -30, count: big ? 22 : 12 });
            let n = big ? 7 : 3;
            for (const d of this.debris) {
                if (d.life > 0) continue;
                d.life = 1.1; d.m.visible = true;
                d.m.position.set(p.x, 14, p.z);
                const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 220;
                d.v.set(Math.cos(a) * sp, 200 + Math.random() * 220, Math.sin(a) * sp);
                if (--n <= 0) break;
            }
            const focus = this.store.followId || this.store.localId;
            const me = this.cars.get(focus);
            const near = me ? Math.hypot(me.x - p.x, me.z - p.z) : 9999;
            if ((ids && ids.includes(focus)) || near < 260) this.shake = Math.max(this.shake, big ? 1 : 0.7);
            else if (near < 700) this.shake = Math.max(this.shake, 0.25);
        };
        this._onEliminated = ({ id }) => {
            const c = this.cars.get(id);
            if (!c) return;
            this.fxAdd.emit({ x: c.x, y: 12, z: c.z, spread: 300, life: 0.5, size: [8, 1], color: [0xfff1a0, 0xff8822], alpha: [1, 0], gravity: 500, count: 26 });
            this.fxSmoke.emit({ x: c.x, y: 8, z: c.z, spread: 90, life: 1.2, size: [30, 80], color: [0xd9b08a, 0xb08a66], alpha: [0.6, 0], count: 16 });
            if (id === this.store.localId) this.shake = 1;
        };
        this._onPickup = ({ playerId, type }) => {
            const c = this.cars.get(playerId);
            const meta = POWERUP_META[type];
            if (!c || !meta) return;
            const s = textSprite(meta.label, { color: meta.color, size: 40 });
            this.scene.add(s);
            this.texts.push({ s, follow: playerId, t: 0 });
            this.fxAdd.emit({ x: c.x, y: 20, z: c.z, spread: 160, life: 0.6, size: [10, 2], color: [cssToInt(meta.color), 0xffffff], alpha: [1, 0], gravity: -60, count: 18 });
        };
        this._onEmote = ({ id, e }) => {
            const text = EMOTE_TEXT[e];
            if (!text) return;
            for (const b of this.emotes) if (b.id === id) b.t = 99;
            const s = textSprite(text, { size: text.length > 2 ? 36 : 54, bg: 'rgba(15,18,26,0.85)', pad: 14 });
            this.scene.add(s);
            this.emotes.push({ id, s, t: 0 });
        };
        socket.on('collision', this._onCollision);
        socket.on('explosion', this._onExplosion);
        socket.on('playerEliminated', this._onEliminated);
        socket.on('powerupCollected', this._onPickup);
        socket.on('emote', this._onEmote);
    }

    resize() {
        const w = this.container.clientWidth, h = this.container.clientHeight;
        if (!w || !h) return;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.overlay.width = Math.round(w * dpr); this.overlay.height = Math.round(h * dpr);
    }

    // Screen direction (joystick) → world heading, through the tilted camera
    screenToWorldAngle(dx, dy) {
        const t = this.camTarget || new THREE.Vector3();
        const W = this.container.clientWidth, H = this.container.clientHeight;
        const pr = (x, z) => { const v = new THREE.Vector3(x, 0, z).project(this.camera); return [v.x * W / 2, -v.y * H / 2]; };
        const o = pr(t.x, t.z), ex0 = pr(t.x + 100, t.z), ez0 = pr(t.x, t.z + 100);
        const ex = [ex0[0] - o[0], ex0[1] - o[1]], ez = [ez0[0] - o[0], ez0[1] - o[1]];
        const det = ex[0] * ez[1] - ez[0] * ex[1];
        if (Math.abs(det) < 1e-6) return Math.atan2(dy, dx);
        const wx = (dx * ez[1] - ez[0] * dy) / det, wz = (ex[0] * dy - dx * ex[1]) / det;
        return Math.atan2(wz, wx);
    }

    // Roof-mounted Gatling gun: base, body, ammo box and a spinning three-barrel cluster
    makeGun() {
        const g = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(8, 9, 4, 14), this.mat.gunDark);
        base.position.y = 2;
        const body = new THREE.Mesh(new THREE.BoxGeometry(18, 9, 12), this.mat.gunDark);
        body.position.set(2, 8, 0);
        const ammo = new THREE.Mesh(new THREE.BoxGeometry(9, 8, 8), this.mat.gunAmmo);
        ammo.position.set(-2, 8, 9);
        const barrels = new THREE.Group();
        barrels.position.set(11, 8, 0);
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2;
            const b = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 26, 8).rotateZ(Math.PI / 2), this.mat.gunSteel);
            b.position.set(13, Math.cos(a) * 3, Math.sin(a) * 3);
            barrels.add(b);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(4.6, 1, 6, 14).rotateY(Math.PI / 2), this.mat.gunDark);
        ring.position.x = 24;
        barrels.add(ring);
        g.add(base, body, ammo, barrels);
        g.traverse(o => { if (o.isMesh) o.castShadow = !this.low; });
        g.userData.barrels = barrels;
        g.visible = false;
        this.scene.add(g);
        return g;
    }

    ensureCar(p) {
        const look = p.cosmetics || {};
        const key = `${p.carType}|${JSON.stringify(look)}`;
        let e = this.cars.get(p.id);
        if (e && e.key !== key) { this.removeCar(p.id); e = null; }
        if (e) return e;
        const car = buildCar(p.carType, look, this.envTex);
        car.group.traverse(o => { if (o.isMesh) { o.castShadow = !this.low; } });
        this.scene.add(car.group);
        const ring = new THREE.Mesh(this.geo.ring, new THREE.MeshBasicMaterial({ color: 0xff4d3d, transparent: true, opacity: 0.7, depthWrite: false }));
        const disc = new THREE.Mesh(this.geo.disc, new THREE.MeshBasicMaterial({ color: 0xff4d3d, transparent: true, opacity: 0.12, depthWrite: false }));
        ring.position.y = disc.position.y = 1.3;
        this.scene.add(ring, disc);
        const blob = new THREE.Mesh(this.geo.blob, this.mat.blob);
        blob.position.y = 0.8; blob.visible = this.low;
        this.scene.add(blob);
        const hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.65, transparent: true, depthTest: false }));
        const hpFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x3ddc84, depthTest: false }));
        hpBg.renderOrder = 30; hpFill.renderOrder = 31; hpFill.center.set(0, 0.5);
        this.scene.add(hpBg, hpFill);
        const shield = new THREE.Mesh(this.geo.shield, shieldMaterial());
        shield.visible = false; shield.renderOrder = 15;
        this.scene.add(shield);
        const saws = [0, 1].map(() => { const s = new THREE.Mesh(this.geo.saw, this.mat.saw); s.castShadow = true; s.visible = false; this.scene.add(s); return s; });
        const arms = [0, 1].map(() => { const a = new THREE.Mesh(this.geo.arm, this.mat.arm); a.visible = false; this.scene.add(a); return a; });
        const balloons = BALLOON_COLORS.map(c => { const b = new THREE.Mesh(this.geo.balloon, new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.05 })); b.visible = false; b.castShadow = true; this.scene.add(b); return b; });
        const strings = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
        strings.visible = false; strings.frustumCulled = false;
        this.scene.add(strings);
        e = { key, car, ring, disc, blob, hpBg, hpFill, shield, saws, arms, balloons, strings, gun: null, label: null, labelText: '', x: p.x, z: p.y, a: p.angle, lastA: p.angle, lastX: p.x, lastZ: p.y, steer: 0, lean: 0, alive: true, hp: 100, sizeMult: 1, sawSpin: 0 };
        this.cars.set(p.id, e);
        return e;
    }

    removeCar(id) {
        const e = this.cars.get(id);
        if (!e) return;
        disposeCar(e.car);
        for (const o of [e.car.group, e.ring, e.disc, e.blob, e.hpBg, e.hpFill, e.shield, e.label, e.strings, ...e.saws, ...e.arms, ...e.balloons]) if (o) this.scene.remove(o);
        e.ring.material.dispose(); e.disc.material.dispose(); e.hpBg.material.dispose(); e.hpFill.material.dispose(); e.shield.material.dispose();
        e.balloons.forEach(b => b.material.dispose());
        e.strings.geometry.dispose();
        if (e.label) e.label.material.dispose();
        if (e.gun) { this.scene.remove(e.gun); e.gun.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
        this.cars.delete(id);
    }

    frame(now) {
        const dms = Math.min(100, now - this.last);
        this.last = now;
        const dt = dms / 1000;
        net.step(dms);
        // Auto graphics: drop to the light effects if the frame rate stays low
        this.fpsT += dms; this.frames++;
        if (this.fpsT > 3000) {
            const fps = this.frames * 1000 / this.fpsT;
            this.slow = this.fpsWarm && fps < 38 ? this.slow + 1 : 0;
            this.fpsWarm = true; this.fpsT = 0; this.frames = 0;
            if (this.slow >= 2) switchToLowAuto();
        }
        if (isLowGfx() !== this.low) this.setLow(isLowGfx());

        const snap = net.view() || this.store.snapshot;
        net._replayView = snap && snap.replay ? snap : null;
        if (!snap || !snap.players) { this.renderer.render(this.scene, this.camera); return; }
        const time = now;
        this.world.setArena(snap.arena || 'classic', snap.arenaBase || 850);
        this.world.update(snap, time, this.store.localId);

        this.updateCars(snap, dt, time);
        this.updateCamera(dt);
        this.updateEffects(snap, dt, time);
        const scaleU = this.renderer.domElement.height * 0.55;
        this.fxAdd.update(dt, scaleU);
        this.fxSmoke.update(dt, scaleU);
        this.updateSkids(dt);
        this.renderer.render(this.scene, this.camera);
        this.drawOverlay(snap);
    }

    setLow(low) {
        this.low = low;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.75));
        this.renderer.shadowMap.enabled = !low;
        this.sun.castShadow = !low;
        this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
        for (const [, e] of this.cars) e.blob.visible = low;
        this.resize();
    }

    updateCars(snap, dt, time) {
        const seen = new Set();
        const localId = this.store.localId, followId = this.store.followId;
        for (const p of snap.players) {
            seen.add(p.id);
            const e = this.ensureCar(p);
            const rs = net.renderState(p.id, dt * 1000);
            if (rs) { e.x = rs.x; e.z = rs.y; e.a = rs.angle; }
            else { e.x = p.x; e.z = p.y; e.a = p.angle; }
            const isLocal = p.id === localId && net.local;
            const dashing = isLocal ? net.local.nitro > 0 : p.isDashing;
            const skidding = isLocal ? net.local.skid : p.skid;
            const maxHp = (CAR_TYPES[p.carType] || {}).hp || 100;
            const hp = Math.max(0, Math.min(100, ((p.hp ?? maxHp) / maxHp) * 100));
            const wrecked = !p.alive && hp <= 0;
            const sizeMult = (TYPE_SIZE[p.carType] || 1) * (p.scale || 1);
            const show = p.alive || wrecked;
            const g = e.car.group;
            g.visible = show;
            g.position.set(e.x, 0, e.z);
            g.rotation.y = -e.a;
            g.scale.setScalar(sizeMult);

            // wheels roll with the distance travelled; front wheels steer
            const dx = e.x - e.lastX, dz = e.z - e.lastZ;
            const fwd = dx * Math.cos(e.a) + dz * Math.sin(e.a);
            let da = e.a - e.lastA;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            const av = dt > 0 ? da / dt : 0;
            const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
            e.lastX = e.x; e.lastZ = e.z; e.lastA = e.a;
            if (Math.abs(fwd) < 200) for (const w of e.car.wheels) w.userData.spin.rotation.z -= fwd / (e.car.wheelR * sizeMult);
            e.steer += (Math.max(-0.5, Math.min(0.5, -av * 0.3)) - e.steer) * Math.min(1, dt * 12);
            for (const w of e.car.front) w.rotation.y = e.steer;
            // body leans into turns and squats under nitro
            const leanT = Math.max(-0.08, Math.min(0.08, av * speed * 0.00006));
            e.lean += (leanT - e.lean) * Math.min(1, dt * 8);
            e.car.body.rotation.x = e.lean;
            e.car.body.rotation.z = dashing ? -0.03 : 0;
            if (wrecked) { e.car.body.rotation.x = 0.12; e.car.body.rotation.z = 0.05; }

            // damage darkens / scorches the paint
            const dmg = 1 - hp / 100;
            e.car.paint.color.copy(e.car.baseColor).lerp(new THREE.Color(wrecked ? 0x1a1715 : 0x3a3532), wrecked ? 0.9 : dmg * 0.45);
            const braking = p.alive && (p.id === localId && net.local ? net.cur.forward < -0.05 : p.braking);
            e.car.tail.emissiveIntensity = braking ? 2.4 : 0.6;
            if (e.car.glow) e.car.glow.material.opacity = p.alive ? 0.55 + 0.2 * Math.sin(time * 0.006 + e.x) : 0;
            if (e.car.topper && e.car.topper.userData.spinner) e.car.topper.userData.spinner.rotation.y += dt * 14;

            // ring under the car (you = cyan, rivals = red, teams = team colour)
            const isMe = p.id === localId;
            const col = p.team ? (p.team === 1 ? 0xff4d3d : 0x3d8bff) : isMe ? 0x4fd8ff : 0xff4d3d;
            e.ring.visible = e.disc.visible = p.alive;
            e.ring.material.color.setHex(col); e.disc.material.color.setHex(col);
            e.ring.material.opacity = isMe ? 0.9 : 0.6; e.disc.material.opacity = isMe ? 0.16 : 0.1;
            e.ring.position.set(e.x, 1.3, e.z); e.disc.position.set(e.x, 1.25, e.z);
            e.ring.scale.setScalar(sizeMult); e.disc.scale.setScalar(sizeMult);
            e.blob.position.set(e.x + 4, 0.8, e.z + 6); e.blob.scale.set(48 * sizeMult, 1, 30 * sizeMult); e.blob.rotation.y = -e.a;
            e.blob.visible = this.low && show;

            // name + health bar above the car (fixed size on screen)
            const k = this.camDist / 900;
            const labelText = isMe ? `★ ${p.name || ''}` : (p.id === followId ? `👁 ${p.name || ''}` : (p.name || ''));
            const labelCol = isMe ? '#8fe3ff' : p.id === followId ? '#ffd27a' : '#ffffff';
            if (labelText + labelCol !== e.labelText) {
                if (e.label) { this.scene.remove(e.label); e.label.material.dispose(); }
                e.label = textSprite(labelText, { color: labelCol, size: 30 });
                this.scene.add(e.label);
                e.labelText = labelText + labelCol;
            }
            const topY = (e.car.roofY + 10) * sizeMult;
            e.label.visible = p.alive;
            e.label.position.set(e.x, topY + 26 * k, e.z);
            e.label.scale.set(22 * k * e.label.userData.aspect, 22 * k, 1);
            e.hpBg.visible = e.hpFill.visible = p.alive;
            e.hpBg.position.set(e.x, topY + 8 * k, e.z); e.hpBg.scale.set(54 * k, 8 * k, 1);
            e.hpFill.position.set(e.x - 25 * k, topY + 8 * k, e.z); e.hpFill.scale.set(50 * k * hp / 100 + 0.01, 5 * k, 1);
            e.hpFill.material.color.setHex(hp > 60 ? 0x3ddc84 : hp > 30 ? 0xffc93d : 0xff4d4d);
            e.hp = hp; e.alive = p.alive; e.sizeMult = sizeMult; e.team = p.team || 0;
            e.tint = cssToInt(resolveLook(p.carType, p.cosmetics).paint);

            // shield bubble
            e.shield.visible = !!(p.alive && p.shield);
            if (e.shield.visible) {
                e.shield.position.set(e.x, 16 * sizeMult, e.z);
                e.shield.scale.set(62 * sizeMult, 40 * sizeMult, 62 * sizeMult);
                e.shield.material.uniforms.uTime.value = time / 1000;
            }

            // Gatling gun on the roof: swings onto its target and rattles away
            const gunOn = p.alive && p.gun && !((p.gunLeft || 0) < 1 && Math.floor(time / 110) % 2 === 0);
            if (gunOn && !e.gun) e.gun = this.makeGun();
            if (e.gun) {
                e.gun.visible = gunOn;
                if (gunOn) {
                    const aim = e.a + ((p.gunAim || p.angle) - p.angle);
                    e.gun.position.set(e.x, (e.car.roofY - 1) * sizeMult, e.z);
                    e.gun.scale.setScalar(sizeMult);
                    e.gun.rotation.y = -aim;
                    e.gun.userData.barrels.rotation.x += dt * 40;
                    const mx = e.x + Math.cos(aim) * 38 * sizeMult, mz = e.z + Math.sin(aim) * 38 * sizeMult, my = (e.car.roofY + 7) * sizeMult;
                    this.fxAdd.emit({ x: mx, y: my, z: mz, spread: 30, life: 0.06, size: [22, 6], color: [0xfff4c0, 0xff9a2a], alpha: [1, 0], count: 2 });
                    if (Math.random() < 0.4) this.fxSmoke.emit({ x: mx, y: my, z: mz, spread: 20, life: 0.5, size: [6, 18], color: [0xcfcfcf, 0xaaaaaa], alpha: [0.35, 0], gravity: -20, count: 1 });
                    if (Math.random() < 0.5) {     // spent shell casings
                        const sa = aim + Math.PI / 2;
                        this.fxAdd.emit({ x: e.x + Math.cos(sa) * 8, y: my, z: e.z + Math.sin(sa) * 8, vx: Math.cos(sa) * 90, vz: Math.sin(sa) * 90, vy: 120, spread: 30, life: 0.4, size: [3, 2], color: [0xffd27a, 0xb07a20], alpha: [1, 0.6], gravity: 600, count: 1 });
                    }
                }
            }

            // spinning saws on steel arms
            const bladesOn = p.alive && p.blades && !((p.bladeLeft || 0) < 1.5 && Math.floor(time / 110) % 2 === 0);
            e.sawSpin += dt * 30;
            for (let i = 0; i < 2; i++) {
                const saw = e.saws[i], arm = e.arms[i];
                saw.visible = arm.visible = bladesOn;
                if (!bladesOn) continue;
                const side = i ? 1 : -1, off = 44 * sizeMult, fw = 12 * sizeMult;
                const sx = e.x + Math.cos(e.a) * fw - Math.sin(e.a) * off * side;
                const sz = e.z + Math.sin(e.a) * fw + Math.cos(e.a) * off * side;
                saw.position.set(sx, 12 * sizeMult, sz);
                saw.scale.setScalar(sizeMult);
                saw.rotation.y = e.sawSpin * side;
                const ax = e.x + Math.cos(e.a) * fw - Math.sin(e.a) * 16 * sizeMult * side;
                const az = e.z + Math.sin(e.a) * fw + Math.cos(e.a) * 16 * sizeMult * side;
                arm.position.set((sx + ax) / 2, 12 * sizeMult, (sz + az) / 2);
                arm.scale.set(Math.hypot(sx - ax, sz - az), sizeMult, sizeMult);
                arm.rotation.y = -Math.atan2(sz - az, sx - ax);
                if (Math.random() < 0.35) {
                    const ta = Math.random() * Math.PI * 2;
                    this.fxAdd.emit({ x: sx + Math.cos(ta) * 26 * sizeMult, y: 12, z: sz + Math.sin(ta) * 26 * sizeMult, spread: 180, life: 0.25, size: [5, 1], color: [0xfff1a0, 0xff8822], alpha: [1, 0], gravity: 300, count: 1 });
                }
            }

            // balloons floating on strings
            const balloonsOn = p.alive && p.bumper && !((p.bumperLeft || 0) < 1.5 && Math.floor(time / 110) % 2 === 0);
            e.strings.visible = balloonsOn;
            const sp = e.strings.geometry.attributes.position;
            for (let i = 0; i < e.balloons.length; i++) {
                const b = e.balloons[i];
                b.visible = balloonsOn;
                if (!balloonsOn) continue;
                const a = time * 0.0009 + (i / e.balloons.length) * Math.PI * 2;
                const rr = (62 + 3 * Math.sin(time * 0.004 + i)) * sizeMult;
                const bx = e.x + Math.cos(a) * rr, bz = e.z + Math.sin(a) * rr, by = (34 + 4 * Math.sin(time * 0.003 + i)) * sizeMult;
                b.position.set(bx, by, bz); b.scale.set(sizeMult, sizeMult * 1.15, sizeMult);
                sp.setXYZ(i * 2, e.x, 14 * sizeMult, e.z); sp.setXYZ(i * 2 + 1, bx, by - 9 * sizeMult, bz);
            }
            if (balloonsOn) sp.needsUpdate = true;

            // exhaust flames (nitro / speed boost), skid marks, damage smoke + fire
            if (p.alive) {
                const ca = Math.cos(e.a), sa = Math.sin(e.a);
                const rx = e.x - ca * 46 * sizeMult, rz = e.z - sa * 46 * sizeMult;
                if (dashing || p.speedMult > 1) {
                    const tc = cssToInt(trailColor(p.cosmetics ? p.cosmetics.trail : 'classic', time));
                    this.fxAdd.emit({ x: rx, y: 8 * sizeMult, z: rz, vx: -ca * 120, vz: -sa * 120, spread: 30, life: dashing ? 0.35 : 0.2, size: [dashing ? 26 : 14, 2], color: [0xffffff, tc], alpha: [1, 0], count: dashing ? 3 : 1 });
                    if (dashing) this.fxAdd.emit({ x: rx, y: 8 * sizeMult, z: rz, vx: -ca * 60, vz: -sa * 60, spread: 10, life: 0.25, size: [16, 4], color: [0x9fefff, 0x2fb6ff], alpha: [0.9, 0], count: 1 });
                }
                if ((skidding || dashing || p.slip > 0) && speed > 40) {
                    const bx = e.x - ca * 28 * sizeMult, bz = e.z - sa * 28 * sizeMult;
                    const px = -sa * 18 * sizeMult, pz = ca * 18 * sizeMult;
                    const L = [bx + px, bz + pz], R = [bx - px, bz - pz];
                    if (e.skidL) { this.addSkid(e.skidL[0], e.skidL[1], L[0], L[1]); this.addSkid(e.skidR[0], e.skidR[1], R[0], R[1]); }
                    e.skidL = L; e.skidR = R;
                    if (skidding && Math.random() < 0.35) this.fxSmoke.emit({ x: bx, y: 4, z: bz, spread: 30, life: 0.9, size: [14, 46], color: [0xe9e2da, 0xd9cfc4], alpha: [0.45, 0], gravity: -20, count: 1 });
                } else e.skidL = e.skidR = null;
            } else e.skidL = e.skidR = null;
            if (show) {
                const hx = e.x + Math.cos(e.a) * 26 * sizeMult, hz = e.z + Math.sin(e.a) * 26 * sizeMult, hy = 20 * sizeMult;
                const r = Math.random();
                if (wrecked) {
                    if (r < 0.5) this.fxSmoke.emit({ x: e.x, y: hy, z: e.z, spread: 20, life: 1.6, size: [24, 90], color: [0x2b2826, 0x5a5550], alpha: [0.7, 0], gravity: -50, count: 1 });
                    if (r < 0.4) this.fxAdd.emit({ x: e.x, y: hy, z: e.z, jitter: 30, spread: 30, life: 0.5, size: [24, 4], color: [0xffe08a, 0xff4a1a], alpha: [1, 0], gravity: -80, count: 1 });
                } else if (hp < 22) {
                    if (r < 0.5) this.fxAdd.emit({ x: hx, y: hy, z: hz, spread: 25, life: 0.45, size: [18, 3], color: [0xffe08a, 0xff4a1a], alpha: [1, 0], gravity: -70, count: 1 });
                    if (r < 0.35) this.fxSmoke.emit({ x: hx, y: hy, z: hz, spread: 18, life: 1.4, size: [16, 70], color: [0x3b3836, 0x6b6560], alpha: [0.65, 0], gravity: -40, count: 1 });
                } else if (hp < 45) {
                    if (r < 0.25) this.fxSmoke.emit({ x: hx, y: hy, z: hz, spread: 18, life: 1.3, size: [14, 60], color: [0x4a4644, 0x8a8480], alpha: [0.55, 0], gravity: -40, count: 1 });
                } else if (hp < 70) {
                    if (r < 0.12) this.fxSmoke.emit({ x: hx, y: hy, z: hz, spread: 18, life: 1.1, size: [12, 46], color: [0xb9b4ae, 0xd8d3cd], alpha: [0.4, 0], gravity: -30, count: 1 });
                }
            }
        }
        for (const id of [...this.cars.keys()]) if (!seen.has(id)) this.removeCar(id);
    }

    updateCamera(dt) {
        const focusId = this.store.followId || this.store.localId;
        const me = this.cars.get(focusId);
        const w = this.container.clientWidth, h = this.container.clientHeight;
        if (me) {
            if (!this.focus || this.focusId !== focusId) {
                if (!this.focus) this.focus = { x: me.x, z: me.z, vx: 0, vz: 0, lx: me.x, lz: me.z };
                this.focusId = focusId; this.focus.lx = me.x; this.focus.lz = me.z;
            }
            const f = this.focus;
            const vx = (me.x - f.lx) / Math.max(0.001, dt), vz = (me.z - f.lz) / Math.max(0.001, dt);
            f.lx = me.x; f.lz = me.z;
            if (Math.abs(vx) < 3000 && Math.abs(vz) < 3000) {
                const vk = 1 - Math.pow(0.02, dt);
                f.vx += (vx - f.vx) * vk; f.vz += (vz - f.vz) * vk;
            }
            const speed = Math.hypot(f.vx, f.vz);
            const lead = Math.min(150, speed * 0.28) / Math.max(1, speed);
            const ck = 1 - Math.pow(0.004, dt);
            f.x += (me.x + f.vx * lead - f.x) * ck;
            f.z += (me.z + f.vz * lead - f.z) * ck;
            this.zoomK += ((1 + 0.12 * Math.min(1, speed / 550)) - this.zoomK) * Math.min(1, dt * 2.5);
        }
        const f = this.focus || { x: 0, z: 0 };
        // about the same amount of arena across the screen on any device
        const zoom = Math.max(0.62, Math.min(1.0, Math.min(w, h) / 560));
        const visH = (h / zoom) * this.zoomK;
        const dist = this.camDist = (visH * 0.5) / Math.tan(FOV * Math.PI / 360) * 0.92;
        this.shake = Math.max(0, this.shake - dt * 2.6);
        const sk = this.shake * this.shake * 14;
        const sx = (Math.random() - 0.5) * sk, sz = (Math.random() - 0.5) * sk;
        this.camTarget = new THREE.Vector3(f.x, 0, f.z);
        this.camera.position.set(f.x + sx, Math.sin(ELEV) * dist, f.z + Math.cos(ELEV) * dist + sz);
        this.camera.lookAt(f.x + sx * 0.5, 0, f.z + sz * 0.5);
        // the sun's shadow box follows the action
        this.sun.position.set(f.x - 380, 900, f.z - 260);
        this.sun.target.position.set(f.x, 0, f.z);
    }

    updateEffects(snap, dt, time) {
        const sNow = net.serverNow();
        const since = Math.max(0, Math.min(0.3, (sNow - snap.timestamp) / 1000));

        // rockets
        const rSeen = new Set();
        for (const pr of (snap.projectiles || [])) {
            rSeen.add(pr.id);
            let m = this.rockets.get(pr.id);
            if (!m) {
                // a proper missile: white body, red nose and fins, and a roaring flame out the back
                m = new THREE.Group();
                const body = new THREE.Mesh(this.geo.rocketBody, this.mat.rocketBody);
                const nose = new THREE.Mesh(this.geo.rocketNose, this.mat.rocketRed);
                nose.position.x = 27;
                const fins = new THREE.Mesh(this.geo.rocketFins, this.mat.rocketRed);
                fins.position.x = -15;
                const fins2 = new THREE.Mesh(this.geo.rocketFins, this.mat.rocketRed);
                fins2.position.x = -15; fins2.rotation.x = Math.PI / 2;
                const flame = new THREE.Mesh(this.geo.rocketFlame, this.mat.rocketFlame);
                flame.position.x = -34;
                m.add(body, nose, fins, fins2, flame);
                m.userData.flame = flame;
                body.castShadow = nose.castShadow = fins.castShadow = !this.low;
                this.scene.add(m);
                this.rockets.set(pr.id, m);
            }
            const x = pr.x + pr.vx * since, z = pr.y + pr.vy * since;
            const ang = Math.atan2(pr.vy, pr.vx);
            m.position.set(x, 24, z);
            m.rotation.y = -ang;
            m.rotation.x = time * 0.012;                      // slow barrel roll
            const fl = m.userData.flame;
            fl.scale.set(0.8 + Math.random() * 0.5, 0.9 + Math.random() * 0.3, 0.9 + Math.random() * 0.3);
            const tx = x - Math.cos(ang) * 40, tz = z - Math.sin(ang) * 40;
            this.fxAdd.emit({ x: tx, y: 24, z: tz, spread: 40, life: 0.28, size: [34, 6], color: [0xfff0a0, 0xff3a0a], alpha: [1, 0], count: this.low ? 2 : 4 });
            this.fxSmoke.emit({ x: tx, y: 24, z: tz, spread: 14, life: 1.1, size: [14, 46], color: [0xe0e0e0, 0xa8a8a8], alpha: [0.5, 0], gravity: -12, count: this.low ? 1 : 2 });
        }
        for (const [id, m] of this.rockets) if (!rSeen.has(id)) { this.scene.remove(m); this.rockets.delete(id); }

        // Gatling tracers (extrapolated along their flight since the snapshot)
        {
            const bs = snap.bullets || [];
            const n = Math.min(200, bs.length);
            const M = this._tm || (this._tm = new THREE.Matrix4()), Q = this._tq || (this._tq = new THREE.Quaternion());
            const V = this._tv || (this._tv = new THREE.Vector3()), S = this._ts || (this._ts = new THREE.Vector3(1, 1, 1)), Y = new THREE.Vector3(0, 1, 0);
            for (let i = 0; i < n; i++) {
                const b = bs[i];
                V.set(b.x + b.vx * since, 22, b.y + b.vy * since);
                Q.setFromAxisAngle(Y, -Math.atan2(b.vy, b.vx));
                M.compose(V, Q, S);
                this.tracers.setMatrixAt(i, M);
            }
            this.tracers.count = n;
            this.tracers.instanceMatrix.needsUpdate = true;
        }

        // air-drop crates: parachute down, then sit there with the icon bobbing
        const puSeen = new Set();
        for (const pu of (snap.powerups || [])) {
            puSeen.add(pu.id);
            let d = this.crates.get(pu.id);
            if (!d) {
                const tex = crateTexture(pu.type);
                const crate = new THREE.Mesh(this.geo.crate, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
                crate.castShadow = !this.low;
                const chute = new THREE.Mesh(this.geo.chute, this.mat.chute);
                const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(makePowerupCanvas(pu.type)), depthTest: false }));
                icon.material.map.colorSpace = THREE.SRGBColorSpace;
                icon.renderOrder = 25;
                const blob = new THREE.Mesh(this.geo.blob, this.mat.blob);
                this.scene.add(crate, chute, icon, blob);
                d = { crate, chute, icon, blob, landed: false };
                this.crates.set(pu.id, d);
            }
            const f = Math.max(0, Math.min(1, (pu.landAt - sNow) / DROP_FALL_MS));
            const sway = Math.sin(time * 0.004 + pu.id) * 10 * f;
            const y = 15 + f * 320;
            d.crate.position.set(pu.x + sway, y, pu.y);
            d.crate.rotation.y = f > 0 ? Math.sin(time * 0.002 + pu.id) * 0.3 : 0.4;
            d.chute.visible = f > 0;
            d.chute.position.set(pu.x + sway, y + 50, pu.y);
            d.chute.material.color.setHex(0xffffff);
            d.icon.position.set(pu.x + sway, y + 34 + (f > 0 ? 0 : 6 * Math.sin(time * 0.005 + pu.id)), pu.y);
            d.icon.scale.setScalar(f > 0 ? 0 : 34);
            d.blob.position.set(pu.x, 0.9, pu.y); d.blob.scale.set(22 * (1 - 0.5 * f), 1, 22 * (1 - 0.5 * f));
            if (f === 0 && !d.landed) { d.landed = true; this.fxSmoke.emit({ x: pu.x, y: 4, z: pu.y, spread: 90, life: 0.9, size: [18, 50], color: [0xe0b48a, 0xd0a47a], alpha: [0.6, 0], count: 10 }); }
        }
        for (const [id, d] of this.crates) if (!puSeen.has(id)) {
            this.scene.remove(d.crate, d.chute, d.icon, d.blob);
            d.crate.material.map.dispose(); d.crate.material.dispose(); d.icon.material.map.dispose(); d.icon.material.dispose();
            this.crates.delete(id);
        }

        // cargo planes high above, with their shadow sweeping the arena
        const plSeen = new Set();
        for (const pl of (snap.planes || [])) {
            plSeen.add(pl.id);
            let d = this.planes.get(pl.id);
            if (!d) {
                const g = new THREE.Group();
                const white = new THREE.MeshStandardMaterial({ color: 0xf0f2f5, roughness: 0.45, metalness: 0.2 });
                const red = new THREE.MeshStandardMaterial({ color: 0xd6312f, roughness: 0.5 });
                const fus = new THREE.Mesh(new THREE.CylinderGeometry(14, 10, 150, 12).rotateZ(Math.PI / 2), white);
                const nose = new THREE.Mesh(new THREE.SphereGeometry(14, 12, 8), white); nose.position.x = 75;
                const wing = new THREE.Mesh(new THREE.BoxGeometry(46, 4, 220), white); wing.position.x = 10;
                const stripe = new THREE.Mesh(new THREE.BoxGeometry(30, 4.5, 222), red); stripe.position.x = 10;
                const tail = new THREE.Mesh(new THREE.BoxGeometry(26, 40, 4), red); tail.position.set(-62, 22, 0);
                const stab = new THREE.Mesh(new THREE.BoxGeometry(22, 3, 80), white); stab.position.x = -64;
                for (const s of [1, -1]) { const prop = new THREE.Mesh(new THREE.BoxGeometry(2, 34, 5), new THREE.MeshStandardMaterial({ color: 0x333333 })); prop.position.set(36, 0, s * 60); g.add(prop); }
                g.add(fus, nose, wing, stripe, tail, stab);
                g.traverse(o => { if (o.isMesh) o.castShadow = !this.low; });
                const shadow = new THREE.Mesh(new THREE.PlaneGeometry(170, 220).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: this.low ? 0.18 : 0, depthWrite: false }));
                this.scene.add(g, shadow);
                d = { g, shadow };
                this.planes.set(pl.id, d);
            }
            const x = pl.x + Math.cos(pl.angle) * PLANE_SPEED * since, z = pl.y + Math.sin(pl.angle) * PLANE_SPEED * since;
            d.g.position.set(x, 190, z);
            d.g.scale.setScalar(0.75);
            d.g.rotation.y = -pl.angle;
            d.g.children.filter(c => c.geometry && c.geometry.parameters && c.geometry.parameters.height === 34).forEach(pp => { pp.rotation.x += dt * 40; });
            d.shadow.position.set(x + 100, 1, z + 60); d.shadow.rotation.y = -pl.angle;
        }
        for (const [id, d] of this.planes) if (!plSeen.has(id)) {
            this.scene.remove(d.g, d.shadow);
            d.g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
            this.planes.delete(id);
        }

        // dropped traps: glossy oil slick / purple reverse pad
        const hzSeen = new Set();
        for (const hz of (snap.hazards || [])) {
            hzSeen.add(hz.id);
            let m = this.hazards.get(hz.id);
            if (!m) {
                if (hz.type === 'oil') {
                    m = new THREE.Group();
                    for (const [ox, oz, r] of [[0, 0, 40], [18, 10, 24], [-20, -8, 22], [6, -16, 18]]) {
                        const c = new THREE.Mesh(new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 0.05, metalness: 0.6, envMap: this.envTex, transparent: true, opacity: 0.88, depthWrite: false }));
                        c.position.set(ox, 1.4, oz); m.add(c);
                    }
                } else {
                    m = new THREE.Mesh(new THREE.RingGeometry(18, 34, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xa24aff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
                    m.position.y = 1.5;
                }
                this.scene.add(m);
                this.hazards.set(hz.id, m);
            }
            m.position.x = hz.x; m.position.z = hz.y;
            if (hz.type !== 'oil') m.rotation.y = time * 0.003;
        }
        for (const [id, m] of this.hazards) if (!hzSeen.has(id)) { this.scene.remove(m); m.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); this.hazards.delete(id); }

        // explosion flashes + shockwaves
        for (const b of this.boomPool) {
            if (b.t >= 1) { b.flash.visible = b.shock.visible = false; continue; }
            b.t += dt / 0.45;
            const k = Math.min(1, b.t);
            b.flash.visible = b.shock.visible = k < 1;
            b.flash.position.set(b.x, 20, b.z); b.flash.scale.setScalar(b.r * 0.6 * (0.4 + k));
            b.flash.material.opacity = 0.9 * (1 - k) * (1 - k);
            b.shock.position.set(b.x, 2, b.z); b.shock.scale.setScalar(b.r * (0.3 + k * 1.3));
            b.shock.material.opacity = 0.85 * (1 - k);
        }
        for (const d of this.debris) {
            if (d.life <= 0) continue;
            d.life -= dt;
            d.v.y -= 900 * dt;
            d.m.position.addScaledVector(d.v, dt);
            if (d.m.position.y < 2) { d.m.position.y = 2; d.v.y *= -0.35; d.v.x *= 0.6; d.v.z *= 0.6; }
            d.m.rotation.x += dt * 8; d.m.rotation.z += dt * 6;
            if (d.life <= 0) d.m.visible = false;
        }

        // floating pickup labels + emote bubbles
        const k = this.camDist / 900;
        for (const t of this.texts) {
            t.t += dt;
            const c = this.cars.get(t.follow);
            if (c) t.s.position.set(c.x, (c.car.roofY + 60) * c.sizeMult + t.t * 60, c.z);
            t.s.scale.set(26 * k * t.s.userData.aspect, 26 * k, 1);
            t.s.material.opacity = Math.max(0, 1 - t.t / 0.9);
        }
        this.texts = this.texts.filter(t => { if (t.t > 0.9) { this.scene.remove(t.s); t.s.material.dispose(); return false; } return true; });
        for (const b of this.emotes) {
            b.t += dt;
            const c = this.cars.get(b.id);
            if (!c || !c.alive) b.t = 99;
            if (c) {
                const pop = Math.min(1, b.t / 0.15);
                b.s.position.set(c.x, (c.car.roofY + 70) * c.sizeMult + b.t * 8, c.z);
                b.s.scale.set(30 * k * pop * b.s.userData.aspect, 30 * k * pop, 1);
                b.s.material.opacity = b.t > 1.9 ? Math.max(0, (2.4 - b.t) / 0.5) : 1;
            }
        }
        this.emotes = this.emotes.filter(b => { if (b.t > 2.4) { this.scene.remove(b.s); b.s.material.dispose(); return false; } return true; });

        // rocket lock-on on the rival your next shot will chase
        const localId = this.store.localId;
        const meC = this.cars.get(localId);
        const meS = snap.players.find(q => q.id === localId);
        this.lock.visible = false;
        if (meC && meS && meS.alive && snap.live) {
            const cars = [];
            for (const [id, e] of this.cars) cars.push({ id, x: e.x, y: e.z, alive: e.alive, team: e.team });
            const tgt = pickRocketTarget({ id: localId, x: meC.x, y: meC.z, angle: meC.a, team: meS.team }, cars);
            if (tgt) {
                const tc = this.cars.get(tgt.id);
                this.lock.visible = true;
                this.lock.position.set(tgt.x, 3, tgt.y);
                this.lock.scale.setScalar((64 + 5 * Math.sin(time * 0.012)) * (tc ? tc.sizeMult : 1));
                this.lock.rotation.y = time * 0.003;
                const ready = !(meS.shootCooldown > 0);
                this.lockMat.color.setHex(ready ? 0xff3d5a : 0x9aa3ad);
                this.lockMat.opacity = ready ? 0.95 : 0.5;
            }
        }

        // Hot Bomb: the bomb rides above its carrier
        const bomb = snap.mode === 'bomb' && snap.bomb;
        const carrier = bomb && snap.players.find(p => p.num === bomb.holder);
        const ce = carrier && this.cars.get(carrier.id);
        this.bomb.visible = !!ce;
        if (this.bombText) this.bombText.visible = !!ce;
        if (ce) {
            const fuse = Math.max(0, bomb.fuse - (snap.live ? since : 0));
            const beat = 1 + 0.15 * Math.max(0, Math.sin(time * (fuse < 3 ? 0.03 : 0.012)));
            const by = (ce.car.roofY + 40) * ce.sizeMult;
            this.bomb.position.set(ce.x, by, ce.z);
            this.bomb.scale.setScalar(1.6 * beat);
            this.fxAdd.emit({ x: ce.x + 7, y: by + 18, z: ce.z, spread: 60, life: 0.25, size: [7, 1], color: [0xffee88, 0xff6622], alpha: [1, 0], gravity: 100, count: 1 });
            const txt = fuse.toFixed(fuse < 3 ? 1 : 0);
            if (!this.bombText || this.bombText.userData.txt !== txt) {
                if (this.bombText) { this.scene.remove(this.bombText); this.bombText.material.dispose(); }
                this.bombText = textSprite(txt, { color: '#ff4d4d', size: 40 });
                this.bombText.userData.txt = txt;
                this.scene.add(this.bombText);
            }
            this.bombText.position.set(ce.x + 30 * k, by + 10, ce.z);
            this.bombText.scale.set(24 * k * this.bombText.userData.aspect, 24 * k, 1);
        }
    }

    // Arrows on the screen edge pointing at rivals you can't see
    drawOverlay(snap) {
        const cv = this.overlay, g = cv.getContext('2d');
        const dpr = cv.width / Math.max(1, this.container.clientWidth);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const W = this.container.clientWidth, H = this.container.clientHeight;
        g.clearRect(0, 0, W, H);
        const focusId = this.store.followId || this.store.localId;
        const v = new THREE.Vector3();
        for (const [id, e] of this.cars) {
            if (!e.alive || id === focusId) continue;
            v.set(e.x, 10, e.z).project(this.camera);
            const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
            if (v.z < 1 && sx > 10 && sx < W - 10 && sy > 10 && sy < H - 10) continue;
            const cx = W / 2, cy = H / 2;
            const dx = sx - cx, dy = sy - cy;
            const limX = W / 2 - 34, limT = H / 2 - Math.min(112, H * 0.22), limB = H / 2 - Math.min(86, H * 0.2);
            const t = Math.min(limX / Math.max(1, Math.abs(dx)), (dy < 0 ? limT : limB) / Math.max(1, Math.abs(dy)));
            const ax = cx + dx * t, ay = cy + dy * t, ang = Math.atan2(dy, dx), s = 13;
            g.fillStyle = 'rgba(0,0,0,0.5)';
            g.beginPath(); g.arc(ax, ay, s * 1.15, 0, Math.PI * 2); g.fill();
            g.fillStyle = `#${(e.team ? (e.team === 1 ? 0xff4d3d : 0x3d8bff) : e.tint || 0xff4d3d).toString(16).padStart(6, '0')}`;
            g.strokeStyle = '#fff'; g.lineWidth = 2;
            g.beginPath();
            g.moveTo(ax + Math.cos(ang) * s * 1.3, ay + Math.sin(ang) * s * 1.3);
            g.lineTo(ax + Math.cos(ang + 2.4) * s, ay + Math.sin(ang + 2.4) * s);
            g.lineTo(ax + Math.cos(ang - 2.4) * s, ay + Math.sin(ang - 2.4) * s);
            g.closePath(); g.fill(); g.stroke();
        }
    }

    dispose() {
        cancelAnimationFrame(this.raf);
        this.ro.disconnect();
        socket.off('collision', this._onCollision);
        socket.off('explosion', this._onExplosion);
        socket.off('playerEliminated', this._onEliminated);
        socket.off('powerupCollected', this._onPickup);
        socket.off('emote', this._onEmote);
        if (window.__dashView && window.__dashView.screenToWorldAngle) delete window.__dashView;
        for (const id of [...this.cars.keys()]) this.removeCar(id);
        this.fxAdd.dispose(); this.fxSmoke.dispose();
        this.scene.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
        });
        this.envTex.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
        this.overlay.remove();
    }
}

export default function Arena3D({ snapshot, localId, followId }) {
    const ref = useRef(null);
    const store = useRef({ snapshot, localId, followId });
    store.current.snapshot = snapshot;
    store.current.localId = localId;
    store.current.followId = followId;
    useEffect(() => {
        let view = null;
        try { view = new View3D(ref.current, store.current); } catch (e) { console.error('3D view failed', e); }
        return () => { if (view) view.dispose(); };
    }, []);
    return <div ref={ref} className="full-screen" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
}

void ARENAS;
