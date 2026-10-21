import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { resolveLook } from '../carRender';
import { underglowColor } from '../cosmetics';

// ─── Procedural low-poly 3D cars ───────────────────────────────────────────
// Built from simple shapes in local units: the car points along +x, is
// 88 long and 46 wide (the physics box at size 1), y is up. Every car type
// gets its own proportions and parts so the eight roles read at a glance.

export const CAR_LEN = 88, CAR_WID = 46;

const TYPES = {
    //            body height, cabin height, cabin span (from the nose), cabin width, wheel radius, ride height
    sports:   { h: 12, cabH: 10, cab: [0.34, 0.70], cabW: 0.78, wheelR: 8.5, ride: 6, hoodDrop: 2 },
    muscle:   { h: 14, cabH: 10, cab: [0.42, 0.76], cabW: 0.80, wheelR: 9.5, ride: 6.5, wide: 1.04 },
    truck:    { h: 17, cabH: 14, cab: [0.20, 0.50], cabW: 0.88, wheelR: 11.5, ride: 9, bed: true, bullbar: true, wide: 1.04 },
    rally:    { h: 14, cabH: 12, cab: [0.30, 0.84], cabW: 0.84, wheelR: 9.5, ride: 8.5, roofRack: true, flaps: true },
    kart:     { kart: true, wheelR: 8.5, ride: 3 },
    suv:      { h: 18, cabH: 14, cab: [0.26, 0.92], cabW: 0.88, wheelR: 11, ride: 9, roofRails: true, spare: true },
    drift:    { h: 11, cabH: 9.5, cab: [0.38, 0.70], cabW: 0.78, wheelR: 9, ride: 5, flares: true },
    supercar: { h: 9.5, cabH: 8.5, cab: [0.30, 0.62], cabW: 0.72, wheelR: 9, ride: 4.5, hoodDrop: 3, vents: true, intakes: true },
};

// ── shared, never disposed (reused by every car) ──
const GEO = {};
const geo = (key, make) => (GEO[key] || (GEO[key] = make()));
const MAT = {};
const mat = (key, make) => (MAT[key] || (MAT[key] = make()));
const darkTrim = () => mat('trim', () => new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.7, metalness: 0.2 }));
const rubber = () => mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.9 }));
const headMat = () => mat('head', () => new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c0, emissiveIntensity: 1.2 }));

function finishParams(finish) {
    switch (finish) {
        case 'metallic': return { roughness: 0.32, metalness: 0.55 };
        case 'matte': return { roughness: 0.85, metalness: 0.0 };
        case 'chrome': return { roughness: 0.08, metalness: 1.0 };
        default: return { roughness: 0.38, metalness: 0.08 };    // gloss
    }
}

