import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { resolveLook } from '../carRender';
import { underglowColor } from '../cosmetics';

// ─── Procedural 3D cars ────────────────────────────────────────────────────
// Local units: the car points along +x, is 88 long and 46 wide (the physics
// box at size 1), y is up. Each body is lofted from cross-sections along its
// length — a rounded plan shape, a side profile, wheel arches cut into the
// sides, a hood that dips between the fenders — with a separate greenhouse
// (windscreen, side glass, pillars, roof). The heavy geometry is built once
// per model and shared; every car only gets its own paint.

export const CAR_LEN = 88, CAR_WID = 46;

// t runs along the car from the tail (0) to the nose (1).
// top: side-profile control points [t, y] for the shoulder line
// dip: how far the hood / deck sits below the shoulders
// nF / nR: plan-view roundness of the nose / tail (higher = squarer)
// cab: windscreen base (a), roof start (w), roof end (r), rear-glass base (c), roof height,
//      inset from the body sides, tumblehome (top width / bottom width)
const SHAPES = {
    sports: {
        wheelR: 7.8, ww: 7.4, ride: 3, wx: 0.315, nF: 3, nR: 3.4, rc: 5, bulge: 0.8, flare: 1.4,
        top: [[0, 15], [0.05, 17.6], [0.19, 19.6], [0.34, 18.8], [0.55, 18.3], [0.7, 18.3], [0.81, 18.8], [0.93, 16], [1, 12.4]],
        dip: [[0, 0.6], [0.3, 1.2], [0.55, 0.4], [0.75, 1.6], [1, 1]],
        cab: { a: 0.66, w: 0.53, r: 0.4, c: 0.14, roof: 27.2, inset: 3.8, tumble: 0.74, rc: 3.2, bPillar: 0.48 },
        head: 'slit', tailL: 'bar', grille: 'low', exhaust: 2,
    },
    muscle: {
        wheelR: 8.6, ww: 8.2, ride: 3.6, wx: 0.3, nF: 7, nR: 6, rc: 3.6, bulge: 0.5, flare: 0.9, wide: 1.04,
        top: [[0, 18.4], [0.05, 19.8], [0.2, 20.6], [0.4, 20.4], [0.6, 20.2], [0.8, 20.6], [0.95, 20.2], [1, 17.6]],
        dip: [[0, 0.4], [0.3, 0.6], [0.6, 0.4], [0.8, 1.2], [1, 0.8]],
        cab: { a: 0.6, w: 0.5, r: 0.3, c: 0.2, roof: 29.6, inset: 3, tumble: 0.82, rc: 2.6, bPillar: 0.4 },
        head: 'round2', tailL: 'pair', grille: 'big', exhaust: 2,
    },
    truck: {
        wheelR: 10.6, ww: 9.4, ride: 6.5, wx: 0.31, nF: 9, nR: 12, rc: 2.8, bulge: 0.4, flare: 1.6, wide: 1.04,
        top: [[0, 27], [0.04, 27.6], [0.46, 27.6], [0.52, 28], [0.75, 28], [0.92, 27.6], [1, 25]],
        dip: [[0, 0], [0.5, 0], [0.75, 0.6], [1, 0.4]],
        cab: { a: 0.76, w: 0.68, r: 0.53, c: 0.5, roof: 42, inset: 2, tumble: 0.88, rc: 2.4, bPillar: 0.6 },
        head: 'square', tailL: 'tall', grille: 'truck', exhaust: 1, bed: [0.04, 0.47],
    },
    rally: {
        wheelR: 8.4, ww: 7.8, ride: 5, wx: 0.31, nF: 3.6, nR: 6, rc: 4, bulge: 0.7, flare: 1.4,
        top: [[0, 21.5], [0.05, 22.2], [0.2, 22.6], [0.5, 22], [0.7, 21.6], [0.82, 21.4], [0.94, 19], [1, 15.6]],
        dip: [[0, 0.4], [0.5, 0.4], [0.75, 1.2], [1, 0.8]],
        cab: { a: 0.7, w: 0.59, r: 0.16, c: 0.04, roof: 35, inset: 2.8, tumble: 0.8, rc: 3, bPillar: 0.42 },
        head: 'round4', tailL: 'pair', grille: 'mesh', exhaust: 1,
    },
    suv: {
        wheelR: 10.2, ww: 9, ride: 6.5, wx: 0.31, nF: 7, nR: 10, rc: 3.4, bulge: 0.5, flare: 1.2,
        top: [[0, 27.4], [0.04, 28], [0.3, 28.2], [0.6, 28], [0.8, 27.8], [0.94, 26.6], [1, 23.6]],
        dip: [[0, 0.3], [0.6, 0.3], [0.8, 0.8], [1, 0.6]],
        cab: { a: 0.72, w: 0.63, r: 0.07, c: 0.02, roof: 42, inset: 2.4, tumble: 0.86, rc: 3, bPillar: 0.42 },
        head: 'square', tailL: 'tall', grille: 'big', exhaust: 1,
    },
    drift: {
        wheelR: 8, ww: 8, ride: 2.6, wx: 0.31, nF: 3.2, nR: 4.4, rc: 4.2, bulge: 0.7, flare: 2.4,
        top: [[0, 16.8], [0.04, 18.6], [0.19, 19.4], [0.4, 18.6], [0.65, 18.2], [0.81, 18.8], [0.94, 16], [1, 12]],
        dip: [[0, 0.4], [0.3, 0.8], [0.6, 0.4], [0.8, 1.4], [1, 1]],
        cab: { a: 0.64, w: 0.53, r: 0.36, c: 0.22, roof: 28, inset: 3.2, tumble: 0.78, rc: 3, bPillar: 0.45 },
        head: 'slit', tailL: 'round', grille: 'low', exhaust: 1,
    },
    supercar: {
        wheelR: 8.2, ww: 8.6, ride: 2.4, wx: 0.32, nF: 2.2, nR: 5, rc: 5.2, bulge: 1, flare: 2.2, wide: 1.02,
        top: [[0, 16.6], [0.06, 18], [0.18, 19.6], [0.32, 17.6], [0.5, 16.6], [0.68, 17], [0.82, 17.8], [0.93, 13.2], [1, 8]],
        dip: [[0, 0.4], [0.2, 1.4], [0.45, 0.6], [0.8, 2], [1, 1.2]],
        cab: { a: 0.73, w: 0.6, r: 0.45, c: 0.26, roof: 24.4, inset: 5.4, tumble: 0.7, rc: 3.4, bPillar: 0.53 },
        head: 'slit', tailL: 'bar', grille: 'intake', exhaust: 4, engineVents: true,
    },
};

