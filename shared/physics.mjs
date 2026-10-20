// ─── Dash Arena car physics (shared) ───────────────────────────────────────
// The server runs this to decide what really happens; each phone runs the
// exact same code to predict its own car, so controls respond instantly and
// the server's word only has to nudge it, not drag it around.
//
// Cars are oriented boxes (matched to the sprite) with mass, rotational
// inertia and tyre grip. Movement + contacts run in sub-steps so fast cars
// can't tunnel through each other.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SUBSTEPS = 4;

export const CAR_TYPES = {
    sports:   { name: 'Venom GT',      maxSpeed: 1.3,  accel: 1.2,  turn: 1.1,  mass: 0.8,  dashForce: 1.0,  size: 0.9,  desc: 'Fast and agile' },
    muscle:   { name: 'Thunder V8',    maxSpeed: 1.15, accel: 1.0,  turn: 0.85, mass: 1.3,  dashForce: 1.3,  size: 1.1,  desc: 'Heavy hitter' },
    truck:    { name: 'War Rig',       maxSpeed: 0.75, accel: 0.7,  turn: 0.65, mass: 2.0,  dashForce: 1.6,  size: 1.4,  desc: 'Unstoppable force' },
    rally:    { name: 'Dust Devil',    maxSpeed: 1.1,  accel: 1.1,  turn: 1.3,  mass: 0.9,  dashForce: 0.9,  size: 0.95, desc: 'Best handling' },
    kart:     { name: 'Pocket Rocket', maxSpeed: 1.4,  accel: 1.4,  turn: 1.2,  mass: 0.5,  dashForce: 0.7,  size: 0.7,  desc: 'Tiny but fast' },
    suv:      { name: 'Iron Shield',   maxSpeed: 0.9,  accel: 0.85, turn: 0.9,  mass: 1.5,  dashForce: 1.2,  size: 1.2,  desc: 'Tank with style' },
    drift:    { name: 'Sidewinder',    maxSpeed: 1.05, accel: 1.0,  turn: 1.5,  mass: 0.85, dashForce: 0.85, size: 0.95, desc: 'Drift king' },
    supercar: { name: 'Phantom X',     maxSpeed: 1.5,  accel: 1.3,  turn: 0.95, mass: 0.7,  dashForce: 0.8,  size: 0.85, desc: 'Pure speed' },
};

export const CAR_HALF_LEN = 44;     // px at size 1 (sprite 131px × 0.7 scale)
export const CAR_HALF_WID = 23;     // px at size 1 (sprite 71px × 0.7 scale)
const INERTIA_FACTOR = 4;           // >1 = cars resist spinning (heavier than a uniform box)
const MAX_SPIN = 6;                 // rad/s cap on collision-induced spin

export const NITRO_TIME = 3.0;      // s of boost per nitro
export const NITRO_COOLDOWN = 7.0;  // s from pressing nitro until it's ready again

const RESTITUTION = 0.55;           // bounciness of a normal hit
const RESTITUTION_NITRO = 0.85;     // ramming with nitro
const STUN_MAX = 0.5;               // s of reduced grip after a big hit (so knockback carries)

const clampSpin = (v) => Math.max(-MAX_SPIN, Math.min(MAX_SPIN, v));

export function carSpec(p) {
    const s = p.carStats;
    return {
        top: 330 + 230 * (s.maxSpeed - 0.75) / 0.75,   // 330 (truck) … 560 (supercar) px/s
        accel: 560 * s.accel,
        turn: 2.5 * s.turn,
        grip: s.turn > 1.25 ? 950 : 1500,              // drifters let go of the rear sooner
    };
}

// Balloons power-up: you become very hard to shove while it's on
export function carMass(p) { return p.carStats.mass * p.scale * p.scale * (p.bumperTimer > 0 ? 4 : 1); }

