import * as THREE from 'three';
import { ARENAS, arenaEnv, HILL_RADIUS } from '../../../shared/physics.mjs';

// ─── The arena: ground, painted floor, racing track, guard rails, props ────
// World mapping: physics (x, y) → three (x, z); y is up.

function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

function canvasTex(c, repeat = 1) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (repeat !== 1) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
    return t;
}

// Warm sand outside the arena (tiles)
function sandCanvas() {
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#d98f56'; g.fillRect(0, 0, S, S);
    const r = rng(7);
    for (let i = 0; i < 2600; i++) {
        const v = r();
        g.fillStyle = v < 0.5 ? `rgba(255,214,160,${0.05 + r() * 0.08})` : `rgba(120,60,25,${0.04 + r() * 0.07})`;
        g.beginPath(); g.arc(r() * S, r() * S, 1 + r() * 4, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(140,72,35,0.12)'; g.lineWidth = 2;
    for (let i = 0; i < 14; i++) {      // dry cracks
        let x = r() * S, y = r() * S;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; g.lineTo(x, y); }
        g.stroke();
    }
    return c;
}

// The arena floor, painted once per arena type at its full size
function floorCanvas(key, R0) {
    const spec = ARENAS[key] || ARENAS.classic;
    const S = 2048, pad = 70, span = 2 * (R0 + pad), k = S / span;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const square = spec.shape === 'square', half = R0 * 0.89;
    g.translate(S / 2, S / 2); g.scale(k, k);
    const shape = (r) => { g.beginPath(); if (square) { const h = r * 0.89; g.rect(-h, -h, h * 2, h * 2); } else g.arc(0, 0, r, 0, Math.PI * 2); };
    // concrete apron under the rails
    g.fillStyle = spec.ice ? '#a9b8c4' : '#a8907c'; shape(R0 + pad); g.fill();
    // floor
    g.fillStyle = spec.ice ? '#dff2fb' : '#eab07a'; shape(R0); g.fill();
    const r = rng(key.length * 31 + 5);
    for (let i = 0; i < 6000; i++) {
        const x = (r() - 0.5) * 2 * R0, y = (r() - 0.5) * 2 * R0;
        g.fillStyle = spec.ice ? `rgba(255,255,255,${0.15 + r() * 0.2})` : r() < 0.5 ? `rgba(255,226,180,${0.06 + r() * 0.08})` : `rgba(150,80,35,${0.05 + r() * 0.06})`;
        g.beginPath(); g.arc(x, y, 1 + r() * 5, 0, Math.PI * 2); g.fill();
    }
    if (spec.ice) {
        // rink markings: red centre line + circle, blue lines, white scratches
        g.strokeStyle = 'rgba(214,49,47,0.7)'; g.lineWidth = 10;
        g.beginPath(); g.moveTo(-R0, 0); g.lineTo(R0, 0); g.stroke();
        g.beginPath(); g.arc(0, 0, 130, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = 'rgba(40,110,220,0.6)';
        for (const y of [-R0 * 0.4, R0 * 0.4]) { g.beginPath(); g.moveTo(-R0, y); g.lineTo(R0, y); g.stroke(); }
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2;
        for (let i = 0; i < 70; i++) { const a = r() * 6.28, rr = r() * R0 * 0.9; g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, 40 + r() * 120, a, a + 0.8); g.stroke(); }
        return c;
    }
    // red racing track around the edge with a dashed lane line
    const t0 = R0 * 0.74, t1 = R0 * 0.965;
    g.fillStyle = '#b8483f';
    if (square) { g.beginPath(); g.rect(-t1 * 0.89, -t1 * 0.89, t1 * 1.78, t1 * 1.78); g.rect(t0 * 0.89, -t0 * 0.89, -t0 * 1.78, t0 * 1.78); g.fill('evenodd'); }
    else { g.beginPath(); g.arc(0, 0, t1, 0, Math.PI * 2); g.arc(0, 0, t0, 0, Math.PI * 2, true); g.fill(); }
    for (let i = 0; i < 2500; i++) {     // track grain
        const a = r() * Math.PI * 2, rr = t0 + r() * (t1 - t0);
        const x = square ? null : Math.cos(a) * rr, y = square ? null : Math.sin(a) * rr;
        if (x === null) continue;
        g.fillStyle = r() < 0.5 ? 'rgba(255,190,170,0.08)' : 'rgba(80,20,15,0.1)';
        g.beginPath(); g.arc(x, y, 1 + r() * 3, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = '#f6e6cc'; g.lineWidth = 9;
    shape(t0); g.stroke();
    shape(t1); g.stroke();
    g.setLineDash([46, 40]); g.lineWidth = 6; g.strokeStyle = 'rgba(246,230,204,0.85)';
    shape((t0 + t1) / 2); g.stroke();
    g.setLineDash([]);
    // painted centre markings (no centre circle over the sinkhole)
    g.strokeStyle = 'rgba(250,236,210,0.85)'; g.lineWidth = 10;
    if (!spec.pit) {
        g.beginPath(); g.arc(0, 0, R0 * 0.18, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 6;
        g.beginPath(); g.moveTo(-R0 * 0.18, 0); g.lineTo(R0 * 0.18, 0); g.moveTo(0, -R0 * 0.18); g.lineTo(0, R0 * 0.18); g.stroke();
    }
    g.lineWidth = 7; g.strokeStyle = 'rgba(250,236,210,0.6)';
    shape(R0 * 0.48); g.stroke();
    // starting grid chevrons on the track
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2 + 0.2;
        g.save(); g.rotate(a); g.translate((t0 + t1) / 2, 0);
        g.beginPath(); g.moveTo(-14, -22); g.lineTo(10, 0); g.lineTo(-14, 22); g.lineTo(-4, 0); g.closePath(); g.fill();
        g.restore();
    }
    void half;
    return c;
}

function stripeCanvas(a = '#ffc21a', b = '#1a1a1a', n = 8) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = a; g.fillRect(0, 0, 256, 32);
    g.fillStyle = b;
    for (let x = -32; x < 256; x += 256 / n) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 48, 0); g.lineTo(x + 32, 0); g.fill(); }
    return c;
}

