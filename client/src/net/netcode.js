// ─── Netcode: snapshots, clock sync, prediction, smoothing ────────────────
// The server is the referee (60 Hz physics, 20 snapshots/s). To make the game
// feel instant, this client runs the *same* car physics for your own car the
// moment you touch a control, then quietly reconciles with what the server
// says. Other cars are extrapolated from their last known speed and smoothed,
// so they glide between the 20 updates a second.

import { DT, CAR_TYPES, driveCar, stepCars } from '../../../shared/physics.mjs';
import { socket } from './socket';

const PU_TYPES = ['SpeedBoost', 'Shield', 'MegaPush', 'Oil', 'Reverse', 'Magnet', 'Repair', 'Blades'];
const WEAPONS = [null, 'oil', 'reverse'];
const HAZARDS = ['oil', 'reverse'];
export const PLANE_SPEED = 560;     // must match the server
export const DROP_FALL_MS = 1800;

const STEP_MS = DT * 1000;
const NEUTRAL = { forward: 0, steer: 0, dash: false, shoot: false, drop: false };

function carState(p) {
    return {
        x: p.x, y: p.y, vx: p.vx, vy: p.vy, angle: p.angle, av: p.av,
        carStats: CAR_TYPES[p.carType] || CAR_TYPES.sports,
        scale: p.scale, speedMult: p.speedMult, slip: p.slip, stun: p.stun,
        nitro: p.nitro, dashCooldown: p.dashCooldown,
        megaTimer: p.scale > 1.1 ? 1 : 0, alive: true, skid: p.skid,
    };
}

class NetClient {
    constructor() {
        this.offset = 0;            // serverTime ≈ Date.now() + offset
        this.rtt = 120;
        this.bestRtt = Infinity;
        this.synced = false;
        this.roster = new Map();    // num → { id, name, carType, isBot, cosmetics }
        this.snap = null;           // latest decoded snapshot (HUD-friendly objects)
        this.remote = new Map();    // id → { st, ts, rx, ry, ra }
        this.local = null;          // predicted state of your own car
        this.prev = null;           // previous fixed step (for render interpolation)
        this.err = { x: 0, y: 0, a: 0 };
        this.acc = 0;
        this.inputs = [];           // [{ t: Date.now(), input }]
        this.cur = NEUTRAL;
        this.listeners = new Set();

        socket.on('s', (m) => this.onSnapshot(m));
        socket.on('connect', () => { this.bestRtt = Infinity; this.ping(); });
        setInterval(() => this.ping(), 2000);
        if (socket.connected) this.ping();
    }

    // ─── Clock sync: keep the offset from the lowest-latency pings ───────
    ping() {
        if (!socket.connected) return;
        const t0 = Date.now();
        socket.emit('tp', (srv) => {
            const t1 = Date.now();
            const rtt = t1 - t0;
            this.rtt = this.synced ? this.rtt * 0.8 + rtt * 0.2 : rtt;
            this.bestRtt *= 1.05;                 // slowly forget old best so we adapt
            if (rtt <= this.bestRtt) {
                this.bestRtt = rtt;
                const off = srv + rtt / 2 - t1;
                this.offset = this.synced ? this.offset * 0.5 + off * 0.5 : off;
                this.synced = true;
            }
        });
    }

    serverNow() { return Date.now() + this.offset; }

    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    reset() {
        this.local = null; this.prev = null;
        this.err = { x: 0, y: 0, a: 0 };
        this.remote.clear();
        this.acc = 0;
    }

    // ─── Inputs: remember when each control change happened ──────────────
    setInput(input) {
        this.cur = { ...input };
        const now = Date.now();
        this.inputs.push({ t: now, input: this.cur });
        while (this.inputs.length > 2 && this.inputs[1].t < now - 3000) this.inputs.shift();
    }

    inputAt(t) {
        let inp = this.inputs.length ? this.inputs[0].input : NEUTRAL;
        for (const e of this.inputs) { if (e.t <= t) inp = e.input; else break; }
        return inp;
    }