export function carBox(p) {
    const size = p.carStats.size * p.scale;
    const hl = CAR_HALF_LEN * size, hw = CAR_HALF_WID * size;
    const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
    const sx = -fy, sy = fx;
    const m = carMass(p);
    return {
        p, hl, hw, fx, fy, sx, sy, m,
        inertia: m * ((2 * hl) ** 2 + (2 * hw) ** 2) / 12 * INERTIA_FACTOR,
        corners: [
            [p.x + fx * hl + sx * hw, p.y + fy * hl + sy * hw],
            [p.x + fx * hl - sx * hw, p.y + fy * hl - sy * hw],
            [p.x - fx * hl - sx * hw, p.y - fy * hl - sy * hw],
            [p.x - fx * hl + sx * hw, p.y - fy * hl + sy * hw],
        ],
    };
}

function projRadius(b, ax, ay) {
    return b.hl * Math.abs(b.fx * ax + b.fy * ay) + b.hw * Math.abs(b.sx * ax + b.sy * ay);
}

// Average of the box corners furthest along (nx, ny) — a face midpoint for flat contacts
function supportPoint(b, nx, ny) {
    let best = -Infinity;
    for (const c of b.corners) best = Math.max(best, c[0] * nx + c[1] * ny);
    let x = 0, y = 0, n = 0;
    for (const c of b.corners) {
        if (c[0] * nx + c[1] * ny > best - 1.5) { x += c[0]; y += c[1]; n++; }
    }
    return [x / n, y / n];
}

// Separating-axis test between two car boxes → { nx, ny, depth } (normal A→B) or null
function boxContact(A, B) {
    const dx = B.p.x - A.p.x, dy = B.p.y - A.p.y;
    let depth = Infinity, nx = 0, ny = 0;
    for (const [ax, ay] of [[A.fx, A.fy], [A.sx, A.sy], [B.fx, B.fy], [B.sx, B.sy]]) {
        const d = dx * ax + dy * ay;
        const o = projRadius(A, ax, ay) + projRadius(B, ax, ay) - Math.abs(d);
        if (o <= 0) return null;
        if (o < depth) { depth = o; const sg = d < 0 ? -1 : 1; nx = ax * sg; ny = ay * sg; }
    }
    return { nx, ny, depth };
}

// Car vs car: positional correction + impulse with spin, scraping friction and
// a short loss of grip so a solid hit actually knocks the other car back.
// Returns null (no contact) or { impact, cx, cy, aPushesB, bPushesA }.
export function collideCars(A, B) {
    const c = boxContact(A, B);
    if (!c) return null;
    const a = A.p, b = B.p;
    const { nx, ny, depth } = c;
    const invA = 1 / A.m, invB = 1 / B.m;

    // Push apart (mass-weighted) so cars never sit inside each other
    const corr = Math.max(0, depth - 0.3) / (invA + invB);
    a.x -= nx * corr * invA; a.y -= ny * corr * invA;
    b.x += nx * corr * invB; b.y += ny * corr * invB;

    // Contact point: between A's leading face and B's leading face
    const pa = supportPoint(A, nx, ny), pb = supportPoint(B, -nx, -ny);
    const cx = (pa[0] + pb[0]) / 2, cy = (pa[1] + pb[1]) / 2;
    const rax = cx - a.x, ray = cy - a.y, rbx = cx - b.x, rby = cy - b.y;

    const vax = a.vx - a.av * ray, vay = a.vy + a.av * rax;
    const vbx = b.vx - b.av * rby, vby = b.vy + b.av * rbx;
    const rvx = vbx - vax, rvy = vby - vay;
    const vn = rvx * nx + rvy * ny;

    // Who is shoving whom (also true during a steady shove against the fence)
    const res = {
        impact: 0, cx, cy,
        aPushesB: vax * nx + vay * ny > 60,
        bPushesA: -(vbx * nx + vby * ny) > 60,
    };
    if (vn >= 0) return res; // already separating

    let e = (a.nitro > 0 || b.nitro > 0) ? RESTITUTION_NITRO : RESTITUTION;
    if (a.megaTimer > 0 || b.megaTimer > 0) e += 0.15;
    e = Math.min(1, e);

    const raN = rax * ny - ray * nx, rbN = rbx * ny - rby * nx;
    const k = invA + invB + raN * raN / A.inertia + rbN * rbN / B.inertia;
    const j = -(1 + e) * vn / k;
    let ix = nx * j, iy = ny * j;

    // Tangential friction (scraping) — gives glancing blows their spin
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const raT = rax * ty - ray * tx, rbT = rbx * ty - rby * tx;
    const kt = invA + invB + raT * raT / A.inertia + rbT * rbT / B.inertia;
    const jt = Math.max(-0.25 * j, Math.min(0.25 * j, -vt / kt));
    ix += tx * jt; iy += ty * jt;

    a.vx -= ix * invA; a.vy -= iy * invA;
    b.vx += ix * invB; b.vy += iy * invB;
    a.av = clampSpin(a.av - (rax * iy - ray * ix) / A.inertia);
    b.av = clampSpin(b.av + (rbx * iy - rby * ix) / B.inertia);

    res.impact = -vn;
    if (res.impact > 110) {
        // Tyres lose their bite for a moment — the lighter car stays loose longer
        const stun = Math.min(STUN_MAX, res.impact / 1400);
        a.stun = Math.max(a.stun || 0, stun * Math.min(1.5, B.m / A.m));
        b.stun = Math.max(b.stun || 0, stun * Math.min(1.5, A.m / B.m));
    }
    return res;
}

