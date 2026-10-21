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

// Every car has a real strength and a real weakness. The mass spread is kept
// narrow (0.8–1.6) so a light car isn't sent flying by every touch.
//   hp        — health (heavier cars are tougher)
//   stability — shrugs off hits: shorter loss of grip and harder to shove through the fence
export const CAR_TYPES = {
    sports:   { name: 'Venom GT',      role: 'All-rounder', maxSpeed: 1.2,  accel: 1.15, turn: 1.15, mass: 1.0,  dashForce: 1.0,  size: 0.9,  hp: 118, stability: 1.15, desc: 'Good at everything' },
    muscle:   { name: 'Thunder V8',    role: 'Bruiser',     maxSpeed: 1.12, accel: 1.05, turn: 0.9,  mass: 1.2,  dashForce: 1.3,  size: 1.1,  hp: 120, stability: 1.15, desc: 'Brutal rams, wide turns' },
    truck:    { name: 'War Rig',       role: 'Tank',        maxSpeed: 0.82, accel: 0.8,  turn: 0.78, mass: 1.35, dashForce: 1.45, size: 1.35, hp: 122, stability: 1.35, desc: 'Nearly impossible to push' },
    rally:    { name: 'Dust Devil',    role: 'Grip King',   maxSpeed: 1.1,  accel: 1.15, turn: 1.3,  mass: 1.05, dashForce: 1.0,  size: 0.95, hp: 118, stability: 1.45, desc: 'Shakes off hits instantly' },
    kart:     { name: 'Pocket Rocket', role: 'Dodger',      maxSpeed: 1.25, accel: 1.45, turn: 1.4,  mass: 0.95, dashForce: 0.9,  size: 0.75, hp: 118, stability: 1.4,  desc: 'Tiny, quick, hard to catch' },
    suv:      { name: 'Iron Shield',   role: 'Defender',    maxSpeed: 0.95, accel: 0.9,  turn: 0.92, mass: 1.3,  dashForce: 1.2,  size: 1.2,  hp: 122, stability: 1.25, desc: 'Heavy armour, slow start' },
    drift:    { name: 'Sidewinder',    role: 'Drifter',     maxSpeed: 1.1,  accel: 1.1,  turn: 1.55, mass: 1.0,  dashForce: 1.05, size: 0.95, hp: 118, stability: 1.1,  desc: 'Fastest turns, likes to slide' },
    supercar: { name: 'Phantom X',     role: 'Rocket',      maxSpeed: 1.45, accel: 1.3,  turn: 1.05, mass: 1.0,  dashForce: 1.25, size: 0.85, hp: 116, stability: 1.15, desc: 'Top speed, big nitro hits' },
};

export const CAR_HALF_LEN = 44;     // px at size 1 (sprite 131px × 0.7 scale)
export const CAR_HALF_WID = 23;     // px at size 1 (sprite 71px × 0.7 scale)
const INERTIA_FACTOR = 4;           // >1 = cars resist spinning (heavier than a uniform box)
const MAX_SPIN = 6;                 // rad/s cap on collision-induced spin

export const NITRO_TIME = 3.0;      // s of boost per nitro
export const NITRO_COOLDOWN = 7.0;  // s from pressing nitro until it's ready again

const RESTITUTION = 0.55;           // bounciness of a normal hit
const RESTITUTION_NITRO = 0.85;     // ramming with nitro
const PIVOT_TURN = 0.75;            // share of full turn rate when steering with no gas (turn on the spot)
const STUN_MAX = 0.5;               // s of reduced grip after a big hit (so knockback carries)

const clampSpin = (v) => Math.max(-MAX_SPIN, Math.min(MAX_SPIN, v));