// ── shared, never disposed (reused by every car) ──
const GEO = {};
const geo = (key, make) => (GEO[key] || (GEO[key] = make()));
const MAT = {};
const mat = (key, make) => (MAT[key] || (MAT[key] = make()));
const darkTrim = () => mat('trim', () => new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.75, metalness: 0.15 }));
const blackGloss = () => mat('black', () => new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.25, metalness: 0.3 }));
const chrome = () => mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.12, metalness: 1 }));
const headMat = () => mat('head', () => new THREE.MeshStandardMaterial({ color: 0xf4f8ff, emissive: 0xfff4d6, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.2 }));
const detailMat = () => mat('detail', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }));
const glassMat = (tint, envMap) => mat(`glass${tint}`, () => new THREE.MeshStandardMaterial({
    color: tint === 'dark' ? 0x06080b : tint === 'mirror' ? 0x9db3c9 : 0x142029,
    roughness: 0.1, metalness: tint === 'mirror' ? 0.95 : 0.25, envMap, envMapIntensity: tint === 'mirror' ? 1.4 : 0.75,
}));

function finishParams(finish) {
    switch (finish) {
        case 'metallic': return { roughness: 0.34, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.06 };
        case 'matte': return { roughness: 0.8, metalness: 0.05, clearcoat: 0, clearcoatRoughness: 1 };
        case 'chrome': return { roughness: 0.06, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.02 };
        default: return { roughness: 0.42, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 };    // gloss
    }
}