// Car vs fence (circle of radius R) → contact or null
export function fenceContact(B, R) {
    const p = B.p;
    let far = null, farD = 0;
    for (const c of B.corners) {
        const d = Math.hypot(c[0], c[1]);
        if (d > farD) { farD = d; far = c; }
    }
    if (farD <= R) return null;
    const nx = far[0] / farD, ny = far[1] / farD;     // outward normal
    const rx = far[0] - p.x, ry = far[1] - p.y;
    const vcx = p.vx - p.av * ry, vcy = p.vy + p.av * rx;
    return { nx, ny, rx, ry, x: far[0], y: far[1], vn: vcx * nx + vcy * ny, pen: farD - R };
}

// Bounce off the fence and move back inside
export function bounceFence(B, c) {
    const p = B.p;
    if (c.vn > 0) {
        const rn = c.rx * c.ny - c.ry * c.nx;
        const j = 1.3 * c.vn / (1 / B.m + rn * rn / B.inertia);
        p.vx -= c.nx * j / B.m; p.vy -= c.ny * j / B.m;
        p.av = clampSpin(p.av - rn * j / B.inertia);
    }
    p.x -= c.nx * c.pen; p.y -= c.ny * c.pen;
}

// Engine, brakes, nitro, steering and tyre grip — once per tick.
// Returns true when nitro was fired this tick.
export function driveCar(p, inp) {
    const spec = carSpec(p);
    const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
    let fwd = p.vx * fx + p.vy * fy;
    let lat = -p.vx * fy + p.vy * fx;
    const stunned = p.stun > 0;
    const thr = inp.forward;

    // Nitro: a sustained boost (higher top speed + harder acceleration)
    let fired = false;
    if (inp.dash && p.dashCooldown <= 0) {
        p.nitro = NITRO_TIME;
        p.dashCooldown = NITRO_COOLDOWN;
        fwd = Math.max(fwd, 0) + 160 * p.carStats.dashForce;    // initial kick
        fired = true;
    }
    const boost = p.nitro > 0 ? 1.45 + 0.1 * p.carStats.dashForce : 1;
    const top = spec.top * p.speedMult * boost;
    const accel = spec.accel * p.speedMult * (p.nitro > 0 ? 2.2 : 1) * (stunned ? 0.35 : 1);
    const throttle = p.nitro > 0 ? Math.max(thr, 0.8) : thr;   // nitro keeps pulling

    // Engine / brakes
    if (throttle > 0.05) {
        if (fwd < -15) fwd = Math.min(0, fwd + 1100 * throttle * DT);       // braking out of reverse
        else fwd += accel * throttle * (1 - fwd / top) * DT;                 // also drags back above top speed
    } else if (throttle < -0.05) {
        const rTop = top * 0.45;
        if (fwd > 15) fwd = Math.max(0, fwd + 1100 * throttle * DT);       // brake
        else fwd += accel * 0.6 * throttle * (1 + fwd / rTop) * DT;         // reverse gear
    } else {
        const roll = (160 + 0.9 * Math.abs(fwd)) * DT * (stunned ? 0.4 : 1); // rolling resistance
        fwd = Math.abs(fwd) <= roll ? 0 : fwd - Math.sign(fwd) * roll;
    }

    // Tyre grip: scrub sideways velocity, but only so fast — hits make you slide
    let grip = p.slip > 0 ? 220 : spec.grip;
    if (stunned) grip *= 0.25;
    const scrub = grip * DT;
    p.skid = Math.abs(lat) > 150 || p.slip > 0;
    lat = Math.abs(lat) <= scrub ? 0 : lat - Math.sign(lat) * scrub;

    // Steering: yaw rate grows with speed, flips in reverse, tyres fight any spin
    const spd = Math.abs(fwd);
    const steerScale = Math.min(1, spd / 120) * (1 - 0.25 * Math.min(1, spd / top));
    const dir = fwd < -5 ? -1 : 1;
    const targetYaw = inp.steer * spec.turn * steerScale * dir;
    const yawResponse = p.slip > 0 ? 2.5 : stunned ? 2 : 10;
    p.av += (targetYaw - p.av) * Math.min(1, yawResponse * DT);

    p.vx = fx * fwd - fy * lat;
    p.vy = fy * fwd + fx * lat;
    const v = Math.hypot(p.vx, p.vy);
    if (v > 1600) { p.vx *= 1600 / v; p.vy *= 1600 / v; }

    // Timers
    if (p.slip > 0) p.slip = Math.max(0, p.slip - DT);
    if (p.stun > 0) p.stun = Math.max(0, p.stun - DT);
    if (p.nitro > 0) p.nitro = Math.max(0, p.nitro - DT);
    if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - DT);
    return fired;
}