    // ─── Snapshot decode ─────────────────────────────────────────────────
    onSnapshot(m) {
        if (m.ro) {
            this.roster.clear();
            for (const [num, id, name, carType, isBot, cosmetics] of m.ro) {
                this.roster.set(num, { id, name, carType, isBot: !!isBot, cosmetics });
            }
        }
        const players = [];
        for (const a of m.p) {
            const r = this.roster.get(a[0]);
            if (!r) continue;
            players.push({
                id: r.id, name: r.name, isBot: r.isBot, carType: r.carType, cosmetics: r.cosmetics,
                x: a[1], y: a[2], angle: a[3], vx: a[4], vy: a[5], av: a[6],
                alive: !!(a[7] & 1), shield: !!(a[7] & 2), isDashing: !!(a[7] & 4),
                skid: !!(a[7] & 8), magnetTimer: (a[7] & 16) ? 1 : 0, blades: !!(a[7] & 32),
                dashCooldown: a[8], shootCooldown: a[9], nitro: a[10], slip: a[11], stun: a[12],
                speedMult: a[13] / 100, scale: a[14] / 100, weapon: WEAPONS[a[15]] || null, kills: a[16], hp: a[17] ?? 100, bladeLeft: a[18] || 0,
            });
        }
        const snap = {
            players,
            powerups: m.u.map(([id, t, x, y, ld]) => ({ id, type: PU_TYPES[t], x, y, landAt: m.t + ld })),
            projectiles: m.j.map(([id, x, y, vx, vy]) => ({ id, x, y, vx, vy })),
            hazards: m.h.map(([id, t, x, y]) => ({ id, type: HAZARDS[t], x, y })),
            planes: m.pl.map(([id, x, y, angle]) => ({ id, x, y, angle })),
            timestamp: m.t,
            elapsed: m.e,
            arenaRadius: m.r,
            arenaBase: m.b,
            suddenDeath: !!m.sd,
            shrinkIn: m.si,
            round: m.rd, maxRounds: m.mr,
            live: !!m.lv,
        };
        this.snap = snap;

        const myId = socket.id;
        for (const p of players) {
            let e = this.remote.get(p.id);
            if (!e) { e = { rx: p.x, ry: p.y, ra: p.angle }; this.remote.set(p.id, e); }
            e.st = p; e.ts = m.t;
            if (p.id === myId) this.reconcile(p, m.t, snap.live);
        }
        for (const id of [...this.remote.keys()]) if (!players.some(p => p.id === id)) this.remote.delete(id);

        for (const fn of this.listeners) fn(snap);
    }

    // ─── Prediction ──────────────────────────────────────────────────────
    // Remote cars at server time tau, as solid obstacles for your car
    obstacles(tau, near) {
        const out = [];
        for (const [id, e] of this.remote) {
            const st = e.st;
            if (!st || !st.alive || id === socket.id) continue;
            const dt = Math.max(0, Math.min(0.25, (tau - e.ts) / 1000));
            const x = st.x + st.vx * dt, y = st.y + st.vy * dt;
            if (near && Math.abs(x - near.x) > 260 || near && Math.abs(y - near.y) > 260) continue;
            out.push({
                x, y, angle: st.angle + st.av * dt, vx: st.vx, vy: st.vy, av: st.av,
                carStats: CAR_TYPES[st.carType] || CAR_TYPES.sports, scale: st.scale,
                nitro: st.nitro, megaTimer: st.scale > 1.1 ? 1 : 0, stun: 0, alive: true, frozen: true,
            });
        }
        return out;
    }

    simStep(car, input, tau) {
        driveCar(car, input);
        const R = this.snap ? this.snap.arenaRadius : 850;
        const obs = this.obstacles(tau, car);
        stepCars(obs.length ? [car, ...obs] : [car], R, {
            collides: (a, b) => a === car || b === car,
        });
    }