function box(w, h, d, m, r = 0) {
    const g = r > 0 ? geo(`rb${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, 2, r)) : geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
    return new THREE.Mesh(g, m);
}

// ─── shape helpers ────────────────────────────────────────────────────────
// Smooth curve through [t, y] points (cubic Hermite, finite-difference tangents)
function curve(pts, t) {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 0; i < pts.length - 1; i++) {
        const [t0, y0] = pts[i], [t1, y1] = pts[i + 1];
        if (t > t1) continue;
        const h = t1 - t0, k = (t - t0) / h;
        const m = (j) => {
            const a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)];
            return (b[1] - a[1]) / (b[0] - a[0]);
        };
        const m0 = m(i) * h, m1 = m(i + 1) * h, k2 = k * k, k3 = k2 * k;
        return (2 * k3 - 3 * k2 + 1) * y0 + (k3 - 2 * k2 + k) * m0 + (-2 * k3 + 3 * k2) * y1 + (k3 - k2) * m1;
    }
    return pts[pts.length - 1][1];
}

// Everything about one model's surface, in one place
function shapeOf(type) {
    const S = SHAPES[type] || SHAPES.sports;
    const L = CAR_LEN, Wh = (CAR_WID * (S.wide || 1)) / 2 - 1.2;
    const archR = S.wheelR + 1.5;
    const wheelsX = [S.wx * L, -S.wx * L];
    const halfW = (t) => {                              // plan view (superellipse ends)
        const u = Math.abs(2 * t - 1), n = t > 0.5 ? S.nF : S.nR;
        return Wh * Math.pow(Math.max(0, 1 - Math.pow(u, n)), 1 / n);
    };
    const flareAt = (x) => {
        let f = 0;
        for (const xw of wheelsX) f = Math.max(f, 1 - Math.abs(x - xw) / (archR + 7));
        return S.flare * f * f * (3 - 2 * f);
    };
    const topAt = (t) => curve(S.top, t);
    const dipAt = (t) => curve(S.dip, t);
    // x of the body surface at a given half-width z (front or back)
    const xAtZ = (z, front) => {
        const n = front ? S.nF : S.nR, u = Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(z) / Wh), n)), 1 / n);
        return (front ? 1 : -1) * u * L / 2;
    };
    return { S, L, Wh, archR, wheelsX, halfW, flareAt, topAt, dipAt, xAtZ, tOf: (x) => x / L + 0.5 };
}

// ─── loft: rings of points along x → indexed mesh ─────────────────────────
// rings[i] = { x, pts: [[z, y], ...] } (one closed loop each, same count)
// faceGroup(i, k) → which output geometry the quad between ring i/i+1, point k/k+1 goes to
function loft(rings, faceGroup, groups, uvOf) {
    const R = rings[0].pts.length;
    const pos = [], uv = [];
    for (const r of rings) for (const [z, y] of r.pts) { pos.push(r.x, y, z); uv.push(...uvOf(r.x, y, z)); }
    const all = [], idx = groups.map(() => []);
    for (let i = 0; i < rings.length - 1; i++) {
        for (let k = 0; k < R; k++) {
            const a = i * R + k, b = i * R + (k + 1) % R, c = (i + 1) * R + k, d = (i + 1) * R + (k + 1) % R;
            const tri = [a, c, b, b, c, d];
            all.push(...tri);
            const g = faceGroup(i, k);
            if (g >= 0) idx[g].push(...tri);
        }
    }
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    base.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    base.setIndex(all);
    base.computeVertexNormals();       // smooth across material seams
    return idx.map(ix => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', base.getAttribute('position'));
        g.setAttribute('normal', base.getAttribute('normal'));
        g.setAttribute('uv', base.getAttribute('uv'));
        g.setIndex(ix);
        return g;
    });
}

// Mirror a half cross-section (bottom centre → top centre, z ≥ 0) into a closed loop
function ring(half) {
    const out = half.map(([z, y]) => [z, y]);
    for (let k = half.length - 2; k >= 1; k--) out.push([-half[k][0], half[k][1]]);
    return out;
}
// which half-section point a ring point came from
const halfIndex = (k, H) => (k < H ? k : 2 * H - 2 - k);

// The lower body: [paint, trim (sills, wheel wells, underside), decal skin]
function buildShell(sh) {
    const { S, L, archR, wheelsX, halfW, flareAt, topAt, dipAt } = sh;
    const N = 46, rings = [];
    let H = 0;
    for (let i = 0; i < N; i++) {
        const t = 0.5 - 0.5 * Math.cos(Math.PI * i / (N - 1));          // more rings near the ends
        const x = (t - 0.5) * L;
        const u = Math.abs(2 * t - 1);
        const hw = halfW(t) + flareAt(x) * Math.min(1, halfW(t) / 6);
        const top = topAt(t), dip = dipAt(t);
        const yb = S.ride + (u > 0.82 ? Math.pow((u - 0.82) / 0.18, 2) * 3.5 : 0);   // bumpers tuck up
        // wheel arch: the outer part of the side is cut away round the tyre
        let ya = yb;
        for (const xw of wheelsX) {
            const dx = Math.abs(x - xw);
            if (dx < archR) ya = Math.max(ya, S.wheelR + Math.sqrt(archR * archR - dx * dx));
        }
        const zi = Math.max(0, hw - S.ww - 2.4);
        const room = Math.max(0.4, top - ya);
        const rc = Math.max(0.5, Math.min(S.rc, room * 0.42, hw * 0.45));
        const y4 = ya + Math.min(1.2, room * 0.18), y5 = ya + Math.min(3.4, room * 0.36);
        const y7 = top - rc;
        const a1 = Math.PI / 6, a2 = Math.PI / 3;
        const half = [
            [0, yb], [zi, yb], [zi, ya], [Math.max(zi, hw - 1.6), ya], [hw - 0.25, y4], [hw, y5],
            [hw + S.bulge * Math.min(1, hw / 8), (y5 + y7) / 2], [hw, y7],
            [hw - rc + rc * Math.cos(a1), top - rc + rc * Math.sin(a1)],
            [hw - rc + rc * Math.cos(a2), top - rc + rc * Math.sin(a2)],
            [hw - rc, top], [(hw - rc) * 0.55, top - dip * 0.8], [0, top - dip],
        ];
        H = half.length;
        rings.push({ x, pts: ring(half) });
    }
    // segment k (half index of its lower point): 0-4 → trim (underside, wells, sill)
    const geos = loft(rings, (i, k) => {
        const hk = Math.min(halfIndex(k, H), halfIndex((k + 1) % (2 * H - 2), H));
        return hk <= 4 ? 1 : 0;
    }, [0, 1], (x, y, z) => [x / L + 0.5, 0.5 - z / (CAR_WID * 0.8)]);
    // decal skin: the upper surface only, lifted a hair
    const skinRings = rings.map(r => ({ x: r.x, pts: r.pts }));
    const skin = loft(skinRings, (i, k) => {
        const hk = Math.min(halfIndex(k, H), halfIndex((k + 1) % (2 * H - 2), H));
        return hk >= 7 ? 0 : -1;
    }, [0], (x, y, z) => [x / L + 0.5, 0.5 - z / (CAR_WID * 0.8)])[0];
    const p = skin.getAttribute('position').clone(), n = skin.getAttribute('normal');
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * 0.12, p.getY(i) + n.getY(i) * 0.12, p.getZ(i) + n.getZ(i) * 0.12);
    skin.setAttribute('position', p);
    return { paint: geos[0], trim: geos[1], skin };
}

// The greenhouse: [paint (pillars, roof), glass]
function buildCabin(sh) {
    const { S, L, halfW, topAt, dipAt } = sh;
    const C = S.cab, N = 34, rings = [];
    const tB0 = C.bPillar - 0.018, tB1 = C.bPillar + 0.018;
    const roofAt = (t) => {
        if (t >= C.w) { const k = (C.a - t) / (C.a - C.w); return Math.sin(Math.max(0, Math.min(1, k)) * Math.PI / 2) ** 0.85; }
        if (t <= C.r) { const k = (t - C.c) / (C.r - C.c); return Math.sin(Math.max(0, Math.min(1, k)) * Math.PI / 2) ** 0.9; }
        return 1;
    };
    const ts = [];
    for (let i = 0; i < N; i++) ts.push(C.c + (C.a - C.c) * i / (N - 1));
    let H = 0;
    for (const t of ts) {
        const x = (t - 0.5) * L;
        const belt = topAt(t) - dipAt(t) * 0.3 - 0.4;
        const hwB = Math.max(0.5, halfW(t) - C.inset);
        const k = roofAt(t);
        const ytop = belt + (C.roof - belt) * k + (t > C.r && t < C.w ? 0.5 * Math.sin(Math.PI * (t - C.r) / (C.w - C.r)) : 0);
        const hwT = hwB * (1 - (1 - C.tumble) * Math.min(1, k * 1.5));
        const rc = Math.max(0.3, Math.min(C.rc, (ytop - belt) * 0.35, hwT * 0.4));
        const half = [
            [0, belt - 1.2], [hwB, belt - 1.2], [hwB, belt],
            [(hwB + hwT) / 2 + 0.4 * k, belt + (ytop - belt - rc) * 0.5], [hwT, ytop - rc],
            [hwT - rc + rc * Math.SQRT1_2, ytop - rc + rc * Math.SQRT1_2], [hwT - rc, ytop], [0, ytop + 0.5 * k],
        ];
        H = half.length;
        rings.push({ x, t, pts: ring(half) });
    }
    const geos = loft(rings, (i, k) => {
        const tm = (rings[i].t + rings[i + 1].t) / 2;
        const hk = Math.min(halfIndex(k, H), halfIndex((k + 1) % (2 * H - 2), H));
        if (hk <= 1) return 0;                                   // base (hidden)
        if (hk === 2 || hk === 3) return (tm > tB0 && tm < tB1) ? 0 : 1;   // side glass (B pillar painted)
        if (hk === 4 || hk === 5) return 0;                      // A/C pillars + roof rails
        return (tm >= C.r && tm <= C.w) ? 0 : 1;                 // roof / windscreen / rear glass
    }, [0, 1], (x) => [x / L + 0.5, 0.5]);
    return { paint: geos[0], glass: geos[1] };
}

// ─── static detail parts, merged per material ─────────────────────────────
function detailParts(type, sh) {
    const { S, L, Wh, halfW, topAt, dipAt, xAtZ, tOf } = sh;
    const parts = { trim: [], chrome: [], head: [], tail: [], plate: [], paint: [], black: [] };
    const put = (bucket, g, x, y, z, ry = 0, rz = 0, rx = 0) => {
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
        const c = g.clone(); c.applyMatrix4(m);
        if (!c.index) c.setIndex([...Array(c.getAttribute('position').count).keys()]);
        parts[bucket].push(c);
    };
    const rb = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
    const yb = S.ride;
    const frontX = (z) => xAtZ(z, true), rearX = (z) => xAtZ(z, false);
    const slope = (z, front) => {   // plan-view angle of the surface at z
        const dz = 0.5, a = xAtZ(z, front), b = xAtZ(z + dz, front);
        return Math.atan2(b - a, dz) * (front ? 1 : -1);
    };
    const surfY = (x) => topAt(tOf(x));

    // headlights
    const hz = Wh * 0.66, hx = frontX(hz), hY = surfY(hx) - 2.6;
    const ang = (z) => -slope(z, true);
    if (S.head === 'slit') {
        for (const s of [1, -1]) put('head', rb(2.6, 1.7, 9, 0.7), frontX(hz) - 1.3, hY + 0.4, s * hz, s * ang(hz));
        for (const s of [1, -1]) put('black', rb(2.4, 3.4, 10, 1), frontX(hz) - 1.7, hY, s * hz, s * ang(hz));
    } else if (S.head === 'round2' || S.head === 'round4') {
        const cyl = new THREE.CylinderGeometry(2.4, 2.4, 1.4, 16).rotateZ(Math.PI / 2);
        const zs = S.head === 'round4' ? [Wh * 0.55, Wh * 0.8] : [Wh * 0.7];
        for (const s of [1, -1]) for (const z of zs) {
            put('head', cyl, frontX(z) - 0.2, hY - 0.4, s * z);
            put('chrome', new THREE.TorusGeometry(2.5, 0.45, 6, 16).rotateY(Math.PI / 2), frontX(z) - 0.1, hY - 0.4, s * z);
        }
    } else {      // square
        for (const s of [1, -1]) {
            put('head', rb(1.6, 4.4, 7.5, 0.6), frontX(Wh * 0.72) - 0.3, hY - 0.8, s * Wh * 0.72);
            put('chrome', rb(1.2, 5.6, 9, 0.8), frontX(Wh * 0.72) - 0.7, hY - 0.8, s * Wh * 0.72);
        }
    }
    // grille / intakes
    const gx = frontX(0), gY = yb + (surfY(gx) - yb) * 0.42;
    if (S.grille === 'big' || S.grille === 'truck') {
        const gw = Wh * (S.grille === 'truck' ? 1.15 : 0.95), gh = S.grille === 'truck' ? 9 : 5.2;
        put('black', rb(2, gh, gw, 0.6), gx - 0.9, gY + (S.grille === 'truck' ? 1.5 : 1), 0);
        put('chrome', rb(1.6, gh + 1.4, gw + 1.4, 0.7), gx - 1.3, gY + (S.grille === 'truck' ? 1.5 : 1), 0);
        for (let k = -1; k <= 1; k++) put('chrome', rb(0.6, 0.6, gw, 0.2), gx - 0.1, gY + 1 + k * gh * 0.28 + (S.grille === 'truck' ? 0.5 : 0), 0);
    } else if (S.grille === 'mesh') {
        put('black', rb(2, 4.4, Wh * 0.8, 1), gx - 1, gY + 1, 0);
    } else {      // low / intake: lower air dam
        put('black', rb(2.2, 2.8, Wh * (S.grille === 'intake' ? 1.4 : 1.0), 1.2), frontX(Wh * 0.2) - 0.8, yb + 2.6, 0);
        if (S.grille === 'intake') for (const s of [1, -1]) put('black', rb(2.2, 3.6, Wh * 0.36, 1.2), frontX(Wh * 0.72) - 0.9, yb + 3.4, s * Wh * 0.7, s * ang(Wh * 0.7));
    }
    // tail lights
    const tz = Wh * 0.72, tY = surfY(rearX(tz)) - 2.6;
    if (S.tailL === 'bar') {
        put('tail', rb(1.6, 1.6, Wh * 1.7, 0.6), rearX(Wh * 0.3) + 0.5, tY + 0.6, 0);
        for (const s of [1, -1]) put('tail', rb(2.2, 2.4, 6, 0.8), rearX(tz) + 0.7, tY + 0.4, s * tz, -s * slope(tz, false) * 0.7);
    } else if (S.tailL === 'round') {
        const cyl = new THREE.CylinderGeometry(2, 2, 1.4, 14).rotateZ(Math.PI / 2);
        for (const s of [1, -1]) for (const z of [Wh * 0.55, Wh * 0.8]) put('tail', cyl, rearX(z) + 0.2, tY, s * z);
    } else if (S.tailL === 'tall') {
        for (const s of [1, -1]) put('tail', rb(1.6, 7.5, 3.2, 0.6), rearX(Wh * 0.86) + 0.4, tY - 2.2, s * Wh * 0.86);
    } else {
        for (const s of [1, -1]) put('tail', rb(1.8, 2.8, 8.5, 0.8), rearX(tz) + 0.6, tY, s * tz, -s * slope(tz, false) * 0.7);
    }
    // number plates
    put('plate', rb(0.5, 3.2, 9.5, 0.3), frontX(0) + 0.05, yb + 4.2, 0);
    put('plate', rb(0.5, 3.2, 9.5, 0.3), rearX(0) - 0.05, yb + 5.6, 0);
    // exhaust tips
    const ex = S.exhaust;
    const pipe = new THREE.CylinderGeometry(1.25, 1.25, 4, 12).rotateZ(Math.PI / 2);
    const exZ = ex === 4 ? [Wh * 0.2, Wh * 0.38] : ex === 2 ? [Wh * 0.42] : [Wh * 0.5];
    for (const s of ex === 1 ? [-1] : [1, -1]) for (const z of exZ) put('chrome', pipe, rearX(z) + 0.6, yb + 2.2, s * z);
    // door shut lines + handles on both sides
    if (S.cab) {
        const C = S.cab, sideZ = (x) => {
            const t = tOf(x), hw = halfW(t);
            return hw + sh.flareAt(x) * Math.min(1, hw / 6) + S.bulge * Math.min(1, hw / 8);
        };
        const fourDoor = ['truck', 'rally', 'suv'].includes(type);
        const xs = [(C.a - 0.035 - 0.5) * L, (C.bPillar - 0.5) * L];
        if (fourDoor) xs.push((C.bPillar - (C.a - C.bPillar) * 0.85 - 0.5) * L);
        for (let i = 0; i < xs.length; i++) {
            const x = xs[i], belt = topAt(tOf(x)) - dipAt(tOf(x)) * 0.3, y0 = S.ride + 4.2, h = belt - 1.2 - y0;
            for (const s of [1, -1]) put('trim', rb(0.22, h, 0.6, 0.08), x, y0 + h / 2, s * (sideZ(x) - 0.32));
            if (i < xs.length - 1) {     // handle near the back edge of each door
                const hx = xs[i + 1] + 3.2;
                for (const s of [1, -1]) put('chrome', rb(2.6, 0.7, 0.7, 0.25), hx, belt - 2.6, s * (sideZ(hx) - 0.05));
            }
        }
    }
    // door mirrors at the base of the A pillar
    if (S.cab) {
        const tA = S.cab.a - 0.04, mx = (tA - 0.5) * L, mz = halfW(tA) - S.cab.inset + 2.2, my = topAt(tA) - dipAt(tA) * 0.3 + 2.2;
        for (const s of [1, -1]) {
            put('paint', rb(3.4, 2.6, 4.2, 1.1), mx, my, s * mz);
            put('black', rb(2, 1, 2.4, 0.4), mx + 0.6, my - 1.4, s * (mz - 1.6));
        }
    }
    // engine cover louvres (mid-engine)
    if (S.engineVents) for (let k = 0; k < 4; k++) {
        const x = -L * 0.2 - k * 3.4;
        put('black', rb(1.6, 0.6, Wh * 0.9, 0.25), x, surfY(x) - dipAt(tOf(x)) + 0.1, 0);
    }
    // pickup bed
    if (S.bed) {
        const x0 = (S.bed[0] - 0.5) * L, x1 = (S.bed[1] - 0.5) * L, mid = (x0 + x1) / 2, len = x1 - x0;
        put('black', rb(len, 2, Wh * 1.66, 0.6), mid, surfY(mid) - 0.6, 0);
        put('trim', rb(1.2, 0.8, Wh * 1.7, 0.3), x0 + 0.4, surfY(x0) + 0.2, 0);
    }
    // role-specific hardware (doesn't change with cosmetics, so it's merged in too)
    const roofY = S.cab.roof + 0.6, wx = S.wx * L, wz = Wh + S.flare - S.ww / 2 - 0.2;
    const cA = (S.cab.a - 0.5) * L, cC = (S.cab.c - 0.5) * L, cabX = (cA + cC) / 2, cabLen = cA - cC;
    if (type === 'truck') {          // bull bar + roof light bar
        const fx = frontX(0);
        for (const s of [1, -1]) put('black', rb(2, 13, 2, 0.6), fx + 1.6, S.ride + 8.5, s * Wh * 0.6);
        put('black', rb(2, 2, Wh * 1.5, 0.6), fx + 1.6, S.ride + 14.5, 0);
        put('black', rb(2, 2, Wh * 1.5, 0.6), fx + 1.6, S.ride + 6, 0);
        put('black', rb(3, 2, Wh * 1.3, 0.6), (S.cab.w - 0.5) * L - 4, roofY + 1, 0);
        for (let k = -2; k <= 2; k++) put('head', new THREE.BoxGeometry(0.8, 1.4, 2.6), (S.cab.w - 0.5) * L - 2.4, roofY + 1, k * Wh * 0.26);
    }
    if (type === 'rally') {          // roof rack, spot lamps, mud flaps
        for (const s of [1, -1]) put('black', new THREE.BoxGeometry(cabLen * 0.6, 1, 1), cabX - 4, roofY + 1.4, s * Wh * 0.6);
        for (const k of [-1, 0, 1]) put('black', new THREE.BoxGeometry(1, 1, Wh * 1.3), cabX - 4 + k * cabLen * 0.2, roofY + 1.4, 0);
        const fx = frontX(Wh * 0.3), spot = new THREE.CylinderGeometry(2.2, 2.2, 1.6, 14).rotateZ(Math.PI / 2);
        for (const s of [1, -1]) {
            put('head', spot, fx + 1.4, S.ride + 8, s * Wh * 0.3);
            put('black', new THREE.BoxGeometry(1, 6.5, 7), -wx - S.wheelR - 2, S.ride + 2.4, s * wz);
        }
    }
    if (type === 'suv') {            // roof rails + spare wheel on the tailgate
        for (const s of [1, -1]) put('chrome', rb(cabLen * 0.82, 1.4, 1.4, 0.5), cabX - 2, roofY + 1, s * Wh * 0.62);
        put('black', new THREE.TorusGeometry(6, 2.8, 10, 20).rotateY(Math.PI / 2), rearX(0) - 2.6, S.ride + 14, 0);
        put('chrome', new THREE.CylinderGeometry(3.4, 3.4, 1.4, 14).rotateZ(Math.PI / 2), rearX(0) - 2.6, S.ride + 14, 0);
    }
    return parts;
}

// Keep only what every merged piece shares; tint a piece with a flat vertex colour
function tidy(g, color) {
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    if (color !== undefined) {
        const c = new THREE.Color(color), n = g.getAttribute('position').count, arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    return g;
}
const merge = (list) => (list.length ? mergeGeometries(list) : null);

// Per-model geometry, built once: a handful of merged pieces, one draw call each
//   paint  — body, roof, pillars, mirrors      detail — sills, wells, grille, plates (vertex coloured)
//   glass, chrome, head(lights), tail(lights)
function modelGeometry(type) {
    return geo(`model:${type}`, () => {
        const sh = shapeOf(type);
        const shell = buildShell(sh), cabin = buildCabin(sh), P = detailParts(type, sh);
        return {
            sh, skin: shell.skin,
            paint: merge([shell.paint, cabin.paint, ...P.paint].map(g => tidy(g))),
            detail: merge([tidy(shell.trim, 0x1c1e22), ...P.trim.map(g => tidy(g, 0x1c1e22)), ...P.black.map(g => tidy(g, 0x0b0c0e)), ...P.plate.map(g => tidy(g, 0xf2f2ea))]),
            glass: tidy(cabin.glass),
            chrome: merge(P.chrome.map(g => tidy(g))),
            head: merge(P.head.map(g => tidy(g))),
            tail: merge(P.tail.map(g => tidy(g))),
        };
    });
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
        for (let x = W * 0.72; x < W * 0.94; x += s) for (let y = 0; y < H; y += s) {
            if (((x / s) + (y / s)) % 2 < 1) g.fillRect(x, y, s, s);
        }
    } else if (look.decal === 'number') {
        g.beginPath(); g.arc(W * 0.82, H / 2, H * 0.27, 0, Math.PI * 2); g.fillStyle = '#f4f4f4'; g.fill();
        g.fillStyle = '#111'; g.font = `bold ${H * 0.36}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.save(); g.translate(W * 0.82, H / 2); g.rotate(Math.PI / 2); g.fillText(String(look.number || 7), 0, 2); g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    decalCache.set(key, t);
    return t;
}

// ─── wheels: rounded tyre, spoked rim, brake disc + caliper ───────────────
function wheelGeometry(r, w) {
    return geo(`wheel${r}|${w}`, () => {
        const h = w / 2, rr = r * 0.66;
        const prof = [[rr, -h], [r - 1.3, -h], [r - 0.35, -h + 0.5], [r, -h + 1.5], [r, h - 1.5], [r - 0.35, h - 0.5], [r - 1.3, h], [rr, h]]
            .map(([a, b]) => new THREE.Vector2(a, b));
        const tire = new THREE.LatheGeometry(prof, 22).rotateX(Math.PI / 2);
        // rim (outer face at +z): lip, barrel, 5 spokes, centre cap
        const rimParts = [];
        const add = (g, x, y, z, rz = 0) => { g.rotateZ(rz); g.translate(x, y, z); rimParts.push(g); };
        add(new THREE.TorusGeometry(rr - 0.35, 0.55, 6, 22), 0, 0, h - 0.55);
        const barrel = new THREE.CylinderGeometry(rr - 0.3, rr - 0.3, w - 1.6, 18, 1, true).rotateX(Math.PI / 2);
        rimParts.push(barrel);
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const sp = new THREE.BoxGeometry(rr - 1.2, 1.5, 0.9);
            sp.translate((rr - 1.2) / 2 + 0.6, 0, 0);
            sp.rotateZ(a);
            sp.translate(0, 0, h - 1.1);
            rimParts.push(sp);
        }
        add(new THREE.CylinderGeometry(1.5, 1.5, 1.2, 12).rotateX(Math.PI / 2), 0, 0, h - 1);
        const rim = mergeGeometries(rimParts.map(g => tidy(g)));
        const disc = new THREE.CylinderGeometry(rr * 0.82, rr * 0.82, 0.8, 18).rotateX(Math.PI / 2).translate(0, 0, h - 2.6);
        const caliper = new THREE.BoxGeometry(rr * 0.5, rr * 0.36, 2.2).translate(-rr * 0.42, rr * 0.42, h - 2.2);
        // a plain tyre looks the same turning or not, so only the spoked rim spins
        const still = mergeGeometries([tidy(tire, 0x18191b), tidy(disc, 0x8a8e94), tidy(caliper, 0xd8241f)]);
        return { still, rim };
    });
}