// ─── Arenas ───────────────────────────────────────────────────────────────
// A different arena can be picked every round. The physics only ever sees an
// "env": { R, shape, half, pitR, ice, bar } built by arenaEnv().
export const ARENAS = {
    classic:  { name: 'Classic Ring', tip: 'Slam rivals into the fence — every hit costs health', shape: 'circle' },
    ice:      { name: 'Ice Rink',     tip: 'Slippery! Brake early, turn gently', shape: 'circle', ice: true },
    box:      { name: 'The Box',      tip: 'Corners are traps — stay out of them', shape: 'square' },
    sinkhole: { name: 'Sinkhole',     tip: 'The hole\'s rim is a wall — ram rivals into it', shape: 'circle', pit: 0.2 },
    windmill: { name: 'Windmill',     tip: 'Dodge the spinning bar', shape: 'circle', bar: { len: 0.6, w: 30, speed: 0.55 } },
};
export const ARENA_KEYS = Object.keys(ARENAS);

// ─── Game modes ───────────────────────────────────────────────────────────
export const GAME_MODES = {
    ffa:   { name: 'Last Car Standing', icon: '🏁', tip: 'Wreck everyone — last car standing wins' },
    teams: { name: 'Team Battle',       icon: '⚔️', tip: 'Red vs Blue — wreck the other team' },
    koth:  { name: 'King of the Hill',  icon: '👑', tip: 'Hold the centre zone to score — alone scores double' },
    bomb:  { name: 'Hot Bomb',          icon: '💣', tip: 'Bump someone to pass the bomb before it blows!' },
};
export const MODE_KEYS = Object.keys(GAME_MODES);
// Team Battle line-up: players who picked a team keep it, everyone else (then
// the bots) goes to whichever side is smaller. picks: 0 = auto, 1 = red, 2 = blue.
// Returns { humans: [team per pick], bots: [team per bot] }.
export function planTeams(picks, botCount) {
    const n = { 1: 0, 2: 0 };
    const humans = picks.map(t => (t === 1 || t === 2 ? t : 0));
    humans.forEach(t => { if (t) n[t]++; });
    for (let i = 0; i < humans.length; i++) {
        if (!humans[i]) { humans[i] = n[1] <= n[2] ? 1 : 2; n[humans[i]]++; }
    }
    const bots = [];
    for (let i = 0; i < botCount; i++) { const t = n[2] <= n[1] ? 2 : 1; bots.push(t); n[t]++; }
    return { humans, bots, red: n[1], blue: n[2] };
}

export const HILL_RADIUS = 150;       // px — the King of the Hill zone
export const HILL_TARGET = 15;        // s held to win the round
const SQUARE_HALF = 0.89;           // square arenas have about the same floor area as the ring

// R = current fence radius, barAngle = where the windmill bar points now
export function arenaEnv(key, R, barAngle = 0) {
    const a = ARENAS[key] || ARENAS.classic;
    return {
        key: ARENAS[key] ? key : 'classic', R, shape: a.shape,
        half: R * SQUARE_HALF,
        pitR: a.pit ? R * a.pit : 0,
        ice: !!a.ice,
        bar: a.bar ? { angle: barAngle, av: a.bar.speed, len: R * a.bar.len, w: a.bar.w } : null,
    };
}
const toEnv = (env) => (typeof env === 'number' ? arenaEnv('classic', env) : env);

// How far a point is from falling out (fence or pit); negative = already out
export function edgeDistance(env, x, y) {
    env = toEnv(env);
    const out = env.shape === 'square' ? env.half - Math.max(Math.abs(x), Math.abs(y)) : env.R - Math.hypot(x, y);
    return env.pitR ? Math.min(out, Math.hypot(x, y) - env.pitR) : out;
}

export function carSpec(p) {
    const s = p.carStats;
    return {
        top: 330 + 230 * (s.maxSpeed - 0.75) / 0.75,   // 330 (truck) … 560 (supercar) px/s
        accel: 560 * s.accel,
        turn: 3.8 * s.turn,                            // max yaw rate (rad/s) — quick, accurate steering
        grip: s.turn > 1.25 ? 1600 : 2300,             // drifters let go of the rear sooner
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
        a.stun = Math.max(a.stun || 0, stun * Math.min(1.5, B.m / A.m) / (a.carStats.stability || 1));
        b.stun = Math.max(b.stun || 0, stun * Math.min(1.5, A.m / B.m) / (b.carStats.stability || 1));
    }
    return res;
}