    // New authoritative state for your car: rewind to it, replay your inputs
    // up to "now + one-way latency" (when what you're pressing reaches the
    // server), and smooth over any difference.
    reconcile(p, ts, live) {
        if (!p.alive || !live) {
            this.local = null; this.prev = null;
            this.err = { x: 0, y: 0, a: 0 };
            return;
        }
        const st = carState(p);
        const oneWay = this.rtt / 2;
        const target = this.serverNow() + oneWay;
        const steps = Math.max(0, Math.min(40, Math.round((target - ts) / STEP_MS)));
        for (let i = 1; i <= steps; i++) {
            const tau = ts + i * STEP_MS;
            this.simStep(st, this.inputAt(tau - this.offset - oneWay), tau);
        }
        st.simTime = ts + steps * STEP_MS;
        if (this.local) {
            // Compare like with like: carry the old prediction forward to the
            // new prediction's moment, then keep only the real difference as a
            // visual offset that fades out (no snapping, no rubber-banding).
            const l = this.local;
            const dtA = (st.simTime - l.simTime) / 1000;
            const ex = l.x + l.vx * dtA + this.err.x - st.x;
            const ey = l.y + l.vy * dtA + this.err.y - st.y;
            if (this.debug) this.debug.push({ dt: dtA * 1000, err: Math.hypot(ex, ey), v: Math.hypot(st.vx, st.vy) });
            if (Math.hypot(ex, ey) > 220) this.err = { x: 0, y: 0, a: 0 };     // way off: just snap
            else {
                let ea = (l.angle + l.av * dtA + this.err.a) - st.angle;
                while (ea > Math.PI) ea -= Math.PI * 2;
                while (ea < -Math.PI) ea += Math.PI * 2;
                this.err = { x: ex, y: ey, a: ea };
            }
        }
        this.local = st;
        this.prev = { x: st.x, y: st.y, angle: st.angle };
        this.acc = 0;
    }

    // Advance your car between snapshots in fixed 60 Hz steps (called every
    // frame). It's driven by the clock, not the frame rate, so a slow phone
    // can't fall behind and need big corrections.
    step(deltaMs) {
        const decay = Math.exp(-deltaMs / 1000 * 9);
        this.err.x *= decay; this.err.y *= decay; this.err.a *= decay;
        if (!this.local) return;
        const target = this.serverNow() + this.rtt / 2;
        let n = 0;
        while (this.local.simTime + STEP_MS <= target && n < 30) {
            this.prev = { x: this.local.x, y: this.local.y, angle: this.local.angle };
            this.local.simTime += STEP_MS;
            this.simStep(this.local, this.cur, this.local.simTime);
            n++;
        }
        if (n === 30) this.local.simTime = target;          // hopelessly behind: resync
        this.acc = Math.max(0, Math.min(STEP_MS, target - this.local.simTime));
    }

    renderLocal() {
        const l = this.local, pv = this.prev || l;
        const t = this.acc / STEP_MS;
        return {
            x: pv.x + (l.x - pv.x) * t + this.err.x,
            y: pv.y + (l.y - pv.y) * t + this.err.y,
            angle: pv.angle + (l.angle - pv.angle) * t + this.err.a,
        };
    }

    // Where to draw a car this frame
    renderState(id, deltaMs) {
        if (id === socket.id && this.local) return this.renderLocal();
        const e = this.remote.get(id);
        if (!e || !e.st) return null;
        const st = e.st;
        const dt = st.alive ? Math.max(0, Math.min(0.2, (this.serverNow() - e.ts) / 1000)) : 0;
        const tx = st.x + st.vx * dt, ty = st.y + st.vy * dt, ta = st.angle + st.av * dt;
        const k = 1 - Math.pow(1e-6, Math.max(1, deltaMs) / 1000);
        if (Math.hypot(tx - e.rx, ty - e.ry) > 300) { e.rx = tx; e.ry = ty; e.ra = ta; }
        else {
            e.rx += (tx - e.rx) * k;
            e.ry += (ty - e.ry) * k;
            let da = ta - e.ra;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            e.ra += da * k;
        }
        return { x: e.rx, y: e.ry, angle: e.ra };
    }

    localSpeed() {
        return this.local ? Math.hypot(this.local.vx, this.local.vy) : 0;
    }
}

export const net = new NetClient();

// Handy for debugging in the browser console
if (typeof window !== 'undefined') { window.__dashNet = net; window.__dashSocket = socket; }