function wheel(r, w, rimColor, side) {
    const G = wheelGeometry(r, w);
    const grp = new THREE.Group();
    const spin = new THREE.Group();
    const rimM = mat(`rim${rimColor}`, () => new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.25, metalness: 0.9 }));
    const still = new THREE.Mesh(G.still, mat('wheelStill', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.1 })));
    still.castShadow = true;
    spin.add(new THREE.Mesh(G.rim, rimM));
    grp.add(still, spin);
    grp.scale.z = side;            // outer face points away from the car on both sides
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

// Build a car. Returns { group, body, wheels, front, paint, baseColor, tail, glow, topper, wheelR, roofY, kart }
export function buildCar(type, cosmetics, envMap, { low = false } = {}) {
    const look = resolveLook(type, cosmetics);
    const root = new THREE.Group();
    const body = new THREE.Group();          // everything that leans / bounces
    root.add(body);
    const fp = finishParams(look.finish);
    const paint = low
        ? new THREE.MeshStandardMaterial({ color: look.paint, roughness: fp.roughness, metalness: fp.metalness, envMap, envMapIntensity: 0.9 })
        : new THREE.MeshPhysicalMaterial({ color: look.paint, ...fp, envMap, envMapIntensity: look.finish === 'chrome' ? 1.5 : 1 });
    const baseColor = new THREE.Color(look.paint);
    const glass = glassMat(look.tint, envMap);
    const tail = new THREE.MeshStandardMaterial({ color: 0x7a0a0d, emissive: 0xff1a1a, emissiveIntensity: 0.6, roughness: 0.2 });
    const add = (m, x, y, z, parent = body) => { m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const mesh = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; body.add(o); return o; };
    let roofY, wheelR, ww, wx, wz, kart = type === 'kart';

    if (kart) {
        // Open-wheel kart: flat floor, nose cone, side pods, driver in a helmet
        const ride = 3;
        add(box(70, 3.5, 30, darkTrim(), 1.5), 0, ride + 2, 0);
        add(box(30, 6, 22, paint, 3), 26, ride + 6, 0);                     // nose
        const noseTip = new THREE.Mesh(geo('kartnose', () => new THREE.ConeGeometry(9, 16, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4)), paint);
        add(noseTip, 44, ride + 6, 0);
        for (const s of [1, -1]) add(box(36, 6, 8, paint, 2.5), -4, ride + 6, s * 17);   // side pods
        add(box(16, 10, 18, darkTrim(), 3), -10, ride + 9, 0);              // seat
        add(box(10, 9, 14, paint, 3), -6, ride + 15, 0);                    // driver body
        add(new THREE.Mesh(geo('helmet', () => new THREE.SphereGeometry(6.5, 16, 12)), paint), -4, ride + 24, 0);
        add(new THREE.Mesh(geo('visor', () => new THREE.SphereGeometry(6.6, 14, 8, -Math.PI / 3, Math.PI / 1.5, Math.PI / 3, Math.PI / 4)), glass), -4, ride + 24, 0);
        add(box(8, 2, 34, darkTrim()), -36, ride + 16, 0);                  // rear wing
        for (const s of [1, -1]) add(box(6, 10, 1.5, darkTrim()), -36, ride + 11, s * 16);
        add(new THREE.Mesh(geo('kartpipe', () => new THREE.CylinderGeometry(1.4, 1.4, 10, 10).rotateZ(Math.PI / 2)), chrome()), -34, ride + 6, -8);
        roofY = ride + 30;
        wheelR = 8.5; ww = 9; wx = 28; wz = 22;
    } else {
        const M = modelGeometry(type), S = M.sh.S;
        mesh(M.paint, paint);
        mesh(M.detail, detailMat());
        mesh(M.glass, glass);
        for (const [g, m] of [[M.chrome, chrome()], [M.head, headMat()], [M.tail, tail]]) if (g) mesh(g, m);
        const { L, Wh, topAt, dipAt, tOf } = M.sh;
        const surfY = (x) => topAt(tOf(x)) - dipAt(tOf(x));
        roofY = S.cab.roof + 0.6;
        wheelR = S.wheelR; ww = S.ww; wx = S.wx * L;
        wz = Wh + S.flare - ww / 2 - 0.2;
        const W = Wh * 2;

        // decal livery wrapped over the bonnet / roof / boot
        if (look.decal && look.decal !== 'none') {
            const dm = new THREE.MeshStandardMaterial({ map: decalTexture(look), transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
            const skin = new THREE.Mesh(M.skin, dm);
            body.add(skin);
            if (look.decal === 'side') {
                const sm = new THREE.MeshStandardMaterial({ color: look.decalColor, roughness: 0.5 });
                const y = S.ride + (topAt(0.5) - S.ride) * 0.55;
                for (const s of [1, -1]) add(box(L * 0.46, 2.2, 0.5, sm), 0, y, s * (Wh + S.bulge * 0.9));
            }
        }
        // bonnet
        const hoodX = ((S.cab.a + 1) / 2 - 0.5) * L - 4, hy = surfY(hoodX);
        if (look.hood === 'bulge') add(box(L * 0.22, 3, W * 0.34, paint, 1.4), hoodX, hy + 0.6, 0);
        else if (look.hood === 'scoop') { add(box(L * 0.15, 4, W * 0.3, paint, 1.4), hoodX, hy + 1.2, 0); add(box(1, 2.6, W * 0.24, blackGloss()), hoodX + L * 0.075, hy + 1.8, 0); }
        else if (look.hood === 'vents') for (const s of [1, -1]) add(box(L * 0.1, 0.8, W * 0.12, blackGloss(), 0.3), hoodX, hy + 0.1, s * W * 0.17);
        else if (look.hood === 'carbon') add(box(L * 0.24, 0.8, W * 0.62, mat('carbon', () => new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.3, metalness: 0.5 })), 0.3), hoodX, hy + 0.1, 0);
        // spoiler
        const sx = -L / 2 + 6, sy = surfY(sx);
        if (look.spoiler === 'lip') add(box(4, 1.6, W * 0.8, paint, 0.7), sx - 2.5, sy + 0.6, 0);
        else if (look.spoiler === 'wing' || look.spoiler === 'gt') {
            const hgt = look.spoiler === 'gt' ? 9 : 5.5, wingW = W * (look.spoiler === 'gt' ? 1.04 : 0.9);
            for (const s of [1, -1]) add(box(3, hgt, 1.2, blackGloss(), 0.4), sx, sy + hgt / 2, s * W * 0.3);
            add(box(8.5, 1.4, wingW, look.spoiler === 'gt' ? blackGloss() : paint, 0.6), sx - 1, sy + hgt + 0.5, 0);
            if (look.spoiler === 'gt') for (const s of [1, -1]) add(box(10, 5.5, 0.8, blackGloss(), 0.3), sx - 1, sy + hgt, s * wingW / 2);
        }
    }

    // wheels (front ones steer)
    const wheels = [], front = [];
    for (const sx2 of [1, -1]) for (const s of [1, -1]) {
        const r = kart && sx2 < 0 ? wheelR * 1.12 : wheelR;
        const w = wheel(r, ww, look.rim, s);
        w.position.set(sx2 * wx, r, s * wz);
        root.add(w);
        wheels.push(w);
        if (sx2 > 0) front.push(w);
    }

    // neon underglow
    let glow = null;
    const ug = underglowColor(cosmetics && cosmetics.underglow);
    if (ug) {
        glow = new THREE.Mesh(geo('glowPlane', () => new THREE.PlaneGeometry(CAR_LEN * 1.35, CAR_WID * 1.9).rotateX(-Math.PI / 2)),
            new THREE.MeshBasicMaterial({ map: glowTexture(), color: ug, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.position.y = 0.6;
        root.add(glow);
    }

    // hat
    let topper = null;
    const tk = cosmetics && cosmetics.topper;
    if (tk && tk !== 'none') {
        topper = makeTopper(tk, look.paint);
        topper.position.set(kart ? -4 : -2, roofY, 0);
        body.add(topper);
    }

    return { group: root, body, wheels, front, paint, baseColor, tail, glow, topper, wheelR, roofY, kart };
}

// Free the per-car materials (shared geometry / materials stay cached)
export function disposeCar(car) {
    car.group.traverse(o => {
        if (!o.isMesh) return;
        const m = o.material;
        if (m && !Object.values(MAT).includes(m)) m.dispose();
    });
}