function box(w, h, d, m, r = 0) {
    const g = r > 0 ? geo(`rb${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, 2, r)) : geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
    return new THREE.Mesh(g, m);
}

// Top-down livery painted onto a canvas laid over the bonnet / roof / boot
const decalCache = new Map();
function decalTexture(look) {
    const key = `${look.decal}|${look.decalColor}|${look.number}`;
    if (decalCache.has(key)) return decalCache.get(key);
    const W = 256, H = 128, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const col = look.decalColor;
    g.fillStyle = col; g.strokeStyle = col;
    if (look.decal === 'stripes') {
        g.fillRect(0, H * 0.36, W, H * 0.1); g.fillRect(0, H * 0.54, W, H * 0.1);
    } else if (look.decal === 'flames') {
        const grad = g.createLinearGradient(W, 0, W * 0.4, 0);
        grad.addColorStop(0, col); grad.addColorStop(1, 'rgba(255,90,20,0)');
        g.fillStyle = grad;
        for (const y of [0.25, 0.5, 0.75]) {
            g.beginPath(); g.moveTo(W, H * (y - 0.12));
            g.quadraticCurveTo(W * 0.55, H * (y - 0.2), W * 0.4, H * y);
            g.quadraticCurveTo(W * 0.6, H * (y + 0.05), W, H * (y + 0.12)); g.fill();
        }
    } else if (look.decal === 'checker') {
        const s = 16;
        for (let x = W * 0.38; x < W * 0.7; x += s) for (let y = 0; y < H; y += s) {
            if (((x / s) + (y / s)) % 2 < 1) g.fillRect(x, y, s, s);
        }
    } else if (look.decal === 'number') {
        g.beginPath(); g.arc(W * 0.52, H / 2, H * 0.3, 0, Math.PI * 2); g.fillStyle = '#f4f4f4'; g.fill();
        g.fillStyle = '#111'; g.font = `bold ${H * 0.4}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.save(); g.translate(W * 0.52, H / 2); g.rotate(Math.PI / 2); g.fillText(String(look.number || 7), 0, 2); g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    decalCache.set(key, t);
    return t;
}

function wheel(r, w, rimColor) {
    const grp = new THREE.Group();
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(geo(`tire${r}|${w}`, () => new THREE.CylinderGeometry(r, r, w, 16).rotateX(Math.PI / 2)), rubber());
    const rim = new THREE.Mesh(geo(`rim${r}|${w}`, () => new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.6, 10).rotateX(Math.PI / 2)),
        mat(`rim${rimColor}`, () => new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.3, metalness: 0.8 })));
    const hub = new THREE.Mesh(geo(`hub${r}|${w}`, () => new THREE.BoxGeometry(r * 1.05, r * 0.22, w + 1)), darkTrim());
    tire.castShadow = true;
    spin.add(tire, rim, hub);
    grp.add(spin);
    grp.userData.spin = spin;
    return grp;
}

// Hats (toppers) — little 3D props on the roof
function makeTopper(key, paint) {
    const g = new THREE.Group();
    const m = (c, e = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: e ? c : 0x000000, emissiveIntensity: e });
    if (key === 'party') {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(5, 13, 12), m(0xff4fa8)); cone.position.y = 6.5; g.add(cone);
        const pom = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), m(0xffe14d)); pom.position.y = 13.5; g.add(pom);
    } else if (key === 'crown') {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 4, 10, 1, true), m(0xffc83d, 0.2)); band.position.y = 2; g.add(band);
        for (let i = 0; i < 5; i++) {
            const a = i / 5 * Math.PI * 2, s = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4.5, 6), m(0xffc83d, 0.2));
            s.position.set(Math.cos(a) * 5.4, 6, Math.sin(a) * 5.4); g.add(s);
        }
    } else if (key === 'halo') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 1.2, 8, 24), m(0xfff3a0, 1.2)); ring.rotation.x = Math.PI / 2; ring.position.y = 9; g.add(ring);
    } else if (key === 'propeller') {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(0x3d8bff)); g.add(cap);
        const prop = new THREE.Group(); prop.position.y = 6.5;
        for (const s of [1, -1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(12, 0.8, 2.6), m(s > 0 ? 0xff4d4d : 0xffe14d)); b.position.x = s * 6; prop.add(b); }
        g.add(prop); g.userData.spinner = prop;
    } else if (key === 'horns') {
        for (const s of [1, -1]) {
            const h = new THREE.Mesh(new THREE.ConeGeometry(2, 9, 8), m(0xb3201f)); h.position.set(0, 4, s * 5); h.rotation.x = s * 0.5; g.add(h);
        }
    } else if (key === 'cap') {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(5.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(paint)); g.add(dome);
        const brim = new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 9), m(paint)); brim.position.set(6, 0.4, 0); g.add(brim);
    } else if (key === 'antenna') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 16, 6), m(0x333333)); pole.position.set(-6, 8, 6); g.add(pole);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), m(0xff3d3d, 0.6)); ball.position.set(-6, 16.5, 6); g.add(ball);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
}

function glowTexture() {
    return mat('glowTex', () => {
        const s = 128, c = document.createElement('canvas');
        c.width = c.height = s;
        const g = c.getContext('2d');
        const rg = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
        rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.fillRect(0, 0, s, s);
        return new THREE.CanvasTexture(c);
    });
}