// Car vs fence (circle of radius R) → contact or null
function contactAt(p, pt, nx, ny, pen) {
    const rx = pt[0] - p.x, ry = pt[1] - p.y;
    const vcx = p.vx - p.av * ry, vcy = p.vy + p.av * rx;
    return { nx, ny, rx, ry, x: pt[0], y: pt[1], vn: vcx * nx + vcy * ny, pen };
}

// Deepest point of the car past the outer fence (n = outward normal)
export function fenceContact(B, env) {
    env = toEnv(env);
    const p = B.p;
    if (env.shape === 'square') {
        let best = null, pen = 0, nx = 0, ny = 0;
        for (const c of B.corners) {
            const px = Math.abs(c[0]) - env.half, py = Math.abs(c[1]) - env.half;
            if (px > pen) { pen = px; best = c; nx = Math.sign(c[0]); ny = 0; }
            if (py > pen) { pen = py; best = c; nx = 0; ny = Math.sign(c[1]); }
        }
        return best ? contactAt(p, best, nx, ny, pen) : null;
    }
    let far = null, farD = 0;
    for (const c of B.corners) {
        const d = Math.hypot(c[0], c[1]);
        if (d > farD) { farD = d; far = c; }
    }
    if (farD <= env.R) return null;
    return contactAt(p, far, far[0] / farD, far[1] / farD, farD - env.R);
}

// Rim of the sinkhole: the car's point nearest the centre, once it's over the hole
// (n points into the hole, so it works with bounceFence like a wall)
export function pitContact(B, pitR) {
    let near = null, nearD = Infinity;
    for (const c of B.corners) {
        const d = Math.hypot(c[0], c[1]);
        if (d < nearD) { nearD = d; near = c; }
    }
    if (!near || nearD >= pitR || nearD < 1e-3) return null;
    const c = contactAt(B.p, near, -near[0] / nearD, -near[1] / nearD, pitR - nearD);
    c.pit = true;
    return c;
}