function bannerCanvas(i) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    const themes = [['#d6312f', '#ffc21a', 'DASH'], ['#1f6fe0', '#ffffff', 'ARENA'], ['#ffc21a', '#d6312f', 'NITRO'], ['#16a34a', '#ffffff', 'GO!']];
    const [bg, fg, txt] = themes[i % themes.length];
    g.fillStyle = bg; g.fillRect(0, 0, 256, 96);
    g.fillStyle = fg; g.font = 'italic bold 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, 128, 50);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 90);
    return c;
}

// Points along the fence: [x, z, angle-along-the-fence]
function fencePoints(env, n) {
    const out = [];
    if (env.shape === 'square') {
        const h = env.half, per = n / 4;
        const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
        for (let s = 0; s < 4; s++) {
            const [x0, z0] = corners[s], [x1, z1] = corners[(s + 1) % 4];
            for (let i = 0; i < per; i++) {
                const t = i / per;
                out.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, Math.atan2(z1 - z0, x1 - x0)]);
            }
        }
    } else {
        for (let i = 0; i < n; i++) {
            const a = i / n * Math.PI * 2;
            out.push([Math.cos(a) * env.R, Math.sin(a) * env.R, a + Math.PI / 2]);
        }
    }
    return out;
}

// Cut the sinkhole out of a material (anything closer to the centre than uPit)
function withPit(material, uniform) {
    material.onBeforeCompile = (sh) => {
        sh.uniforms.uPit = uniform;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
            .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uPit; varying vec3 vWorldP;')
            .replace('void main() {', 'void main() {\n if (uPit > 0.0 && length(vWorldP.xz) < uPit) discard;');
    };
    return material;
}