// Move cars and resolve contacts for one tick, in sub-steps.
//   cars       — the cars to simulate (alive)
//   R          — fence radius
//   onPair     — (A, B, result) after a car/car contact (optional)
//   onFence    — (B, contact) before bouncing; return false to skip the bounce
//                (e.g. the car broke through and is out)
//   collides   — (a, b) → whether this pair should collide (optional)
export function stepCars(cars, R, { onPair, onFence, collides } = {}) {
    const h = DT / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
        cars = cars.filter(p => p.alive !== false);     // a car can go out mid-tick
        for (const p of cars) {
            if (p.frozen) continue;
            p.x += p.vx * h;
            p.y += p.vy * h;
            p.angle += p.av * h;
        }
        let boxes = cars.map(carBox);
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const A = boxes[i], B = boxes[j];
                if (collides && !collides(A.p, B.p)) continue;
                const reach = A.hl + B.hl + 2;
                if (Math.abs(A.p.x - B.p.x) > reach || Math.abs(A.p.y - B.p.y) > reach) continue;
                const r = collideCars(A, B);
                if (r && onPair) onPair(A, B, r);
            }
        }
        boxes = cars.map(carBox);      // positions moved — rebuild before the fence pass
        for (const B of boxes) {
            if (B.p.frozen) continue;
            const c = fenceContact(B, R);
            if (!c) continue;
            if (onFence && onFence(B, c) === false) continue;
            bounceFence(B, c);
        }
    }
}

// ─── Rocket targeting (shared so the lock-on marker matches the server) ──
export const ROCKET_RANGE = 950;            // px
export const ROCKET_CONE = 0.62;            // rad either side of the nose

// Best target in front of the shooter: close and near the centre line.
// cars: [{ id, x, y, alive }]  → the chosen car or null
export function pickRocketTarget(shooter, cars) {
    let best = null, bestScore = Infinity;
    for (const c of cars) {
        if (!c.alive || c.id === shooter.id) continue;
        const dx = c.x - shooter.x, dy = c.y - shooter.y;
        const d = Math.hypot(dx, dy);
        if (d > ROCKET_RANGE || d < 20) continue;
        let da = Math.atan2(dy, dx) - shooter.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) > ROCKET_CONE) continue;
        const score = d + Math.abs(da) * 500;
        if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
}