// Build a car. Returns { group, wheels, front, paint, tail, glow, topper, type, lookKey, roofY }
export function buildCar(type, cosmetics, envMap) {
    const T = TYPES[type] || TYPES.sports;
    const look = resolveLook(type, cosmetics);
    const L = CAR_LEN, W = CAR_WID * (T.wide || 1);
    const root = new THREE.Group();
    const body = new THREE.Group();          // everything that leans / bounces
    root.add(body);
    const fp = finishParams(look.finish);
    const paint = new THREE.MeshStandardMaterial({ color: look.paint, ...fp, envMap, envMapIntensity: look.finish === 'chrome' ? 1.4 : 0.8 });
    const baseColor = new THREE.Color(look.paint);
    const glass = new THREE.MeshStandardMaterial({
        color: look.tint === 'dark' ? 0x0b0d12 : look.tint === 'mirror' ? 0x8fa6bf : 0x1d2a3a,
        roughness: 0.08, metalness: look.tint === 'mirror' ? 0.95 : 0.3, envMap, envMapIntensity: 1.2,
    });
    const tail = new THREE.MeshStandardMaterial({ color: 0x8a0d10, emissive: 0xff1a1a, emissiveIntensity: 0.6 });
    const add = (m, x, y, z, parent = body) => { m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    let roofY;

    if (T.kart) {
        // Open-wheel kart: flat floor, nose cone, side pods, driver in a helmet
        add(box(70, 3.5, 30, darkTrim(), 1.5), 0, T.ride + 2, 0);
        add(box(30, 6, 22, paint, 3), 26, T.ride + 6, 0);                     // nose
        const noseTip = new THREE.Mesh(geo('kartnose', () => new THREE.ConeGeometry(9, 16, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4)), paint);
        add(noseTip, 44, T.ride + 6, 0);
        for (const s of [1, -1]) add(box(36, 6, 8, paint, 2.5), -4, T.ride + 6, s * 17);   // side pods
        add(box(16, 10, 18, darkTrim(), 3), -10, T.ride + 9, 0);              // seat
        add(box(10, 9, 14, paint, 3), -6, T.ride + 15, 0);                    // driver body
        const helmet = add(new THREE.Mesh(geo('helmet', () => new THREE.SphereGeometry(6.5, 14, 10)), paint), -4, T.ride + 24, 0);
        add(new THREE.Mesh(geo('visor', () => new THREE.SphereGeometry(6.6, 12, 8, -Math.PI / 3, Math.PI / 1.5, Math.PI / 3, Math.PI / 4)), glass), -4, T.ride + 24, 0);
        void helmet;
        add(box(8, 2, 34, darkTrim()), -36, T.ride + 16, 0);                  // rear wing
        for (const s of [1, -1]) add(box(6, 10, 1.5, darkTrim()), -36, T.ride + 11, s * 16);
        roofY = T.ride + 30;
    } else {
        const bodyY = T.ride + T.h / 2;
        // chassis + main body (rounded) + bumpers
        add(box(L - 4, 4, W - 6, darkTrim(), 1.5), 0, T.ride + 1.5, 0);
        const shell = add(box(L, T.h, W, paint, 4), 0, bodyY, 0);
        shell.receiveShadow = true;
        if (T.hoodDrop) {   // bonnet slopes down to a lower nose
            const nose = add(box(L * 0.26, T.h - T.hoodDrop, W * 0.96, paint, 3), L * 0.4, bodyY - T.hoodDrop / 2, 0);
            nose.scale.set(1, 1, 1);
        }
        add(box(4, 6, W * 0.92, darkTrim(), 1.5), L / 2 + 0.5, T.ride + 4, 0);      // front bumper
        add(box(4, 6, W * 0.92, darkTrim(), 1.5), -L / 2 - 0.5, T.ride + 4, 0);     // rear bumper
        // cabin: dark glass box with a painted roof on top
        const c0 = L / 2 - T.cab[0] * L, c1 = L / 2 - T.cab[1] * L;      // front / back x
        const cabLen = c0 - c1, cabX = (c0 + c1) / 2, cabTop = T.ride + T.h + T.cabH;
        add(box(cabLen, T.cabH, W * T.cabW, glass, 3), cabX - 1, T.ride + T.h + T.cabH / 2 - 0.5, 0);
        add(box(cabLen * 0.78, 2.2, W * T.cabW * 0.94, paint, 1), cabX - 2.5, cabTop, 0);
        roofY = cabTop + 1.2;
        // lights
        for (const s of [1, -1]) {
            add(box(2, 3, 7, headMat()), L / 2 - 0.5, bodyY + 1, s * (W / 2 - 7));
            add(box(2, 3, 8, tail), -L / 2 + 0.5, bodyY + 1, s * (W / 2 - 7));
        }
        // decal livery on top of the body
        if (look.decal && look.decal !== 'none') {
            const top = new THREE.Mesh(geo(`decal${L}|${W}`, () => new THREE.PlaneGeometry(L * 0.98, W * 0.8).rotateX(-Math.PI / 2)),
                new THREE.MeshStandardMaterial({ map: decalTexture(look), transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
            top.position.set(0, T.ride + T.h + 0.15, 0);
            body.add(top);
            if (look.decal === 'side') {
                for (const s of [1, -1]) add(box(L * 0.8, 2.2, 0.4, new THREE.MeshStandardMaterial({ color: look.decalColor, roughness: 0.5 })), 0, bodyY, s * (W / 2 + 0.1));
            }
        }
        // bonnet
        const hoodX = L / 2 - T.cab[0] * L / 2;
        if (look.hood === 'bulge') add(box(L * 0.22, 3, W * 0.36, paint, 1.4), hoodX, T.ride + T.h + 1, 0);
        else if (look.hood === 'scoop') { add(box(L * 0.16, 4, W * 0.3, paint, 1.4), hoodX, T.ride + T.h + 1.6, 0); add(box(1, 2.5, W * 0.24, darkTrim()), hoodX + L * 0.08, T.ride + T.h + 2.2, 0); }
        else if (look.hood === 'vents') for (const s of [1, -1]) add(box(L * 0.12, 0.8, W * 0.12, darkTrim()), hoodX, T.ride + T.h + 0.3, s * W * 0.16);
        else if (look.hood === 'carbon') add(box(L * T.cab[0] * 0.9, 0.8, W * 0.8, mat('carbon', () => new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.35, metalness: 0.4 }))), hoodX, T.ride + T.h + 0.3, 0);
        // spoiler
        const sx = -L / 2 + 6;
        if (look.spoiler === 'lip') add(box(4, 2, W * 0.88, paint, 0.8), sx - 2, T.ride + T.h + 1, 0);
        else if (look.spoiler === 'wing' || look.spoiler === 'gt') {
            const hgt = look.spoiler === 'gt' ? 10 : 6, wingW = W * (look.spoiler === 'gt' ? 1.02 : 0.9);
            for (const s of [1, -1]) add(box(3, hgt, 1.5, darkTrim()), sx, T.ride + T.h + hgt / 2, s * W * 0.3);
            add(box(9, 1.6, wingW, look.spoiler === 'gt' ? darkTrim() : paint, 0.6), sx - 1, T.ride + T.h + hgt + 0.6, 0);
            if (look.spoiler === 'gt') for (const s of [1, -1]) add(box(10, 6, 1, darkTrim()), sx - 1, T.ride + T.h + hgt, s * wingW / 2);
        }
        // role-specific parts
        if (T.bed) {      // pickup bed + bull bar (Tank)
            const bx = -L * 0.24;
            add(box(L * 0.46, 2, W * 0.86, darkTrim()), bx, T.ride + T.h + 0.5, 0);
            for (const s of [1, -1]) add(box(L * 0.46, 5, 2, paint, 0.8), bx, T.ride + T.h + 3, s * W * 0.43);
            add(box(2, 5, W * 0.86, paint, 0.8), -L / 2 + 2, T.ride + T.h + 3, 0);
            add(box(3, 12, W * 0.9, darkTrim(), 1), L / 2 + 3, T.ride + 7, 0);
            for (const s of [1, -1]) add(box(6, 3, 3, darkTrim()), L / 2 + 1, T.ride + 12, s * W * 0.3);
        }
        if (T.roofRack) {
            for (const s of [1, -1]) add(box(cabLen * 0.8, 1.2, 1.2, darkTrim()), cabX - 2, roofY + 1.5, s * W * 0.32);
            for (const k of [-1, 0, 1]) add(box(1.2, 1.2, W * 0.66, darkTrim()), cabX - 2 + k * cabLen * 0.3, roofY + 1.5, 0);
            for (const s of [1, -1]) add(box(L * 0.36, 2, 3, darkTrim()), L * 0.36, T.ride + T.h + 0.8, s * W * 0.2);   // light bar
        }
        if (T.flaps) for (const s of [1, -1]) add(box(1, 7, 8, darkTrim()), -L * 0.42, T.ride + 1, s * W * 0.42);
        if (T.roofRails) for (const s of [1, -1]) add(box(cabLen * 0.9, 1.5, 1.5, mat('rail', () => new THREE.MeshStandardMaterial({ color: 0xb8bec8, roughness: 0.3, metalness: 0.8 }))), cabX - 1, roofY + 1.2, s * W * 0.4);
        if (T.spare) {
            const sp = add(new THREE.Mesh(geo('spare', () => new THREE.TorusGeometry(6, 3, 8, 16).rotateY(Math.PI / 2)), rubber()), -L / 2 - 3, T.ride + T.h * 0.7, 0);
            void sp;
        }
        if (T.flares) for (const sx2 of [1, -1]) for (const s of [1, -1]) add(box(L * 0.24, 5, 4, paint, 1.5), sx2 * L * 0.31, T.ride + T.h * 0.65, s * (W / 2 + 1.5));
        if (T.vents) for (const k of [0, 1, 2]) add(box(2, 0.8, W * 0.5, darkTrim()), -L * 0.3 - k * 4, T.ride + T.h + 0.3, 0);
        if (T.intakes) for (const s of [1, -1]) add(box(10, 4, 1, darkTrim()), -L * 0.08, T.ride + T.h * 0.55, s * (W / 2 + 0.2));
    }

    // wheels (front ones steer)
    const wr = T.wheelR, ww = T.kart ? 9 : 7.5;
    const wheels = [], front = [];
    const wx = T.kart ? 28 : L * 0.31, wz = T.kart ? 22 : W / 2 - ww * 0.25;
    for (const sx2 of [1, -1]) for (const s of [1, -1]) {
        const r = T.kart && sx2 < 0 ? wr * 1.12 : wr;
        const w = wheel(r, ww, look.rim);
        w.position.set(sx2 * wx, r, s * wz);
        root.add(w);
        wheels.push(w);
        if (sx2 > 0) front.push(w);
    }

    // neon underglow
    let glow = null;
    const ug = underglowColor(cosmetics && cosmetics.underglow);
    if (ug) {
        glow = new THREE.Mesh(geo('glowPlane', () => new THREE.PlaneGeometry(L * 1.35, CAR_WID * 1.9).rotateX(-Math.PI / 2)),
            new THREE.MeshBasicMaterial({ map: glowTexture(), color: ug, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.position.y = 0.6;
        root.add(glow);
    }

    // hat
    let topper = null;
    const tk = cosmetics && cosmetics.topper;
    if (tk && tk !== 'none') {
        topper = makeTopper(tk, look.paint);
        topper.position.set(T.kart ? -4 : 0, roofY, 0);
        body.add(topper);
    }

    return { group: root, body, wheels, front, paint, baseColor, tail, glow, topper, wheelR: wr, roofY, kart: !!T.kart };
}

// Free the per-car materials (shared geometry / materials stay cached)
export function disposeCar(car) {
    car.group.traverse(o => {
        if (!o.isMesh) return;
        const m = o.material;
        if (m && !Object.values(MAT).includes(m)) m.dispose();
    });
}