export class ArenaWorld {
    constructor(scene, { envMap, low } = {}) {
        this.scene = scene;
        this.pitUniform = { value: 0 };
        this.low = !!low;
        this.group = new THREE.Group();
        scene.add(this.group);
        this.key = null;
        this.R = 0;
        this.R0 = 850;
        this.state = '';
        this.envMap = envMap;

        // Endless sand
        const sand = canvasTex(sandCanvas(), 28);
        this.ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2),
            withPit(new THREE.MeshStandardMaterial({ map: sand, roughness: 0.95 }), this.pitUniform));
        this.ground.position.y = -0.6;
        this.ground.receiveShadow = true;
        scene.add(this.ground);

        // Darkens everything outside the live fence (follows the shrinking arena)
        this.outside = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
            transparent: true, depthWrite: false,
            uniforms: { uR: { value: 850 }, uR0: { value: 850 }, uSquare: { value: 0 }, uTint: { value: new THREE.Color(0x150c08) } },
            vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
            // only the part of the arena that has been closed off gets darker; the desert stays bright
            fragmentShader: `uniform float uR; uniform float uR0; uniform float uSquare; uniform vec3 uTint; varying vec2 vP;
                void main(){ float d = uSquare > 0.5 ? max(abs(vP.x), abs(vP.y)) / 0.89 : length(vP);
                float a = smoothstep(uR + 6.0, uR + 40.0, d) * (1.0 - smoothstep(uR0 + 20.0, uR0 + 80.0, d)) * 0.4;
                gl_FragColor = vec4(uTint, a); }`,
        }));
        this.outside.position.y = 0.9;
        this.outside.renderOrder = 2;
        scene.add(this.outside);

        // Guard rail: posts + two rails, and red/white kerb stones, all instanced
        const N = 96;
        this.N = N;
        this.railMat = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.35, metalness: 0.75, envMap, emissive: 0x000000 });
        this.postMat = new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.6, metalness: 0.5 });
        this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(7, 26, 7), this.postMat, N);
        this.rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 5, 3), this.railMat, N * 2);
        this.kerb = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 3, 14), new THREE.MeshStandardMaterial({ roughness: 0.6 }), N * 2);
        for (const m of [this.posts, this.rails, this.kerb]) { m.castShadow = !this.low; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }

        // Glow along the fence (locked = green, electric = cyan)
        this.fenceGlow = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 30, 6), new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), N);
        this.fenceGlow.frustumCulled = false;
        scene.add(this.fenceGlow);

        // Sinkhole
        this.pit = new THREE.Group();
        const pitWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.86, 1, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a1a12, side: THREE.BackSide, roughness: 1 }));
        pitWall.scale.set(1, 120, 1); pitWall.position.y = -60;
        const pitFloor = new THREE.Mesh(new THREE.CircleGeometry(0.86, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050302 }));
        pitFloor.position.y = -119;
        const hz = canvasTex(stripeCanvas(), 1); hz.wrapS = THREE.RepeatWrapping; hz.repeat.set(10, 1);
        const pitRim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 48), new THREE.MeshStandardMaterial({ map: hz, roughness: 0.6 }));
        pitRim.rotation.x = Math.PI / 2; pitRim.position.y = 1.5;
        this.pitParts = { pitWall, pitFloor, pitRim };
        this.pit.add(pitWall, pitFloor, pitRim);
        this.pit.visible = false;
        scene.add(this.pit);

        // Windmill bar
        this.windmill = new THREE.Group();
        const barTex = canvasTex(stripeCanvas('#c9ced6', '#5a606a', 24), 1);
        this.bar = new THREE.Mesh(new THREE.BoxGeometry(1, 24, 30), [
            new THREE.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.5 }), new THREE.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.5 }),
            new THREE.MeshStandardMaterial({ map: barTex, roughness: 0.35, metalness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x3a3f47 }),
            new THREE.MeshStandardMaterial({ map: barTex, roughness: 0.35, metalness: 0.6 }), new THREE.MeshStandardMaterial({ map: barTex, roughness: 0.35, metalness: 0.6 }),
        ]);
        this.bar.position.y = 16; this.bar.castShadow = true;
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(34, 40, 36, 20), new THREE.MeshStandardMaterial({ color: 0x6b717c, roughness: 0.4, metalness: 0.7, envMap }));
        hub.position.y = 18; hub.castShadow = true;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 4, 16), new THREE.MeshStandardMaterial({ color: 0xffc21a, emissive: 0x553300 }));
        cap.position.y = 38;
        this.windmill.add(this.bar, hub, cap);
        this.windmill.visible = false;
        scene.add(this.windmill);

        // King of the Hill zone
        this.hill = new THREE.Group();
        this.hillFill = new THREE.Mesh(new THREE.CircleGeometry(HILL_RADIUS, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
        this.hillRing = new THREE.Mesh(new THREE.RingGeometry(HILL_RADIUS - 6, HILL_RADIUS + 2, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
        this.hillFill.position.y = 1.2; this.hillRing.position.y = 1.4;
        this.hill.add(this.hillFill, this.hillRing);
        this.hill.visible = false;
        scene.add(this.hill);

        this.props = new THREE.Group();
        scene.add(this.props);
    }

    // Rebuild the per-arena parts (floor paint + props) when the arena type changes
    setArena(key, R0) {
        if (key === this.key && R0 === this.R0) return;
        this.key = key; this.R0 = R0;
        const spec = ARENAS[key] || ARENAS.classic;
        if (this.floor) { this.scene.remove(this.floor); this.floor.material.map.dispose(); this.floor.material.dispose(); this.floor.geometry.dispose(); }
        const pad = 70;
        const tex = canvasTex(floorCanvas(key, R0));
        const fm = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: spec.ice ? 0.15 : 0.9, metalness: spec.ice ? 0.1 : 0, envMap: spec.ice ? this.envMap : null, envMapIntensity: 0.6 });
        withPit(fm, this.pitUniform);                    // the sinkhole cuts a real hole in the floor
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * (R0 + pad), 2 * (R0 + pad)).rotateX(-Math.PI / 2), fm);
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);
        this.outside.material.uniforms.uSquare.value = spec.shape === 'square' ? 1 : 0;
        this.outside.material.uniforms.uR0.value = R0;
        this.outside.material.uniforms.uTint.value.set(spec.ice ? 0x0d1a26 : 0x150c08);
        this.pit.visible = !!spec.pit;
        this.windmill.visible = !!spec.bar;
        this.buildProps(key, R0, spec);
        this.R = 0;                      // force the fence to be laid out again
    }

    buildProps(key, R0, spec) {
        for (const c of [...this.props.children]) {
            this.props.remove(c);
            c.traverse(o => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map && m.map.dispose(); m.dispose(); }); } });
        }
        const r = rng(key.length * 97 + 13);
        const sq = spec.shape === 'square';
        const place = (minD, maxD) => {
            const a = r() * Math.PI * 2, d = minD + r() * (maxD - minD);
            if (sq) { const t = (r() - 0.5) * 2; const side = Math.floor(r() * 4); const h = R0 * 0.89 + d - R0; return side === 0 ? [t * h, -h] : side === 1 ? [h, t * h] : side === 2 ? [t * h, h] : [-h, t * h]; }
            return [Math.cos(a) * d, Math.sin(a) * d];
        };
        const shadow = !this.low;
        const inst = (geom, material, n, fn) => {
            const m = new THREE.InstancedMesh(geom, material, n);
            const o = new THREE.Object3D();
            for (let i = 0; i < n; i++) { fn(o, i); o.updateMatrix(); m.setMatrixAt(i, o.matrix); }
            m.castShadow = shadow; m.receiveShadow = true;
            this.props.add(m);
            return m;
        };
        // wooden crates
        const crateC = document.createElement('canvas'); crateC.width = crateC.height = 64;
        const cg = crateC.getContext('2d'); cg.fillStyle = '#b07a3e'; cg.fillRect(0, 0, 64, 64); cg.strokeStyle = '#6b4520'; cg.lineWidth = 6; cg.strokeRect(3, 3, 58, 58);
        cg.beginPath(); cg.moveTo(4, 4); cg.lineTo(60, 60); cg.moveTo(60, 4); cg.lineTo(4, 60); cg.stroke();
        inst(new THREE.BoxGeometry(34, 34, 34), new THREE.MeshStandardMaterial({ map: canvasTex(crateC), roughness: 0.9 }), 26, (o) => {
            const [x, z] = place(R0 + 110, R0 + 520);
            o.position.set(x, 17 + (r() < 0.25 ? 34 : 0), z); o.rotation.y = r() * Math.PI;
        });
        // traffic cones (orange with a white band)
        const coneC = document.createElement('canvas'); coneC.width = 16; coneC.height = 64;
        const kg = coneC.getContext('2d'); kg.fillStyle = '#ff6a1a'; kg.fillRect(0, 0, 16, 64); kg.fillStyle = '#ffffff'; kg.fillRect(0, 22, 16, 12);
        inst(new THREE.ConeGeometry(7, 22, 10), new THREE.MeshStandardMaterial({ map: canvasTex(coneC), roughness: 0.6 }), 40, (o) => {
            const [x, z] = place(R0 + 95, R0 + 260);
            o.position.set(x, 11, z);
        });
        // tyre stacks
        inst(new THREE.TorusGeometry(13, 6, 8, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d1e22, roughness: 0.95 }), 48, (o, i) => {
            if (i % 3 === 0) { const [x, z] = place(R0 + 140, R0 + 420); this._tx = x; this._tz = z; }
            o.position.set(this._tx, 6 + (i % 3) * 11, this._tz);
        });
        // barrels (red / yellow)
        const barrels = inst(new THREE.CylinderGeometry(10, 10, 28, 12), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }), 18, (o) => {
            const [x, z] = place(R0 + 120, R0 + 480);
            o.position.set(x, 14, z);
        });
        for (let i = 0; i < 18; i++) barrels.setColorAt(i, new THREE.Color(i % 2 ? 0xd6312f : 0xffc21a));
        // rocks
        inst(new THREE.DodecahedronGeometry(16, 0), new THREE.MeshStandardMaterial({ color: 0xa8673d, roughness: 1, flatShading: true }), 30, (o) => {
            const [x, z] = place(R0 + 200, R0 + 900);
            const s = 0.5 + r() * 1.6;
            o.position.set(x, 4 * s, z); o.scale.set(s, s * 0.7, s); o.rotation.set(r(), r() * 3, r());
        });
        // banner walls (big sponsor boards)
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + 0.4, d = R0 + 150;
            const x = sq ? Math.sign(Math.cos(a)) * Math.min(Math.abs(Math.cos(a)) * 2, 1) * (R0 * 0.89 + 150) : Math.cos(a) * d;
            const z = sq ? Math.sign(Math.sin(a)) * Math.min(Math.abs(Math.sin(a)) * 2, 1) * (R0 * 0.89 + 150) : Math.sin(a) * d;
            const g = new THREE.Group();
            const board = new THREE.Mesh(new THREE.BoxGeometry(180, 64, 6), [
                new THREE.MeshStandardMaterial({ color: 0x555b66 }), new THREE.MeshStandardMaterial({ color: 0x555b66 }),
                new THREE.MeshStandardMaterial({ color: 0x555b66 }), new THREE.MeshStandardMaterial({ color: 0x555b66 }),
                new THREE.MeshStandardMaterial({ map: canvasTex(bannerCanvas(i)), roughness: 0.6 }),
                new THREE.MeshStandardMaterial({ map: canvasTex(bannerCanvas(i + 1)), roughness: 0.6 }),
            ]);
            board.position.y = 52; board.castShadow = shadow;
            for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(6, 40, 6), new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.5 })); leg.position.set(s * 70, 20, 0); g.add(leg); }
            g.add(board);
            g.position.set(x, 0, z);
            g.lookAt(0, 0, 0);
            this.props.add(g);
        }
        // light towers with glowing lamps
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4, d = (sq ? R0 * 1.2 : R0) + 260;
            const g = new THREE.Group();
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 180, 8), new THREE.MeshStandardMaterial({ color: 0x4a515c, metalness: 0.6 }));
            pole.position.y = 90; pole.castShadow = shadow;
            const head = new THREE.Mesh(new THREE.BoxGeometry(46, 22, 10), new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 1.1 }));
            head.position.y = 182;
            g.add(pole, head);
            g.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
            g.lookAt(0, 0, 0);
            this.props.add(g);
        }
    }

    // Per frame: fence follows the shrinking radius; hazards animate
    update(snap, time, myId) {
        const env = arenaEnv(snap.arena || 'classic', snap.arenaRadius || 850, snap.barAngle || 0);
        const spec = ARENAS[snap.arena] || ARENAS.classic;
        const locked = snap.fenceLock > 0, electric = !!snap.suddenDeath;
        const state = `${locked}|${electric}`;
        if (Math.abs(env.R - this.R) > 0.4 || state !== this.state) {
            this.R = env.R; this.state = state;
            this.layoutFence(env, locked, electric);
        }
        // glow pulses
        const pulse = 0.5 + 0.5 * Math.sin(time * (electric ? 0.012 : 0.008));
        this.fenceGlow.visible = locked || electric;
        this.fenceGlow.material.color.set(electric ? 0x4fd8ff : 0x3ddc84);
        this.fenceGlow.material.opacity = (electric ? 0.35 : 0.28) * (0.5 + pulse * 0.5);
        this.railMat.emissive.set(electric ? 0x1a8fd0 : locked ? 0x1f8a4e : 0x000000);
        this.railMat.emissiveIntensity = electric || locked ? 0.4 + 0.5 * pulse : 0;
        this.outside.material.uniforms.uR.value = env.shape === 'square' ? env.half / 0.89 : env.R;

        // sinkhole follows the arena size
        if (spec.pit) {
            const pr = env.pitR;
            this.pit.scale.set(pr, 1, pr);
            this.pitUniform.value = pr;
        } else this.pitUniform.value = 0;

        // windmill bar
        if (spec.bar) {
            const bar = ARENAS[snap.arena].bar;
            const ang = snap.barAngle + (snap.live ? bar.speed * Math.max(0, Math.min(0.3, (this.serverNow() - snap.timestamp) / 1000)) : 0);
            this.windmill.rotation.y = -ang;
            this.bar.scale.x = env.R * bar.len * 2;
        }

        // King of the Hill zone
        const koth = snap.mode === 'koth';
        this.hill.visible = koth;
        if (koth) {
            const h = snap.hill || {};
            const mine = h.holder && snap.players.some(p => p.num === h.holder && p.id === myId);
            const col = h.contested ? 0xff4d3d : h.holder ? (mine ? 0x4dff88 : 0xffc53d) : 0xffffff;
            this.hillFill.material.color.set(col);
            this.hillRing.material.color.set(col);
            this.hillFill.material.opacity = 0.12 + (h.holder || h.contested ? 0.1 * pulse : 0);
            this.hillRing.material.opacity = 0.55 + 0.35 * pulse;
        }
    }

    layoutFence(env, locked, electric) {
        const pts = fencePoints(env, this.N);
        const o = new THREE.Object3D();
        const red = new THREE.Color(electric ? 0x1a6c94 : 0xd6312f), white = new THREE.Color(electric ? 0x0c3550 : 0xf1f1f1);
        for (let i = 0; i < pts.length; i++) {
            const [x, z, a] = pts[i];
            const [nx, nz] = pts[(i + 1) % pts.length];
            // outward normal (fence sits just outside the line, kerb just inside)
            const len = Math.hypot(nx - x, nz - z);
            const ox = Math.sin(a), oz = -Math.cos(a);        // perpendicular to the fence direction
            const sgn = (x * ox + z * oz) > 0 ? 1 : -1;
            const px = ox * sgn, pz = oz * sgn;
            o.position.set(x + px * 8, 13, z + pz * 8); o.rotation.set(0, -a, 0); o.scale.set(1, 1, 1); o.updateMatrix();
            this.posts.setMatrixAt(i, o.matrix);
            this.fenceGlow.setMatrixAt(i, (o.scale.set(len, 1, 1), o.position.set((x + nx) / 2 + px * 8, 15, (z + nz) / 2 + pz * 8), o.updateMatrix(), o.matrix));
            for (let k = 0; k < 2; k++) {
                o.position.set((x + nx) / 2 + px * 8, 9 + k * 9, (z + nz) / 2 + pz * 8); o.scale.set(len, 1, 1); o.updateMatrix();
                this.rails.setMatrixAt(i * 2 + k, o.matrix);
            }
            for (let k = 0; k < 2; k++) {
                const t = k / 2, t2 = (k + 1) / 2;
                const kx = x + (nx - x) * (t + t2) / 2 - px * 6, kz = z + (nz - z) * (t + t2) / 2 - pz * 6;
                o.position.set(kx, 1.2, kz); o.scale.set(len / 2 + 0.5, 1, 1); o.updateMatrix();
                this.kerb.setMatrixAt(i * 2 + k, o.matrix);
                this.kerb.setColorAt(i * 2 + k, (i * 2 + k) % 2 ? white : red);
            }
        }
        for (const m of [this.posts, this.rails, this.kerb, this.fenceGlow]) { m.instanceMatrix.needsUpdate = true; }
        if (this.kerb.instanceColor) this.kerb.instanceColor.needsUpdate = true;
    }
}