// The windmill bar: a solid spinning beam through the centre
function barContact(B, bar) {
    const p = B.p;
    const ux = Math.cos(bar.angle), uy = Math.sin(bar.angle);
    const [c0, c1, c2, c3] = B.corners;
    const pts = [c0, c1, c2, c3, [p.x, p.y],
        [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2], [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2],
        [(c2[0] + c3[0]) / 2, (c2[1] + c3[1]) / 2], [(c3[0] + c0[0]) / 2, (c3[1] + c0[1]) / 2]];
    let best = null, bestPen = 0, bx = 0, by = 0, nx = 0, ny = 0;
    const half = bar.w / 2;
    for (const pt of pts) {
        const t = Math.max(-bar.len, Math.min(bar.len, pt[0] * ux + pt[1] * uy));
        const qx = ux * t, qy = uy * t;
        const dx = pt[0] - qx, dy = pt[1] - qy, d = Math.hypot(dx, dy);
        if (d < half && half - d > bestPen) {
            bestPen = half - d; best = pt; bx = qx; by = qy;
            // push the car out on its own side of the bar
            const side = d > 1e-3 ? 1 / d : 0;
            nx = d > 1e-3 ? dx * side : (p.x - qx); ny = d > 1e-3 ? dy * side : (p.y - qy);
            const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        }
    }
    if (!best) return null;
    // The beam itself is moving: relative speed decides how hard you get batted
    const c = contactAt(p, best, -nx, -ny, bestPen);
    const vbx = -bar.av * by, vby = bar.av * bx;
    c.vn -= vbx * c.nx + vby * c.ny;
    c.bar = true;
    return c;
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
export function driveCar(p, inp, env) {
    const spec = carSpec(p);
    const ice = !!(env && env.ice);
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
    const accel = spec.accel * p.speedMult * (p.nitro > 0 ? 2.2 : 1) * (stunned ? 0.35 : 1) * (ice ? 0.7 : 1);
    const throttle = p.nitro > 0 ? Math.max(thr, 0.8) : thr;   // nitro keeps pulling

    // Handbrake turn: brake + steer while moving → rear steps out, car whips round
    const handbrake = throttle < -0.05 && Math.hypot(fwd, lat) > 50 && fwd > -30 && Math.abs(inp.steer) > 0.3 && !stunned;
    p.handbrake = handbrake;

    // Engine / brakes
    if (throttle > 0.05) {
        if (fwd < -15) fwd = Math.min(0, fwd + 1100 * throttle * DT);       // braking out of reverse
        else fwd += accel * throttle * (1 - fwd / top) * DT;                 // also drags back above top speed
    } else if (throttle < -0.05) {
        const rTop = top * 0.45;
        if (fwd > 15) fwd = Math.max(0, fwd + (handbrake ? 300 : 1100) * (ice ? 0.35 : 1) * throttle * DT);   // brake (handbrake bleeds speed slower)
        else fwd += accel * 0.6 * throttle * (1 + fwd / rTop) * DT;         // reverse gear
    } else {
        const roll = (160 + 0.9 * Math.abs(fwd)) * DT * (stunned ? 0.4 : 1) * (ice ? 0.3 : 1); // rolling resistance
        fwd = Math.abs(fwd) <= roll ? 0 : fwd - Math.sign(fwd) * roll;
    }

    // Tyre grip: scrub sideways velocity, but only so fast — hits make you slide
    let grip = p.slip > 0 ? 220 : spec.grip;
    if (stunned) grip *= 0.25;
    if (handbrake) grip *= 0.4;
    if (ice) grip *= 0.25;
    const scrub = grip * DT;
    p.skid = Math.abs(lat) > (ice ? 260 : 150) || p.slip > 0 || handbrake;
    lat = Math.abs(lat) <= scrub ? 0 : lat - Math.sign(lat) * scrub;

    // Steering: full authority from walking pace, a little less at top speed,
    // flips in reverse; pulling away you can already turn. With no gas at all
    // the car still turns on the spot, so you can aim without driving off.
    // Tyres fight any spin.
    const spd = Math.abs(fwd);
    let steerScale = Math.min(1, spd / 70) * (1 - 0.15 * Math.min(1, spd / top));
    if (Math.abs(throttle) > 0.1) steerScale = Math.max(steerScale, 0.6);
    else if (Math.abs(inp.steer) > 0.1 && !stunned) steerScale = Math.max(steerScale, PIVOT_TURN);
    const dir = fwd < -5 ? -1 : 1;
    // (while handbraking the car pivots on its sliding rear, whatever the forward speed)
    const targetYaw = handbrake ? inp.steer * spec.turn * 1.7 : inp.steer * spec.turn * steerScale * dir;
    const yawResponse = (p.slip > 0 ? 2.5 : stunned ? 2 : handbrake ? 22 : 18) * (ice ? 0.55 : 1);
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
//   env        — arena (from arenaEnv) or just the fence radius
//   onPair     — (A, B, result) after a car/car contact (optional)
//   onFence    — (B, contact) before bouncing; return false to skip the bounce
//                (e.g. the car broke through and is out). Sinkhole rims come
//                through here too, with contact.pit set.
//   onBar      — (B, contact) when the windmill bar bats a car (optional)
//   collides   — (a, b) → whether this pair should collide (optional)
export function stepCars(cars, env, { onPair, onFence, onBar, collides } = {}) {
    env = toEnv(env);
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
            const c = fenceContact(B, env);
            if (c && !(onFence && onFence(B, c) === false)) bounceFence(B, c);
            if (env.pitR) {
                const pc = pitContact(B, env.pitR);
                if (pc && !(onFence && onFence(B, pc) === false)) bounceFence(B, pc);
            }
            if (env.bar) {
                const bc = barContact(B, env.bar);
                if (bc) {
                    if (onBar) onBar(B, bc);
                    bounceFence(B, bc);
                    if (bc.vn > 150) B.p.stun = Math.max(B.p.stun || 0, 0.25);
                }
            }
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
        if (!c.alive || c.id === shooter.id || (shooter.team && c.team === shooter.team)) continue;
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
