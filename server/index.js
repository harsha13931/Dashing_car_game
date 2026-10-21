// server/index.js — Dash Arena game server
// Production-grade multiplayer + AI bots

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const ARENA_RADIUS = 850;          // smaller ring = the fence is in reach from the start
const POWERUP_INTERVAL = 4000;
const MAX_POWERUPS = 12;
const ROOM_CLEANUP_MS = 5 * 60 * 1000;   // clean empty rooms after 5 min
const MAX_ROOMS = 50;
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_PROJECTILES = 40;
// Test hook: SIM_SPEED=10 runs the game clock 10× faster (for balance simulations)
const SIM_SPEED = Number(process.env.SIM_SPEED) || 1;
const CLOCK_T0 = Date.now();
const clock = () => (SIM_SPEED === 1 ? Date.now() : CLOCK_T0 + (Date.now() - CLOCK_T0) * SIM_SPEED);
const LOBBY_GRACE_MS = 10 * 60 * 1000;   // keep your seat this long if you leave the page
const MATCH_GRACE_MS = 90 * 1000;        // …or this long if a match is running

// Bot names for flavor
const BOT_NAMES = [
    'Turbo', 'Blaze', 'Viper', 'Ghost', 'Nitro', 'Shadow', 'Fury', 'Storm',
    'Bolt', 'Raven', 'Fang', 'Drift', 'Havoc', 'Rocket', 'Titan', 'Apex',
    'Striker', 'Phantom', 'Razor', 'Neon', 'Chrome', 'Pulse', 'Ember', 'Frost'
];

// Bot difficulty presets
const BOT_DIFFICULTY = {
    // tactics = how often a bot uses its role's clever moves instead of just chasing
    easy:   { reactionTime: 0.4, accuracy: 0.5, aggression: 0.3, dashSkill: 0.3, shootSkill: 0.2, tactics: 0.15 },
    medium: { reactionTime: 0.25, accuracy: 0.7, aggression: 0.5, dashSkill: 0.6, shootSkill: 0.5, tactics: 0.4 },
    hard:   { reactionTime: 0.12, accuracy: 0.9, aggression: 0.7, dashSkill: 0.85, shootSkill: 0.8, tactics: 0.8 },
    insane: { reactionTime: 0.06, accuracy: 0.97, aggression: 0.9, dashSkill: 0.95, shootSkill: 0.95, tactics: 1 }
};

// ─── Car types ────────────────────────────────────────────────────────────
// Car stats + driving/collision physics live in shared/physics.mjs (also run
// by the client for prediction). It's an ES module, so it's loaded at startup.
let PHYS = null;
let CAR_TYPES = {};

// ─── Express + Socket.IO ───────────────────────────────────────────────────
const app = express();
app.use(cors());

// Health check
app.get('/api/health', (_req, res) => {
    const roomCount = Object.keys(rooms).length;
    const playerCount = Object.values(rooms).reduce((s, r) => s + Object.keys(r.players).length, 0);
    res.json({ status: 'ok', rooms: roomCount, players: playerCount, uptime: process.uptime() });
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    pingTimeout: 10000,
    pingInterval: 5000,
    maxHttpBufferSize: 1e5 // 100KB max message
});

let rooms = {};

// ─── Player / Bot factory ──────────────────────────────────────────────────
function sanitizeCosmetics(c) {
    if (!c || typeof c !== 'object') return null;
    const pick = (v) => (typeof v === 'string' && v.length <= 24 ? v : undefined);
    return {
        paint: pick(c.paint) || 'factory',
        finish: pick(c.finish) || 'gloss',
        decal: pick(c.decal) || 'stock',
        decalColor: pick(c.decalColor) || 'white',
        spoiler: pick(c.spoiler) || 'stock',
        hood: pick(c.hood) || 'stock',
        wheel: pick(c.wheel) || 'stock',
        underglow: pick(c.underglow) || 'none',
        tint: pick(c.tint) || 'stock',
        topper: pick(c.topper) || 'none',
        trail: pick(c.trail) || 'classic',
    };
}

// Bots get their own random custom builds so the grid looks varied
const BOT_LOOK = {
    paint: ['blue', 'red', 'orange', 'green', 'purple', 'gold', 'teal', 'pink', 'white', 'black', 'lime'],
    finish: ['gloss', 'gloss', 'metallic', 'metallic', 'matte', 'chrome'],
    decal: ['stock', 'stock', 'none', 'stripes', 'side', 'flames', 'number', 'checker'],
    decalColor: ['white', 'black', 'red', 'yellow', 'blue', 'orange', 'lime'],
    spoiler: ['stock', 'stock', 'none', 'lip', 'wing', 'gt'],
    hood: ['stock', 'stock', 'bulge', 'scoop', 'vents', 'carbon'],
    wheel: ['stock', 'gold', 'chrome', 'red', 'neon', 'blue'],
    underglow: ['none', 'none', 'none', 'cyan', 'pink', 'green', 'purple', 'orange'],
    tint: ['stock', 'stock', 'dark', 'mirror'],
};
function randomBotLook() {
    const r = (a) => a[Math.floor(Math.random() * a.length)];
    const look = {};
    for (const k in BOT_LOOK) look[k] = r(BOT_LOOK[k]);
    return { ...look, topper: 'none', trail: 'classic' };
}

function raceNumber(name) {
    let h = 7;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 1 + (h % 98);
}

function sanitizeToken(t) {
    return typeof t === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(t) ? t : null;
}

function makePlayer(id, name, isBot = false, difficulty = 'medium', carType = 'sports', cosmetics = null, token = null) {
    const diff = BOT_DIFFICULTY[difficulty] || BOT_DIFFICULTY.medium;
    const validCar = CAR_TYPES[carType] ? carType : 'sports';
    return {
        id,
        token,                 // lets the same browser reclaim this seat after a reconnect
        connected: true,
        name: (typeof name === 'string' && name.trim().slice(0, 16)) || `Player_${id.slice(0, 4)}`,
        carType: validCar,
        carStats: CAR_TYPES[validCar],
        cosmetics: { ...(sanitizeCosmetics(cosmetics) || {}), number: raceNumber(name || id) },
        x: 0, y: 0,
        angle: 0,
        vx: 0, vy: 0,
        av: 0,               // angular velocity (rad/s)
        alive: true,
        num: 0,                // short id used in snapshots
        dashCooldown: 0,
        nitro: 0,              // s of nitro boost left
        stun: 0,               // s of reduced grip after a big hit
        shootCooldown: 0,
        lastHitAt: 0,
        lastHitBy: null,
        skid: false,
        speedMult: 1,
        shield: false,
        shieldTimer: 0,
        megaTimer: 0,
        hp: CAR_TYPES[validCar].hp || 100,   // health — 0 = wrecked (tougher cars have more)
        bladeTimer: 0,         // spinning saw blades power-up
        bladeHits: {},         // victim id → last blade hit time
        bumperTimer: 0,        // bouncy balloons power-up
        bumperHits: {},
        speedTimer: 0,
        inputs: { forward: 0, steer: 0, dash: false, shoot: false, drop: false },
        lastProcessedInput: 0,
        weapon: null,
        dropCooldown: 0,
        slip: 0,
        scale: 1,
        isDashing: false,
        isBot,
        botDifficulty: difficulty,
        botState: isBot ? {
            ...diff,
            targetId: null,
            thinkTimer: 0,
            personality: ['aggressive', 'defensive', 'hunter', 'collector'][Math.floor(Math.random() * 4)],
            stuckTimer: 0,
            lastX: 0, lastY: 0,
            dodgeDir: 0,
            fleeTimer: 0
        } : null,
        // Stats
        kills: 0,
        damageDealt: 0,
        powerupsCollected: 0,
        shotsFired: 0,
        dashesUsed: 0,
        survivalTime: 0
    };
}

// ─── Room factory ──────────────────────────────────────────────────────────
function createRoom(hostId) {
    if (Object.keys(rooms).length >= MAX_ROOMS) return null;

    const roomId = uuidv4().slice(0, 6).toUpperCase();
    rooms[roomId] = {
        id: roomId,
        hostId,
        players: {},
        powerups: [],
        projectiles: [],
        hazards: [],
        running: false,
        countdown: 0,
        lastTick: Date.now(),
        matchStartTime: 0,
        eliminationOrder: [],
        round: 0,
        maxRounds: 3,
        scores: {},     // id -> cumulative score
        planes: [],
        _uid: 0,        // ids for powerups / projectiles / hazards / planes
        _num: 0,        // short player numbers for snapshots
        _snapN: 0,
        _lastPlane: 0,
        rosterDirty: true,
        _cdlast: 0,
        createdAt: Date.now(),
        settings: {
            botCount: 3,
            botDifficulty: 'medium',
            arenaRadius: ARENA_RADIUS,
            powerupInterval: POWERUP_INTERVAL,
            arena: 'random',          // or one arena key every round
            mode: 'ffa',              // ffa | teams | koth | bomb
        }
    };
    return rooms[roomId];
}

function roomSummary(room) {
    return {
        id: room.id,
        hostId: room.hostId,
        players: Object.values(room.players).map(p => ({
            id: p.id, name: p.name, alive: p.alive, isBot: p.isBot,
            carType: p.carType, connected: p.connected !== false, cosmetics: p.cosmetics,
            kills: p.kills, powerupsCollected: p.powerupsCollected, teamPick: p.teamPick || 0,
        })),
        running: room.running,
        round: room.round,
        maxRounds: room.maxRounds,
        scores: room.scores,
        settings: room.settings
    };
}

function resetPlayers(room) {
    const ids = Object.keys(room.players);
    const n = ids.length;
    ids.forEach((id, i) => {
        const p = room.players[id];
        const a = (i / Math.max(1, n)) * Math.PI * 2;
        const spawnR = room.settings.arenaRadius * 0.42;
        p.x = Math.cos(a) * spawnR;
        p.y = Math.sin(a) * spawnR;
        p.vx = p.vy = 0;
        p.av = 0;
        p.angle = a + Math.PI;
        p.alive = true;
        p.speedMult = 1;
        p.shield = false;
        p.shieldTimer = 0;
        p.megaTimer = 0;
        p.hp = p.carStats.hp || 100;
        p.bladeTimer = 0;
        p.bladeHits = {};
        p.bumperTimer = 0;
        p.bumperHits = {};
        p.speedTimer = 0;
        p.slip = 0;
        p.scale = 1;
        p.isDashing = false;
        p.roundKills = 0;
        p.paidRound = -1;
        p.roundPowerups = 0;
        p.roundDamage = 0;
        p.survivalTime = 0;
        p.dashCooldown = 0;
        p.nitro = 0;
        p.stun = 0;
        p.lastHitAt = 0;
        p.lastHitBy = null;
        p.skid = false;
        p.shootCooldown = 0;
        p.weapon = null;
        p.dropCooldown = 0;
        p.inputs = { forward: 0, steer: 0, dash: false, shoot: false, drop: false };
        if (p.botState) {
            p.botState.targetId = null;
            p.botState.thinkTimer = 0;
            p.botState.stuckTimer = 0;
            p.botState.fleeTimer = 0;
        }
    });
}

// ─── AI Bot Brain ──────────────────────────────────────────────────────────
// Each car role drives its own way:
//   bully   (Tank, Defender, Bruiser) – gets between you and the centre, then shoves you out
//   brawler (All-rounder, Grip King)  – same push-out angles, mixes in rockets and power-ups
//   dodger  (Dodger, Drifter)         – sidesteps charges, circles and shoots, strikes when you're near the edge
//   lancer  (Rocket)                  – backs off for a run-up, then a long nitro ram
// Every bot also flees the fence, dodges rockets aimed at it, keeps away from
// saw blades and plays safe when badly damaged.
const BOT_STYLE = { truck: 'bully', suv: 'bully', muscle: 'bully', rally: 'brawler', sports: 'brawler', kart: 'dodger', drift: 'dodger', supercar: 'lancer' };
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

function updateBotAI(bot, room, now) {
    if (!bot.alive || !bot.isBot || !bot.botState) return;

    const bs = bot.botState;
    bs.thinkTimer -= DT;

    // Stuck detection runs every tick
    const moved = Math.hypot(bot.x - bs.lastX, bot.y - bs.lastY);
    if (moved < 0.5 && Math.abs(bot.inputs.forward) > 0.3) bs.stuckTimer += DT; else bs.stuckTimer = 0;
    bs.lastX = bot.x; bs.lastY = bot.y;

    // Only recalculate decisions periodically (based on reaction time)
    if (bs.thinkTimer > 0) return;
    bs.thinkTimer = bs.reactionTime + Math.random() * 0.1;

    // Training dummy: cruises slowly round the middle, never attacks
    if (room.settings.training) {
        const a = Math.atan2(bot.y, bot.x) + 0.5;
        const r = Math.min(320, (room.arenaR || 850) * 0.4);
        const d = wrapAngle(Math.atan2(Math.sin(a) * r - bot.y, Math.cos(a) * r - bot.x) - bot.angle);
        bot.inputs = { forward: 0.45, steer: Math.max(-1, Math.min(1, d * 2.5)), dash: false, shoot: false, drop: false };
        return;
    }

    const style = BOT_STYLE[bot.carType] || 'brawler';
    const smart = Math.random() < (bs.tactics ?? bs.dashSkill);   // easy bots mostly just chase
    const warmup = now < room.matchStartTime + FENCE_LOCK_MS;      // opening seconds: nobody can go out yet
    const enemies = Object.values(room.players).filter(p => p.alive && p.id !== bot.id && !mates(p, bot));
    const arenaR = room.arenaR || room.settings.arenaRadius;
    const env = room.env || PHYS.arenaEnv('classic', arenaR);
    const myR = Math.hypot(bot.x, bot.y);
    const speed = Math.hypot(bot.vx, bot.vy);
    const maxHp = bot.carStats.hp || 100;
    const myMass = PHYS.carMass(bot);
    const armed = bot.bladeTimer > 0 || bot.bumperTimer > 0 || bot.scale > 1.2 || bot.shield;

    let forward = 1, steer = 0, dash = false, shoot = false, drop = false;
    let aimDiff = 0;
    const steerTo = (x, y, gain = 2.6) => {
        let d = wrapAngle(Math.atan2(y - bot.y, x - bot.x) - bot.angle);
        d += (Math.random() - 0.5) * (1 - bs.accuracy) * 0.5;
        aimDiff = d;
        steer = Math.max(-1, Math.min(1, d * gain));
        forward = 1;
        // Target behind us at speed: handbrake turn like a player would
        if (Math.abs(d) > 2.2 && speed > 180) { forward = -1; steer = Math.sign(d); }
        return d;
    };
    const finish = () => {
        if (bs.stuckTimer > 0.6) { forward = -0.7; steer = bs.dodgeDir || 1; bs.stuckTimer = 0; }
        bot.inputs = { forward, steer, dash: dash && bot.dashCooldown <= 0, shoot, drop };
    };

    // ─── 1. Survive: get away from the fence, the sinkhole and the windmill ─
    const margin = (room.suddenDeath ? 230 : 160) + speed * 0.12;
    const outerGap = env.shape === 'square' ? env.half - Math.max(Math.abs(bot.x), Math.abs(bot.y)) : arenaR - myR;
    if (outerGap < margin) {
        const d = steerTo(0, 0, 3);
        if (Math.abs(d) > 1.9) { forward = -1; steer = -Math.sign(d); }   // nose to the fence: reverse out
        else if (outerGap < margin * 0.5 && Math.abs(d) < 0.5) dash = true;
        return finish();
    }
    if (env.pitR && myR - env.pitR < 110 + speed * 0.18) {
        // Head away from the hole, curving around it
        const k = (env.pitR + 280) / (myR || 1);
        const d = steerTo(bot.x * k - bot.y * 0.4, bot.y * k + bot.x * 0.4, 3);
        if (Math.abs(d) > 1.9) { forward = -1; steer = -Math.sign(d); }
        return finish();
    }
    if (env.bar && Math.random() < bs.accuracy) {
        const ux = Math.cos(env.bar.angle), uy = Math.sin(env.bar.angle);
        const t = Math.max(-env.bar.len, Math.min(env.bar.len, bot.x * ux + bot.y * uy));
        const dx = bot.x - ux * t, dy = bot.y - uy * t, d = Math.hypot(dx, dy) || 1;
        // Is the bar sweeping toward us?
        const comingAtMe = (-env.bar.av * uy * t * dx + env.bar.av * ux * t * dy) < 0;
        if (d < 120 && comingAtMe && Math.abs(t) < env.bar.len) {
            steerTo(bot.x + (dx / d) * 200 - bot.x * 0.2, bot.y + (dy / d) * 200 - bot.y * 0.2, 3);
            return finish();
        }
    }

    // ─── 2. Dodge rockets heading for us ───────────────────────────────
    for (const pr of room.projectiles) {
        if (pr.ownerId === bot.id) continue;
        const dx = bot.x - pr.x, dy = bot.y - pr.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 380) continue;
        const ps = Math.hypot(pr.vx, pr.vy) || 1;
        const along = (dx * pr.vx + dy * pr.vy) / ps;           // how far ahead of the rocket we are
        const miss = Math.abs(dx * pr.vy - dy * pr.vx) / ps;     // sideways distance from its path
        if ((pr.targetId === bot.id || miss < 70) && along > 0 && Math.random() < bs.accuracy) {
            // Break sideways, toward the centre side of the rocket's path
            const px = -pr.vy / ps, py = pr.vx / ps;
            const side = (px * -bot.x + py * -bot.y) > 0 ? 1 : -1;
            steerTo(bot.x + px * side * 200, bot.y + py * side * 200, 3);
            if (dist < 200 && style === 'dodger') dash = true;
            return finish();
        }
    }

    // ─── Hot Bomb: chase people while carrying it, run from whoever has it ─
    if (room.mode === 'bomb' && room.bomb.holder) {
        if (room.bomb.holder === bot.id) {
            const prey = enemies.reduce((b, e) => {
                const d = Math.hypot(e.x - bot.x, e.y - bot.y);
                return d < b.d ? { e, d } : b;
            }, { e: null, d: Infinity });
            if (prey.e) {
                const d = steerTo(prey.e.x + prey.e.vx * 0.3, prey.e.y + prey.e.vy * 0.3, 3);
                if (prey.d < 320 && Math.abs(d) < 0.35 && Math.random() < bs.dashSkill) dash = true;
                return finish();
            }
        } else {
            const h = room.players[room.bomb.holder];
            const hd = h ? Math.hypot(h.x - bot.x, h.y - bot.y) : Infinity;
            if (h && hd < 420 && Math.random() < 0.4 + bs.accuracy * 0.6) {
                const dx = bot.x - h.x, dy = bot.y - h.y;
                steerTo(bot.x + (dx / hd) * 250 - bot.x * 0.35, bot.y + (dy / hd) * 250 - bot.y * 0.35, 3);
                if (hd < 200) dash = true;
                return finish();
            }
        }
    }

    // ─── 3. Sidestep a car charging at us ──────────────────────────────
    for (const e of enemies) {
        const dx = bot.x - e.x, dy = bot.y - e.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 300 || dist < 1) continue;
        const closing = ((e.vx - bot.vx) * dx + (e.vy - bot.vy) * dy) / dist;
        const eSpeed = Math.hypot(e.vx, e.vy);
        const headingAtMe = eSpeed > 1 && (e.vx * dx + e.vy * dy) / (eSpeed * dist) > 0.93;
        const scary = PHYS.carMass(e) > myMass * 0.9 || e.nitro > 0 || e.bladeTimer > 0;
        const exposed = myR > arenaR * 0.5 || bot.hp < maxHp * 0.4;
        const wants = style === 'dodger' ? 0.9 : style === 'lancer' ? 0.6 : exposed ? 0.5 : 0.15;
        if (closing > 220 && headingAtMe && scary && !armed && smart && Math.random() < wants) {
            const ex = e.vx / eSpeed, ey = e.vy / eSpeed;
            const px = -ey, py = ex;
            const side = (px * -bot.x + py * -bot.y) > 0 ? 1 : -1;   // dodge toward the centre
            steerTo(bot.x + px * side * 220 + ex * 40, bot.y + py * side * 220 + ey * 40, 3.2);
            if (dist < 200 && style !== 'bully') dash = true;
            return finish();
        }
    }

    // ─── 4. Keep away from spinning saws ───────────────────────────────
    if (!armed) {
        const saw = enemies.find(e => e.bladeTimer > 0 && Math.hypot(e.x - bot.x, e.y - bot.y) < 260);
        if (saw) {
            const dx = bot.x - saw.x, dy = bot.y - saw.y, d = Math.hypot(dx, dy) || 1;
            // Run away, bending toward the centre so we don't flee into the fence
            steerTo(bot.x + (dx / d) * 200 - bot.x * 0.25, bot.y + (dy / d) * 200 - bot.y * 0.25, 3);
            if (bot.shootCooldown <= 0 && Math.abs(wrapAngle(Math.atan2(saw.y - bot.y, saw.x - bot.x) - bot.angle)) < 0.3) shoot = true;
            return finish();
        }
    }

    // ─── 5. Power-ups (repair first when hurt) ─────────────────────────
    let pick = null, pickDist = Infinity;
    const hurt = bot.hp < maxHp * 0.45;
    for (const pu of room.powerups) {
        if (pu.landAt > now + 600) continue;
        if (PHYS.edgeDistance(env, pu.x, pu.y) < 110) continue;      // not worth dying for
        let d = Math.hypot(pu.x - bot.x, pu.y - bot.y);
        if (pu.type === 'Repair') d *= hurt ? 0.3 : 1.4;
        if (d < pickDist) { pick = pu; pickDist = d; }
    }
    const puRange = warmup ? 700 : bs.personality === 'collector' ? 520 : style === 'dodger' ? 360 : 260;
    if (pick && (pickDist < puRange || (hurt && pick.type === 'Repair'))) {
        steerTo(pick.x, pick.y);
        if (pickDist < 60) forward = 0.6;
        return finish();
    }

    // ─── 6. Badly hurt: stay central, keep distance, shoot ─────────────
    const nearest = enemies.reduce((b, e) => {
        const d = Math.hypot(e.x - bot.x, e.y - bot.y);
        return d < b.d ? { e, d } : b;
    }, { e: null, d: Infinity });
    if (bot.hp < maxHp * 0.3 && !armed && nearest.e && nearest.d < 360 && smart) {
        const dx = bot.x - nearest.e.x, dy = bot.y - nearest.e.y, d = nearest.d || 1;
        steerTo(bot.x + (dx / d) * 150 - bot.x * 0.4, bot.y + (dy / d) * 150 - bot.y * 0.4);
        maybeShoot();
        return finish();
    }

    // ─── King of the Hill: hold the zone, shove anyone else off it ─────
    let forced = null;
    if (room.mode === 'koth') {
        const inZone = enemies.filter(e => Math.hypot(e.x, e.y) < PHYS.HILL_RADIUS + 40);
        const sniper = (bs.personality === 'hunter' || style === 'dodger') && inZone.length >= 2;
        if (sniper && myR > PHYS.HILL_RADIUS) {
            // Crowded hill: hang back at rocket range and pick them off
            const a = Math.atan2(bot.y, bot.x) + 0.4;
            steerTo(Math.cos(a) * 300, Math.sin(a) * 300);
            forward = 0.6;
            maybeShoot();
            return finish();
        }
        if (inZone.length) {
            forced = inZone.reduce((b, e) => (Math.hypot(e.x - bot.x, e.y - bot.y) < Math.hypot(b.x - bot.x, b.y - bot.y) ? e : b));
        } else if (myR > PHYS.HILL_RADIUS - 30) {
            steerTo(0, 0);
            if (myR < PHYS.HILL_RADIUS + 90) forward = 0.55;
            return finish();
        } else {
            steerTo(Math.cos(now / 900) * 60, Math.sin(now / 900) * 60);
            forward = 0.35;
            maybeShoot();
            return finish();
        }
    }

    // ─── 7. Attack: pick a victim ──────────────────────────────────────
    let target = forced, best = forced ? Infinity : -Infinity;
    for (const e of enemies) {
        const d = Math.hypot(e.x - bot.x, e.y - bot.y);
        const edge = PHYS.edgeDistance(env, e.x, e.y);
        let score = -d * 0.004 + (edge < 260 ? (260 - edge) * 0.012 : 0) + (1 - e.hp / (e.carStats.hp || 100)) * 0.8;
        if (style === 'bully' && PHYS.carMass(e) < myMass) score += 0.5;      // pick on lighter cars
        if (e.id === bs.targetId) score += 0.6;                                 // don't flip-flop
        if (e.bladeTimer > 0 && !armed) score -= 2;
        if (score > best) { best = score; target = e; }
    }
    bs.targetId = target ? target.id : null;
    if (warmup && target && !forced) {
        // Fence is locked: jostle for position near the middle instead of lining up a knock-out
        const a = Math.atan2(bot.y, bot.x) + 0.6;
        steerTo(Math.cos(a) * 260, Math.sin(a) * 260);
        forward = 0.75;
        return finish();
    }
    if (!target) { steerTo(Math.cos(now / 3000) * 150, Math.sin(now / 3000) * 150); return finish(); }

    const tx = target.x, ty = target.y;
    const tR = Math.hypot(tx, ty) || 1;
    // Which way to shove the target: toward its nearest wall (or into the sinkhole)
    let ux = tx / tR, uy = ty / tR;
    if (env.shape === 'square') { if (Math.abs(tx) > Math.abs(ty)) { ux = Math.sign(tx); uy = 0; } else { ux = 0; uy = Math.sign(ty); } }
    const outerT = env.shape === 'square' ? env.half - Math.max(Math.abs(tx), Math.abs(ty)) : arenaR - tR;
    if (env.pitR && tR - env.pitR < outerT) { ux = -tx / tR; uy = -ty / tR; }
    const dist = Math.hypot(tx - bot.x, ty - bot.y);
    const targetEdge = PHYS.edgeDistance(env, tx, ty);
    // Are we on the centre side of the target, lined up to push it outward?
    const inside = ((bot.x - tx) * ux + (bot.y - ty) * uy) < -25;
    const lead = Math.min(0.45, dist / 900);
    const leadX = tx + target.vx * lead, leadY = ty + target.vy * lead;

    const charge = (nitroDist) => {
        const d = steerTo(leadX, leadY, 3);
        if (dist < nitroDist && Math.abs(d) < 0.32 && Math.random() < bs.dashSkill) dash = true;
    };
    const stage = (back, sideways = 0) => {
        // A point on the centre side of the target (plus a little sideways so we don't hit it on the way)
        const px = -uy, py = ux;
        const s = Math.sign((bot.x - tx) * px + (bot.y - ty) * py) || 1;
        steerTo(tx - ux * back + px * s * sideways, ty - uy * back + py * s * sideways);
    };

    if (!smart || armed) {
        charge(armed ? 260 : 180);
    } else if (style === 'bully' || style === 'brawler') {
        if (inside || targetEdge > 380 || dist < 110) charge(style === 'bully' ? 240 : 200);
        else stage(170, dist < 260 ? 90 : 0);
    } else if (style === 'lancer') {
        bs.runUp = bs.runUp || 0;
        if (bs.runUp > 0) {
            bs.runUp -= bs.reactionTime;
            charge(420);
        } else if (dist < 300 && !inside) {
            stage(400, 120);                                 // back off for a run-up
        } else if (inside && dist > 280) {
            bs.runUp = 1.4;
            charge(420);
        } else {
            stage(380);
        }
    } else {   // dodger
        if (targetEdge < 230 && inside) charge(200);
        else if (dist > 320) stage(220, 140);
        else {
            // Circle the target at rocket range
            const ang = Math.atan2(bot.y - ty, bot.x - tx) + (bs.dodgeDir || 1) * 0.9;   // (circle point is pulled toward the middle)
            steerTo(tx + Math.cos(ang) * 260 - tx * 0.15, ty + Math.sin(ang) * 260 - ty * 0.15);
        }
    }
    maybeShoot();

    // Held traps: drop them on someone tailing us
    if (bot.weapon) {
        const tail = enemies.find(e => {
            const dx = e.x - bot.x, dy = e.y - bot.y, d = Math.hypot(dx, dy);
            return d < 240 && (dx * Math.cos(bot.angle) + dy * Math.sin(bot.angle)) / (d || 1) < -0.6;
        });
        if (tail || Math.random() < 0.01) drop = true;
    }
    if (Math.random() < 0.02) bs.dodgeDir = -(bs.dodgeDir || 1);
    return finish();

    function maybeShoot() {
        if (bot.shootCooldown > 0 || now < room.matchStartTime + FENCE_LOCK_MS) return;   // no shooting in the opening seconds
        const t = PHYS.pickRocketTarget(bot, Object.values(room.players));
        if (!t) return;
        const d = Math.hypot(t.x - bot.x, t.y - bot.y);
        const keen = style === 'dodger' || bs.personality === 'hunter' ? 0.4 : 0.22;
        if (d > 150 && d < 650 && Math.random() < bs.shootSkill * keen) shoot = true;
    }
}

// ─── Physics helpers ───────────────────────────────────────────────────────
function applyPowerup(type, player, room) {
    player.powerupsCollected++;
    player.roundPowerups = (player.roundPowerups || 0) + 1;
    switch (type) {
        case 'SpeedBoost':
            player.speedMult = 1.6;
            player.speedTimer = 5;
            break;
        case 'Shield':
            player.shield = true;
            player.shieldTimer = 7;
            break;
        case 'MegaPush':
            player.scale = 1.5;
            player.speedMult = Math.max(player.speedMult, 1.2);
            player.megaTimer = 7;
            break;
        case 'Oil':
            player.weapon = 'oil';      // held trap; deploy with Drop
            break;
        case 'Reverse':
            player.weapon = 'reverse';  // held trap; deploy with Drop
            break;
        case 'Repair':
            player.hp = Math.min(player.carStats.hp || 100, player.hp + 40);   // health pack
            break;
        case 'Blades':
            player.bladeTimer = 8;                      // spinning saws for 8 s
            player.bladeHits = {};
            break;
        case 'Bumper':
            player.bumperTimer = 10;                    // bouncy balloons for 10 s
            player.bumperHits = {};
            break;
        case 'Magnet':
            // Pull nearby powerups toward player for 3 seconds (handled in tick)
            player.magnetTimer = 3;
            break;
    }
}

function beginRound(room) {
    room.running = true;
    room.countdown = 3;
    room.powerups = [];
    room.projectiles = [];
    room.hazards = [];
    room.matchStartTime = clock() + 3000;
    room.eliminationOrder = [];
    room.arenaR = room.settings.arenaRadius;
    room.mode = room.settings.mode || 'ffa';
    room.arenaKey = pickArena(room);
    setupMode(room);
    room.barAngle = 0;
    room.suddenDeath = false;
    room._shrinkAnnounced = false;
    room._cdlast = clock();         // show "3" for a full second
    room.planes = [];
    room._tick = 0;
    room._snapN = 0;
    room.rosterDirty = true;
    resetPlayers(room);
    // Test hook: SIM_GIVE=Bumper hands the host a power-up at the start of each round
    if (process.env.SIM_GIVE && room.players[room.hostId]) applyPowerup(process.env.SIM_GIVE, room.players[room.hostId], room);
    // Windmill: start with the bar pointing between two cars
    const n = Object.keys(room.players).length;
    room.barAngle = Math.PI / Math.max(1, n);
    room.env = PHYS.arenaEnv(room.arenaKey, room.arenaR, room.barAngle);
    io.to(room.id).emit('matchStart', { count: room.countdown, round: room.round, maxRounds: room.maxRounds, arena: room.arenaKey, mode: room.mode });
}

function setupMode(room) {
    const players = Object.values(room.players);
    if (room.mode === 'teams') {
        // Keep teams for the whole match: players' own picks first, then the
        // rest (and the bots) balance out the sides
        if (room.round <= 1 || players.some(p => !p.team)) {
            const humans = players.filter(p => !p.isBot), bots = players.filter(p => p.isBot);
            let plan = PHYS.planTeams(humans.map(p => p.teamPick || 0), bots.length);
            if (!plan.red || !plan.blue) plan = PHYS.planTeams(humans.map(() => 0), bots.length);   // never an empty side
            humans.forEach((p, i) => { p.team = plan.humans[i]; });
            bots.forEach((p, i) => { p.team = plan.bots[i]; });
        }
    } else {
        for (const p of players) p.team = 0;
    }
    for (const p of players) p.hill = 0;
    room.hill = { holder: 0, contested: false };
    room.bomb = { holder: null, fuseEnd: 0, passAt: 0, nextAt: 0, count: 0 };
    room.rosterDirty = true;
}

// Random arena each round (never the same twice in a row); round 1 of a
// player's first match is always the classic ring
function pickArena(room) {
    const want = room.settings.arena;
    if (want && want !== 'random' && PHYS.ARENAS[want]) return room.mode === 'koth' && want === 'sinkhole' ? 'classic' : want;
    if (room.round <= 1 && !room._playedBefore) { room._playedBefore = true; return 'classic'; }
    // (no sinkhole in King of the Hill — the hill is in the middle)
    const keys = PHYS.ARENA_KEYS.filter(k => k !== room.arenaKey && !(room.mode === 'koth' && k === 'sinkhole'));
    return keys[Math.floor(Math.random() * keys.length)];
}

function tickTimers(p) {
    if (p.shieldTimer > 0) { p.shieldTimer -= DT; if (p.shieldTimer <= 0) p.shield = false; }
    if (p.megaTimer > 0) { p.megaTimer -= DT; if (p.megaTimer <= 0) { p.scale = 1; if (p.speedTimer <= 0) p.speedMult = 1; } }
    if (p.speedTimer > 0) { p.speedTimer -= DT; if (p.speedTimer <= 0 && p.megaTimer <= 0) p.speedMult = 1; }
    if (p.magnetTimer > 0) p.magnetTimer -= DT;
    if (p.bladeTimer > 0) p.bladeTimer -= DT;
    if (p.bumperTimer > 0) p.bumperTimer = Math.max(0, p.bumperTimer - DT);
}

function addPlayer(room, p) {
    p.num = ++room._num;
    room.players[p.id] = p;
    room.rosterDirty = true;
    return p;
}

// ─── Seats: leaving, reclaiming, host hand-off ────────────────────────────
function connectedHumans(room) {
    return Object.values(room.players).filter(p => !p.isBot && p.connected !== false);
}

function removePlayer(room, id) {
    delete room.players[id];
    room.rosterDirty = true;
    const humans = Object.values(room.players).filter(p => !p.isBot);
    if (humans.length === 0) { delete rooms[room.id]; return; }
    if (room.hostId === id || !room.players[room.hostId]) {
        room.hostId = (connectedHumans(room)[0] || humans[0]).id;
    }
    io.to(room.id).emit('roomUpdate', roomSummary(room));
}

// Move a player to a new socket id (ids are socket ids everywhere)
function rekeyPlayer(room, oldId, newId) {
    const p = room.players[oldId];
    delete room.players[oldId];
    p.id = newId;
    room.players[newId] = p;
    room.rosterDirty = true;
    if (room.hostId === oldId) room.hostId = newId;
    if (room.scores[oldId] !== undefined) { room.scores[newId] = room.scores[oldId]; delete room.scores[oldId]; }
    for (const e of room.eliminationOrder) if (e.id === oldId) e.id = newId;
    for (const h of room.hazards) if (h.ownerId === oldId) h.ownerId = newId;
    for (const pr of room.projectiles) if (pr.ownerId === oldId) pr.ownerId = newId;
    for (const q of Object.values(room.players)) if (q.lastHitBy === oldId) q.lastHitBy = newId;
}

// ─── Socket events ─────────────────────────────────────────────────────────
io.on('connection', socket => {
    console.log(`[connect] ${socket.id}`);

    socket.on('createRoom', ({ name, botCount, botDifficulty, carType, cosmetics, token, arena, training, mode }, cb) => {
        if (typeof cb !== 'function') return;
        const room = createRoom(socket.id);
        if (!room) return cb({ error: 'Server full, try again later' });

        socket.join(room.id);
        addPlayer(room, makePlayer(socket.id, name, false, 'medium', carType, cosmetics, sanitizeToken(token)));
        const requestedBots = parseInt(botCount);
        room.settings.botCount = Math.min(7, Math.max(0, Number.isNaN(requestedBots) ? 3 : requestedBots));
        room.settings.botDifficulty = BOT_DIFFICULTY[botDifficulty] ? botDifficulty : 'medium';
        if (arena === 'random' || PHYS.ARENAS[arena]) room.settings.arena = arena;
        if (PHYS.GAME_MODES[mode]) room.settings.mode = mode;
        if (training) {
            room.settings.mode = 'ffa';
            // Tutorial: one round against a single harmless practice bot
            room.settings.training = true;
            room.settings.botCount = 1;
            room.settings.botDifficulty = 'easy';
            room.settings.arena = 'classic';
            room.maxRounds = 1;
        }

        cb({ roomId: room.id, player: room.players[socket.id] });
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('joinRoom', ({ roomId, name, carType, cosmetics, token }, cb) => {
        if (typeof cb !== 'function') return;
        const room = rooms[roomId?.toUpperCase?.()];
        if (!room) return cb({ error: 'Room not found' });
        if (Object.keys(room.players).length >= MAX_PLAYERS_PER_ROOM) return cb({ error: 'Room is full' });
        if (room.running) return cb({ error: 'Match in progress — try again when this round ends' });

        socket.join(room.id);
        addPlayer(room, makePlayer(socket.id, name, false, 'medium', carType, cosmetics, sanitizeToken(token)));
        cb({ roomId: room.id, player: room.players[socket.id] });
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('updateSettings', ({ roomId, settings }) => {
        const room = rooms[roomId];
        if (!room || room.hostId !== socket.id || room.running) return;
        if (settings.botCount !== undefined) room.settings.botCount = Math.min(MAX_PLAYERS_PER_ROOM - 1, Math.max(0, parseInt(settings.botCount) || 0));
        if (settings.botDifficulty && BOT_DIFFICULTY[settings.botDifficulty]) room.settings.botDifficulty = settings.botDifficulty;
        if (settings.arena === 'random' || PHYS.ARENAS[settings.arena]) room.settings.arena = settings.arena;
        if (PHYS.GAME_MODES[settings.mode] && settings.mode !== room.settings.mode) {
            room.settings.mode = settings.mode;
            for (const p of Object.values(room.players)) p.team = 0;      // new teams next match
        }
        if (settings.maxRounds !== undefined) room.maxRounds = Math.min(10, Math.max(1, parseInt(settings.maxRounds) || 3));
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    // Team Battle: pick your side in the room (0 = auto)
    socket.on('chooseTeam', ({ roomId, team }) => {
        const room = rooms[roomId];
        const p = room && room.players[socket.id];
        if (!p || room.running) return;
        p.teamPick = team === 1 || team === 2 ? team : 0;
        p.team = 0;                                   // re-plan at the next match start
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    // Quick emotes (rate-limited)
    socket.on('emote', ({ roomId, e }) => {
        const room = rooms[roomId];
        const p = room && room.players[socket.id];
        const idx = parseInt(e);
        if (!p || !(idx >= 0 && idx < EMOTE_COUNT)) return;
        const t = Date.now();
        if (t - (p._emoteAt || 0) < 1200) return;
        p._emoteAt = t;
        io.to(room.id).emit('emote', { id: p.id, e: idx });
    });

    socket.on('leaveRoom', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || !room.players[socket.id]) return;
        socket.leave(room.id);
        removePlayer(room, socket.id);
    });

    // Came back after the page was closed / phone slept: reclaim your seat
    socket.on('resume', ({ roomId, token }, cb) => {
        if (typeof cb !== 'function') return;
        const room = rooms[typeof roomId === 'string' ? roomId.toUpperCase() : ''];
        const tok = sanitizeToken(token);
        const p = room && tok && Object.values(room.players).find(q => !q.isBot && q.token === tok);
        if (!p) return cb({ error: 'That room has closed' });
        if (p.id !== socket.id) {
            const old = io.sockets.sockets.get(p.id);
            if (old) old.leave(room.id);        // a stale tab of the same browser
            rekeyPlayer(room, p.id, socket.id);
        }
        p.connected = true;
        p.disconnectedAt = 0;
        if (!room.players[room.hostId] || room.players[room.hostId].connected === false) room.hostId = socket.id;
        socket.join(room.id);
        cb({ roomId: room.id, player: p, room: roomSummary(room) });
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('startMatch', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.running) return;
        // Only host can start, and a match needs at least two cars
        if (room.hostId !== socket.id) return;
        const humanCount = Object.values(room.players).filter(p => !p.isBot).length;
        if (humanCount + room.settings.botCount < 2) {
            socket.emit('notice', { text: 'You need at least 2 players — invite a friend or add bots.' });
            return;
        }
        if (room.settings.mode === 'teams') {
            const humansNow = Object.values(room.players).filter(p => !p.isBot);
            const plan = PHYS.planTeams(humansNow.map(p => p.teamPick || 0), Math.min(room.settings.botCount, MAX_PLAYERS_PER_ROOM - humanCount));
            if (!plan.red || !plan.blue) {
                socket.emit('notice', { text: 'Both teams need at least one car — add a bot or have someone switch team.' });
                return;
            }
        }

        // Add bots
        const existingBots = Object.values(room.players).filter(p => p.isBot);
        existingBots.forEach(b => delete room.players[b.id]);

        const usedNames = new Set(Object.values(room.players).map(p => p.name));
        const availableNames = BOT_NAMES.filter(n => !usedNames.has(n));
        const botCarTypes = Object.keys(CAR_TYPES);
        const botSlots = Math.min(room.settings.botCount, MAX_PLAYERS_PER_ROOM - humanCount);
        for (let i = 0; i < botSlots; i++) {
            const botId = `bot_${uuidv4().slice(0, 6)}`;
            const botName = availableNames.length > 0
                ? availableNames.splice(Math.floor(Math.random() * availableNames.length), 1)[0]
                : `Bot_${i + 1}`;
            const botCar = botCarTypes[Math.floor(Math.random() * botCarTypes.length)];
            const training = room.settings.training;
            addPlayer(room, makePlayer(botId, training ? 'Practice Bot' : botName, true, room.settings.botDifficulty, training ? 'kart' : botCar, randomBotLook()));
        }

        if (room.round >= room.maxRounds) { room.round = 0; room.scores = {}; }
        room.round++;
        beginRound(room);
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('playAgain', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.running) return;
        // Reset for new match series
        room.round = 0;
        room.scores = {};
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    // Clock sync for client prediction: reply with server time
    socket.on('tp', (cb) => {
        if (typeof cb !== 'function') return;
        // (with simulated lag: request travels, server stamps, reply travels)
        if (SIM_LAG_MS) setTimeout(() => { const t = Date.now(); setTimeout(() => cb(t), SIM_LAG_MS / 2); }, SIM_LAG_MS / 2);
        else cb(Date.now());
    });

    socket.on('input', (msg) => {
        if (SIM_LAG_MS) setTimeout(() => applyInput(msg), SIM_LAG_MS / 2); else applyInput(msg);
    });
    const applyInput = ({ roomId, input, seq } = {}) => {
        const room = rooms[roomId];
        if (!room) return;
        const p = room.players[socket.id];
        if (!p || p.isBot) return;
        // Validate input
        p.inputs = {
            forward: Math.max(-1, Math.min(1, Number(input?.forward) || 0)),
            steer: Math.max(-1, Math.min(1, Number(input?.steer) || 0)),
            dash: !!input?.dash,
            shoot: !!input?.shoot,
            drop: !!input?.drop
        };
        // A quick tap can be released before the next tick — remember it until it's used
        // (only when it's ready — a press during the recharge shouldn't fire later by itself)
        if (p.inputs.dash && p.dashCooldown <= 0) p.tapDash = true;
        if (p.inputs.shoot && p.shootCooldown <= 0) p.tapShoot = true;
        if (p.inputs.drop) p.tapDrop = true;
        p.lastProcessedInput = seq || (p.lastProcessedInput + 1);
    };

    socket.on('disconnect', () => {
        console.log(`[disconnect] ${socket.id}`);
        // Don't drop the seat straight away — phones disconnect whenever the app
        // goes to the background. The player can 'resume' within the grace period.
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const p = room.players[socket.id];
            if (!p) continue;
            p.connected = false;
            p.disconnectedAt = Date.now();
            p.inputs = { forward: 0, steer: 0, dash: false, shoot: false, drop: false };
            if (room.hostId === socket.id && connectedHumans(room).length) room.hostId = connectedHumans(room)[0].id;
            io.to(roomId).emit('roomUpdate', roomSummary(room));
        }
    });
});

// ─── Rules on top of the shared car physics (shared/physics.mjs) ──────────
const FENCE_BREAK_SPEED = 270;      // fence gives way at this speed — only when someone is pushing you
const FENCE_LOCK_MS = 8000;         // fence can't be broken for the first 8 s of a round
const HIT_WINDOW_MS = 2000;         // how long after a shove you still count as "being pushed"
const SHRINK_START = 25;            // s — arena starts closing in
const SHRINK_END = 75;              // s — fully shrunk; fence turns electric (sudden death)
const FINAL_END = 120;              // s — slow final squeeze
const OVERTIME_END = 150;            // s — overtime: ring closes right in, so a round always ends
const SHRINK_FRAC = 0.5;
const FINAL_FRAC = 0.3;
const OVERTIME_FRAC = 0.1;
const ZAP_DPS = 20;                 // electric fence burns cars resting against it
const SNAPSHOT_EVERY = 3;           // ticks → 20 snapshots a second (clients predict / smooth between)

// Team Battle: same team = no damage, no knock-out credit, rockets pass through
const mates = (a, b) => !!(a && b && a.team && a.team === b.team);

function markHit(victim, attacker, now) {
    victim.lastHitAt = now;
    victim.lastHitBy = attacker.id;
}

const EMOTE_COUNT = 6;                 // GG 😂 😡 🔥 👋 😱 (list lives in the client)
function botEmote(room, bot, idx, chance) {
    if (!bot || !bot.isBot || Math.random() > chance) return;
    setTimeout(() => { if (rooms[room.id]) io.to(room.id).emit('emote', { id: bot.id, e: idx }); }, 350 + Math.random() * 500);
}

function eliminate(p, room, now, reason) {
    p.alive = false;
    p.av = 0;
    room.eliminationOrder.push({ id: p.id, name: p.name });
    const killer = now - (p.lastHitAt || 0) < HIT_WINDOW_MS ? room.players[p.lastHitBy] : null;
    if (killer && killer.id !== p.id) {
        killer.kills++; killer.roundKills = (killer.roundKills || 0) + 1;
        botEmote(room, killer, Math.random() < 0.5 ? 1 : 0, 0.35);     // 😂 / GG
    }
    botEmote(room, p, Math.random() < 0.6 ? 2 : 5, killer && !killer.isBot ? 0.3 : 0.1);   // 😡 / 😱
    io.to(room.id).emit('playerEliminated', {
        id: p.id, name: p.name, x: p.x, y: p.y, reason,
        by: killer ? killer.name : null, byId: killer ? killer.id : null,
    });

    // Solo vs bots: your place is final the moment you're out, so pay out now and
    // let the player choose — keep watching the bots, or head back to the lobby.
    // (Team Battle waits for the end of the round: your team can still win it.)
    const all = Object.values(room.players);
    const humans = all.filter(q => !q.isBot);
    if (!p.isBot && humans.length === 1 && all.length > 1 && room.mode !== 'teams') {
        const rank = all.filter(q => q.alive).length + 1;
        sendRoundResult(room, p, rank, all.length);
        p.paidRound = room.round;
        io.to(p.id).emit('soloOut', { rank, total: all.length, by: killer ? killer.name : null, byId: killer ? killer.id : null, reason });
    }
}

// Each human gets their own result for the round — the client turns it into
// coins, XP and challenge progress (progress is saved on the player's device).
function sendRoundResult(room, p, rank, total, teamWon) {
    if (p.isBot || p.connected === false) return;
    const humans = Object.values(room.players).filter(q => !q.isBot).length;
    io.to(p.id).emit('roundResult', {
        rank, total, won: teamWon !== undefined ? teamWon : rank === 1, mode: room.mode,
        kills: p.roundKills || 0, powerups: p.roundPowerups || 0,
        damage: Math.round(p.roundDamage || 0),
        survival: Math.round((p.survivalTime || 0) / 1000),
        carType: p.carType, online: humans > 1,
        difficulty: room.settings.botDifficulty, bots: Object.values(room.players).filter(q => q.isBot).length,
        round: room.round, maxRounds: room.maxRounds,
    });
}

// Keep only the strongest hit per pair of cars (or car + fence) each tick, so
// clients can shake the camera only for the cars that were actually involved.
function addFx(fx, key, ev) {
    const cur = fx.get(key);
    if (!cur || ev.impact > cur.impact) fx.set(key, ev);
}

// ─── Health, rockets, blades ──────────────────────────────────────────────
const ROCKET_SPEED = 640;           // px/s — slow enough to see and to steer onto a target
const ROCKET_LIFE_MS = 2000;
const ROCKET_TURN = 2.4;            // rad/s homing toward the locked target
const ROCKET_COOLDOWN = 1.4;
const BLAST_RADIUS = 120;
const ROCKET_DIRECT_DMG = 10;       // per rocket — a twin volley does 20
const ROCKET_SPLASH_DMG = 6;
const BLADE_DMG = 10;              // saws are a real weapon, not a toy
const BLADE_HIT_EVERY_MS = 350;

function damage(room, p, amount, attacker, now) {
    if (!p.alive || amount <= 0) return;
    if (p.shield) amount *= 0.25;                     // shield soaks most of it
    // Nobody can be wrecked while the fence is still locked at the start
    const floor = now < room.matchStartTime + FENCE_LOCK_MS ? 1 : 0;
    p.hp = Math.max(Math.min(floor, p.hp), p.hp - amount);
    if (attacker && attacker !== p) { markHit(p, attacker, now); attacker.damageDealt += amount; attacker.roundDamage = (attacker.roundDamage || 0) + amount; }
    if (p.hp <= 0) {
        p.vx *= 0.2; p.vy *= 0.2;
        eliminate(p, room, now, 'wrecked');
        io.to(room.id).emit('explosion', { x: p.x, y: p.y, big: 1, ids: [p.id] });
    }
}

function explode(room, x, y, owner, direct, now) {
    const hit = [];
    for (const p of Object.values(room.players)) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        const isDirect = p === direct;
        if (!isDirect && (d > BLAST_RADIUS || (owner && p.id === owner.id) || mates(p, owner))) continue;
        const fall = isDirect ? 1 : 1 - d / BLAST_RADIUS;
        const push = (isDirect ? 430 : 330 * fall) / PHYS.carMass(p);
        const nx = d > 1 ? (p.x - x) / d : 1, ny = d > 1 ? (p.y - y) / d : 0;
        p.vx += nx * push; p.vy += ny * push;
        p.av += (Math.random() - 0.5) * 4 * fall;
        p.stun = Math.max(p.stun || 0, 0.15 + 0.25 * fall);
        hit.push(p.id);
        damage(room, p, isDirect ? ROCKET_DIRECT_DMG : ROCKET_SPLASH_DMG * fall, owner, now);
    }
    io.to(room.id).emit('explosion', { x, y, ids: hit });
}

// ─── Game modes ───────────────────────────────────────────────────────────
const BOMB_FIRST_MS = 4000;        // first bomb a few seconds after GO
const BOMB_GAP_MS = 2500;          // next bomb after a blast

function giveBomb(room, to, now, from = null) {
    const b = room.bomb;
    if (from) {
        if (from.speedTimer <= 0 && from.megaTimer <= 0) from.speedMult = 1;
        io.to(room.id).emit('bombPass', { from: from.id, to: to.id });
    }
    b.holder = to.id;
    b.passAt = now + 700;
    // the bomb carrier gets a little extra speed to chase people down
    to.speedMult = Math.max(to.speedMult, 1.15);
}

function updateMode(room, now) {
    const alive = Object.values(room.players).filter(p => p.alive);
    if (room.mode === 'koth') {
        // Alone in the zone: full speed. Crowded: whoever is nearest the middle scores at half speed.
        const inside = alive.filter(p => Math.hypot(p.x, p.y) < PHYS.HILL_RADIUS)
            .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
        room.hill.contested = inside.length > 1;
        room.hill.holder = inside.length ? inside[0].num : 0;
        if (inside.length) inside[0].hill = (inside[0].hill || 0) + DT * (inside.length > 1 ? 0.5 : 1);
    } else if (room.mode === 'bomb') {
        const b = room.bomb;
        const holder = b.holder && room.players[b.holder];
        if (holder && !holder.alive) b.holder = null;           // carrier went out some other way
        if (!b.holder) {
            if (!b.nextAt) b.nextAt = now + (b.count ? BOMB_GAP_MS : BOMB_FIRST_MS);
            if (now >= b.nextAt && alive.length > 1) {
                b.nextAt = 0;
                b.count++;
                b.fuseEnd = now + Math.max(9, 17 - alive.length) * 1000;
                giveBomb(room, alive[Math.floor(Math.random() * alive.length)], now);
            }
        } else if (now >= b.fuseEnd) {
            // BOOM: the carrier is out and everyone nearby is blasted away
            const h = room.players[b.holder];
            b.holder = null;
            if (h.speedTimer <= 0 && h.megaTimer <= 0) h.speedMult = 1;
            for (const p of alive) {
                if (p === h) continue;
                const d = Math.hypot(p.x - h.x, p.y - h.y);
                if (d > 230) continue;
                const f = 1 - d / 230, nx = (p.x - h.x) / (d || 1), ny = (p.y - h.y) / (d || 1);
                p.vx += nx * 520 * f / PHYS.carMass(p); p.vy += ny * 520 * f / PHYS.carMass(p);
                p.stun = Math.max(p.stun || 0, 0.4 * f);
                damage(room, p, 12 * f, null, now);
            }
            io.to(room.id).emit('explosion', { x: h.x, y: h.y, big: 1, ids: [h.id] });
            eliminate(h, room, now, 'bomb');
        }
    }
}

function updateArena(room, now) {
    const t = Math.max(0, (now - room.matchStartTime) / 1000);
    const R0 = room.settings.arenaRadius;
    let frac = 1;
    if (t >= FINAL_END) frac = FINAL_FRAC + (OVERTIME_FRAC - FINAL_FRAC) * Math.min(1, (t - FINAL_END) / (OVERTIME_END - FINAL_END));
    else if (t >= SHRINK_END) frac = SHRINK_FRAC + (FINAL_FRAC - SHRINK_FRAC) * Math.min(1, (t - SHRINK_END) / (FINAL_END - SHRINK_END));
    else if (t >= SHRINK_START) frac = 1 + (SHRINK_FRAC - 1) * (t - SHRINK_START) / (SHRINK_END - SHRINK_START);
    room.arenaR = R0 * frac;
    const spec = PHYS.ARENAS[room.arenaKey];
    if (spec && spec.bar) room.barAngle += spec.bar.speed * DT;
    room.env = PHYS.arenaEnv(room.arenaKey, room.arenaR, room.barAngle);
    const wasSD = room.suddenDeath;
    room.suddenDeath = t >= SHRINK_END;
    // Hiding against the electric fence isn't safe either — it slowly fries you
    if (room.suddenDeath) {
        for (const p of Object.values(room.players)) {
            if (!p.alive) continue;
            const reach = PHYS.CAR_HALF_WID * p.carStats.size * p.scale + 4;
            const env = PHYS.arenaEnv(room.arenaKey, room.arenaR);
            const out = env.shape === 'square' ? env.half - Math.max(Math.abs(p.x), Math.abs(p.y)) : room.arenaR - Math.hypot(p.x, p.y);
            if (out > reach) continue;
            const pushed = now - (p.lastHitAt || 0) < HIT_WINDOW_MS;
            damage(room, p, ZAP_DPS * DT, pushed ? room.players[p.lastHitBy] : null, now);
            if (!p._zapFx || now - p._zapFx > 400) {
                p._zapFx = now;
                const k = (Math.hypot(p.x, p.y) + out) / (Math.hypot(p.x, p.y) || 1);
                io.to(room.id).emit('collision', { impact: 150, x: p.x * k, y: p.y * k, type: 'wall', ids: [p.id] });
            }
        }
    }
    if (room.suddenDeath && !wasSD) io.to(room.id).emit('arenaEvent', { type: 'suddenDeath' });
    if (t >= SHRINK_START && !room._shrinkAnnounced) {
        room._shrinkAnnounced = true;
        io.to(room.id).emit('arenaEvent', { type: 'shrink' });
    }
    return t;
}

// ─── Air drops: a cargo plane crosses the arena and drops crates ─────────
const PU_TYPES = ['SpeedBoost', 'Shield', 'MegaPush', 'Oil', 'Reverse', 'Magnet', 'Repair', 'Blades', 'Bumper'];
const PU_WEIGHTS = [18, 14, 11, 11, 7, 9, 19, 13, 13];
const PLANE_SPEED = 560;            // px/s
const PLANE_EVERY_MS = 8000;
const PLANE_MARGIN = 750;           // start/end this far outside the fence
const DROP_FALL_MS = 1800;          // crate hangs under its parachute this long

function pickPowerupType() {
    let r = Math.random() * PU_WEIGHTS.reduce((a, b) => a + b, 0);
    for (let i = 0; i < PU_TYPES.length; i++) { r -= PU_WEIGHTS[i]; if (r <= 0) return PU_TYPES[i]; }
    return PU_TYPES[0];
}

function launchPlane(room, now) {
    const R = room.arenaR;
    const ang = Math.random() * Math.PI * 2;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const off = (Math.random() - 0.5) * R * 0.9;              // how far the flight path passes from centre
    const span = R + PLANE_MARGIN;
    const x0 = -dy * off - dx * span, y0 = dx * off - dy * span;
    // Drop 2-3 crates while over the arena (well inside the fence)
    const inner = R * 0.78;
    const half = Math.sqrt(Math.max(0, inner * inner - off * off));
    const n = Math.random() < 0.35 ? 3 : 2;
    const drops = [];
    for (let i = 0; i < n; i++) {
        const s = span + (half > 0 ? (Math.random() * 2 - 1) * half : 0);
        drops.push({ at: now + (s / PLANE_SPEED) * 1000, done: false });
    }
    room.planes.push({ id: ++room._uid, x0, y0, dx, dy, t0: now, until: now + (2 * span / PLANE_SPEED) * 1000, drops });
    io.to(room.id).emit('airdrop', { x0, y0, dx, dy });
}

function updatePlanes(room, now) {
    if (now - room._lastPlane >= PLANE_EVERY_MS) { launchPlane(room, now); room._lastPlane = now; }
    for (const pl of room.planes) {
        for (const d of pl.drops) {
            if (d.done || now < d.at) continue;
            d.done = true;
            if (room.powerups.length >= MAX_POWERUPS) continue;
            const dist = ((now - pl.t0) / 1000) * PLANE_SPEED;
            const px = pl.x0 + pl.dx * dist, py = pl.y0 + pl.dy * dist;
            if (room.env && room.env.pitR && Math.hypot(px, py) < room.env.pitR + 50) continue;
            room.powerups.push({
                id: ++room._uid, type: pickPowerupType(),
                x: pl.x0 + pl.dx * dist, y: pl.y0 + pl.dy * dist,
                landAt: now + DROP_FALL_MS,
            });
        }
    }
    room.planes = room.planes.filter(pl => now < pl.until);
}

// ─── Snapshots (compact: arrays of numbers, names sent separately) ────────
const WEAPON_CODE = { oil: 1, reverse: 2 };
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

function rosterOf(room) {
    return Object.values(room.players).map(p => [p.num, p.id, p.name, p.carType, p.isBot ? 1 : 0, p.cosmetics, p.team || 0]);
}

function sendSnapshot(room, now) {
    const t = Math.max(0, (now - room.matchStartTime) / 1000);
    const msg = {
        t: now,
        e: Math.max(0, Math.round(now - room.matchStartTime)),
        r: r1(room.arenaR || room.settings.arenaRadius),
        b: room.settings.arenaRadius,
        sd: room.suddenDeath ? 1 : 0,
        si: room.countdown > 0 ? SHRINK_START : r1(Math.max(0, SHRINK_START - t)),
        rd: room.round, mr: room.maxRounds,
        lv: room.countdown > 0 ? 0 : 1,
        ak: PHYS.ARENA_KEYS.indexOf(room.arenaKey),
        md: PHYS.MODE_KEYS.indexOf(room.mode || 'ffa'),
        hl: room.mode === 'koth' ? [room.hill.holder, room.hill.contested ? 1 : 0] : undefined,
        bm: room.mode === 'bomb' && room.bomb.holder && room.players[room.bomb.holder]
            ? [room.players[room.bomb.holder].num, r1(Math.max(0, room.bomb.fuseEnd - now) / 1000)] : undefined,
        ba: Math.round((room.barAngle || 0) * 1000) / 1000,
        fl: room.countdown > 0 ? FENCE_LOCK_MS / 1000 : r1(Math.max(0, FENCE_LOCK_MS - (now - room.matchStartTime)) / 1000),   // fence-lock seconds left          // cars can move (clients only predict while live)
        p: Object.values(room.players).map(p => [
            p.num, r1(p.x), r1(p.y), Math.round(p.angle * 1000) / 1000,
            Math.round(p.vx), Math.round(p.vy), r2(p.av),
            (p.alive ? 1 : 0) | (p.shield ? 2 : 0) | (p.nitro > 0 ? 4 : 0) | (p.skid ? 8 : 0) | (p.magnetTimer > 0 ? 16 : 0) | (p.bladeTimer > 0 ? 32 : 0) | (p.inputs.forward < -0.05 ? 64 : 0) | (p.bumperTimer > 0 ? 128 : 0),
            r2(p.dashCooldown), r1(p.shootCooldown), r2(p.nitro), r2(p.slip), r2(p.stun),
            Math.round(p.speedMult * 100), Math.round(p.scale * 100), WEAPON_CODE[p.weapon] || 0, p.kills, Math.ceil(p.hp), r1(Math.max(0, p.bladeTimer)), r1(p.bumperTimer || 0), r1(p.hill || 0),
        ]),
        u: room.powerups.map(pu => [pu.id, PU_TYPES.indexOf(pu.type), Math.round(pu.x), Math.round(pu.y), Math.max(0, Math.round(pu.landAt - now))]),
        j: room.projectiles.map(pr => [pr.id, Math.round(pr.x), Math.round(pr.y), Math.round(pr.vx), Math.round(pr.vy)]),
        h: room.hazards.map(hz => [hz.id, hz.type === 'oil' ? 0 : 1, Math.round(hz.x), Math.round(hz.y)]),
        pl: room.planes.map(pl => {
            const d = ((now - pl.t0) / 1000) * PLANE_SPEED;
            return [pl.id, Math.round(pl.x0 + pl.dx * d), Math.round(pl.y0 + pl.dy * d), r2(Math.atan2(pl.dy, pl.dx))];
        }),
    };
    // Names / cars / paint only when they change (and now and then for late joiners)
    if (room.rosterDirty || room._snapN % 40 === 0) { msg.ro = rosterOf(room); room.rosterDirty = false; }
    room._snapN++;
    emitLagged(room.id, 's', msg);
}

// Optional artificial latency for testing prediction locally (SIM_LAG_MS=150)
const SIM_LAG_MS = Number(process.env.SIM_LAG_MS) || 0;
function emitLagged(roomId, ev, msg) {
    if (SIM_LAG_MS) setTimeout(() => io.to(roomId).emit(ev, msg), SIM_LAG_MS / 2);
    else io.to(roomId).emit(ev, msg);
}

// ─── One simulation tick for a room ───────────────────────────────────────
function tickRoom(room, roomId, now) {
    room._tick = (room._tick || 0) + 1;

    // Countdown — cars sit on the grid, but clients still get the scene
    if (room.countdown > 0) {
        for (const p of Object.values(room.players)) p.tapDash = p.tapShoot = p.tapDrop = false;
        if (!room._cdlast || now - room._cdlast >= 1000) {
            room.countdown -= 1;
            room._cdlast = now;
            io.to(room.id).emit('countdown', { count: Math.max(0, room.countdown) });
        }
        if (room.countdown <= 0) {
            room.countdown = 0;
            room.matchStartTime = now;
            room._lastPlane = now - PLANE_EVERY_MS + 600;   // first plane right after GO
        } else {
            room.arenaR = room.settings.arenaRadius;
            if (room._tick % (SNAPSHOT_EVERY * 2) === 0) sendSnapshot(room, now);
            return;
        }
    }

    updateArena(room, now);
    updatePlanes(room, now);
    updateMode(room, now);

    // ─── Update AI bots ────────────────────────────────────────────────
    for (const id in room.players) {
        const p = room.players[id];
        if (p.isBot && p.alive) updateBotAI(p, room, now);
    }

    // ─── Controls, weapons, powerups per player ────────────────────────
    for (const id in room.players) {
        const p = room.players[id];
        if (!p.alive) {
            // Wrecks keep sliding out through the broken fence
            p.x += p.vx * DT; p.y += p.vy * DT;
            p.vx *= 0.95; p.vy *= 0.95;
            continue;
        }
        p.survivalTime = now - room.matchStartTime;

        const inp = p.isBot ? p.inputs : {
            ...p.inputs,
            dash: p.inputs.dash || !!p.tapDash, shoot: p.inputs.shoot || !!p.tapShoot, drop: p.inputs.drop || !!p.tapDrop,
        };
        p.tapDash = p.tapShoot = p.tapDrop = false;
        tickTimers(p);
        if (PHYS.driveCar(p, inp, room.env)) p.dashesUsed++;

        // Drop a held trap weapon (Oil / Reverse) behind the car
        if (inp.drop && p.weapon && p.dropCooldown <= 0) {
            const bx = p.x - Math.cos(p.angle) * 56;
            const by = p.y - Math.sin(p.angle) * 56;
            const isOil = p.weapon === 'oil';
            room.hazards.push({
                id: ++room._uid,
                type: p.weapon,
                x: bx, y: by,
                ownerId: p.id,
                arm: now + 400,
                expires: now + (isOil ? 8000 : 10000),
                radius: isOil ? 46 : 34,
            });
            if (room.hazards.length > 40) room.hazards.shift();
            p.weapon = null;
            p.dropCooldown = 0.4;
        }

        // Shoot
        if (inp.shoot && p.shootCooldown <= 0 && room.projectiles.length < MAX_PROJECTILES - 1) {
            // Twin launchers: two rockets aimed at the rival in front of you
            // (leading a moving target), which then home in gently
            const target = PHYS.pickRocketTarget(p, Object.values(room.players));
            const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
            const fwdSpeed = Math.max(0, p.vx * fx + p.vy * fy);
            const speed = ROCKET_SPEED + fwdSpeed * 0.5;
            for (const side of [-1, 1]) {
                const ox = p.x + fx * 46 - fy * 16 * side, oy = p.y + fy * 46 + fx * 16 * side;
                let ang = p.angle;
                if (target) {
                    const t = Math.hypot(target.x - ox, target.y - oy) / speed;
                    ang = Math.atan2(target.y + target.vy * t * 0.8 - oy, target.x + target.vx * t * 0.8 - ox);
                }
                room.projectiles.push({
                    id: ++room._uid,
                    ownerId: p.id,
                    targetId: target ? target.id : null,
                    x: ox, y: oy,
                    vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
                    speed, created: now,
                });
            }
            p.shootCooldown = ROCKET_COOLDOWN;
            p.shotsFired++;
            io.to(room.id).emit('rocketFired', { id: p.id });
        }

        // Magnet: pull nearby (landed) powerups
        if (p.magnetTimer > 0) {
            for (const pu of room.powerups) {
                if (pu.landAt > now) continue;
                const dx = p.x - pu.x, dy = p.y - pu.y;
                const dist = Math.hypot(dx, dy);
                if (dist < 300 && dist > 5) {
                    pu.x += (dx / dist) * 200 * DT;
                    pu.y += (dy / dist) * 200 * DT;
                }
            }
        }

        p.shootCooldown = Math.max(0, p.shootCooldown - DT);
        p.dropCooldown = Math.max(0, p.dropCooldown - DT);
    }

    // ─── Move cars + resolve contacts (shared physics) ─────────────────
    const fx = new Map();
    PHYS.stepCars(Object.values(room.players).filter(p => p.alive), room.env, {
        onBar: (B, c) => {
            const p = B.p;
            if (c.vn > 120) addFx(fx, 'bar' + p.id, { impact: c.vn, x: c.x, y: c.y, type: 'wall', ids: [p.id] });
            if (c.vn > 200) damage(room, p, (c.vn - 200) * 0.02, null, now);
        },
        onPair: (A, B, r) => {
            const a = A.p, b = B.p;
            // Hot Bomb: touching passes it on (with a short no-pass-back window)
            const bomb = room.bomb;
            if (room.mode === 'bomb' && bomb.holder && now >= bomb.passAt && (bomb.holder === a.id || bomb.holder === b.id)) {
                const from = bomb.holder === a.id ? a : b, to = from === a ? b : a;
                giveBomb(room, to, now, from);
            }
            if (mates(a, b)) {
                if (r.impact > 90) addFx(fx, a.id < b.id ? a.id + b.id : b.id + a.id, { impact: r.impact, x: r.cx, y: r.cy, type: 'car', ids: [a.id, b.id] });
                return;
            }
            if (r.aPushesB) markHit(b, a, now);
            if (r.bPushesA) markHit(a, b, now);
            if (r.impact > 60) { a.damageDealt += r.impact * 0.5; b.damageDealt += r.impact * 0.5; }
            if (r.impact > 90) addFx(fx, a.id < b.id ? a.id + b.id : b.id + a.id, { impact: r.impact, x: r.cx, y: r.cy, type: 'car', ids: [a.id, b.id] });
            // Crash damage: harder hits hurt more, heavy cars hurt light ones,
            // and whoever did the ramming takes less
            if (r.impact > 160) {
                const base = Math.min(16, (r.impact - 160) * 0.022);
                const mA = PHYS.carMass(a), mB = PHYS.carMass(b);
                let dA = base * Math.min(1.3, Math.sqrt(mB / mA)), dB = base * Math.min(1.3, Math.sqrt(mA / mB));
                if (r.aPushesB && !r.bPushesA) dA *= 0.4;
                else if (r.bPushesA && !r.aPushesB) dB *= 0.4;
                damage(room, b, dB, r.aPushesB ? a : null, now);
                damage(room, a, dA, r.bPushesA ? b : null, now);
            }
        },
        onFence: (B, c) => {
            const p = B.p;
            // Sinkhole rim: solid while the fence is locked, otherwise you can slide in
            if (c.pit) return now < room.matchStartTime + FENCE_LOCK_MS;
            // The fence holds unless you're shoved into it — or it's electric (sudden death)
            // For the first seconds of a round the fence is locked: nobody goes out at the start,
            // and a car already pinned there when it unlocks needs a fresh shove to go through.
            // Stable cars need a harder shove to break through.
            const unlockAt = room.matchStartTime + FENCE_LOCK_MS;
            const locked = now < unlockAt;
            const pushed = now - (p.lastHitAt || 0) < HIT_WINDOW_MS && p.lastHitAt > unlockAt;
            const lethal = !locked && ((room.suddenDeath && c.vn > 80) || (c.vn > FENCE_BREAK_SPEED * (p.carStats.stability || 1) && pushed));
            if (lethal) {
                if (p.shield) { p.shield = false; p.shieldTimer = 0; }    // shield absorbs it once
                else { eliminate(p, room, now, room.suddenDeath ? 'electric' : 'fence'); return false; }
            }
            if (c.vn > 140) addFx(fx, 'wall' + p.id, { impact: c.vn, x: c.x, y: c.y, type: 'wall', ids: [p.id] });
            if (c.vn > 260) {                       // slamming the barrier dents you too
                damage(room, p, (c.vn - 260) * 0.015, pushed ? room.players[p.lastHitBy] : null, now);
                if (!p.alive) return false;
            }
            return true;
        },
    });
    for (const ev of fx.values()) io.to(room.id).emit('collision', ev);
    if (room.env.pitR) {
        for (const p of Object.values(room.players)) {
            if (p.alive && Math.hypot(p.x, p.y) < room.env.pitR) eliminate(p, room, now, 'pit');
        }
    }
    if (!room.running) return;   // solo match ended this tick

    // Powerup pickup (only once the crate has landed)
    for (const id in room.players) {
        const p = room.players[id];
        if (!p.alive) continue;
        for (let i = room.powerups.length - 1; i >= 0; i--) {
            const pu = room.powerups[i];
            if (pu.landAt > now) continue;
            if (Math.hypot(p.x - pu.x, p.y - pu.y) < 40 * p.scale * p.carStats.size) {
                applyPowerup(pu.type, p, room);
                room.powerups.splice(i, 1);
                io.to(room.id).emit('powerupCollected', { playerId: p.id, puId: pu.id, type: pu.type });
            }
        }
    }
    // Powerups caught outside the shrinking fence are lost
    room.powerups = room.powerups.filter(pu => Math.hypot(pu.x, pu.y) < room.arenaR - 30);

    // ─── Projectile physics ────────────────────────────────────────────
    for (let i = room.projectiles.length - 1; i >= 0; i--) {
        const proj = room.projectiles[i];
        // Gentle homing toward the locked target (gives up if it gets behind the rocket)
        const tgt = proj.targetId && room.players[proj.targetId];
        if (tgt && tgt.alive) {
            const cur = Math.atan2(proj.vy, proj.vx);
            let da = Math.atan2(tgt.y - proj.y, tgt.x - proj.x) - cur;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            if (Math.abs(da) < 1.75) {
                const turn = Math.max(-ROCKET_TURN * DT, Math.min(ROCKET_TURN * DT, da));
                proj.vx = Math.cos(cur + turn) * proj.speed;
                proj.vy = Math.sin(cur + turn) * proj.speed;
            } else proj.targetId = null;
        }
        proj.x += proj.vx * DT;
        proj.y += proj.vy * DT;

        // Rockets blow up on the fence or when their fuel runs out
        if (Math.hypot(proj.x, proj.y) > room.arenaR || now - proj.created > ROCKET_LIFE_MS) {
            room.projectiles.splice(i, 1);
            explode(room, proj.x, proj.y, room.players[proj.ownerId], null, now);
            continue;
        }

        for (const id in room.players) {
            const p = room.players[id];
            if (!p.alive || p.id === proj.ownerId || mates(p, room.players[proj.ownerId])) continue;
            if (Math.hypot(p.x - proj.x, p.y - proj.y) < 36 * p.scale * p.carStats.size) {
                room.projectiles.splice(i, 1);
                explode(room, proj.x, proj.y, room.players[proj.ownerId], p, now);
                break;
            }
        }
    }
    if (!room.running) return;

    // ─── Balloons: bounce away anyone who runs into them (no damage) ───
    {
        const alive = Object.values(room.players).filter(p => p.alive);
        for (const a of alive) {
            if (!(a.bumperTimer > 0)) continue;
            const ring = PHYS.CAR_HALF_LEN * a.carStats.size * a.scale + 30;
            for (const b of alive) {
                if (b === a || !b.alive || mates(a, b)) continue;
                const d = Math.hypot(b.x - a.x, b.y - a.y);
                const reach = ring + PHYS.CAR_HALF_WID * b.carStats.size * b.scale;
                if (d > reach || d < 1) continue;
                const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
                // Every tick a car is inside the balloons it's pushed back out, relative to the
                // balloon car, so nothing gets through to its body — not even a nitro ram
                const away = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                const kick = Math.max(0, 470 - away);              // leave at ≥ 470 px/s
                b.vx += nx * kick; b.vy += ny * kick;
                b.x += nx * (reach - d); b.y += ny * (reach - d);  // out of the balloons
                b.stun = Math.max(b.stun || 0, 0.35);
                markHit(b, a, now);
                if (now - (a.bumperHits[b.id] || 0) < 300) continue;   // sound + confetti at most every 0.3 s
                a.bumperHits[b.id] = now;
                io.to(room.id).emit('collision', { impact: 300, x: a.x + nx * ring, y: a.y + ny * ring, type: 'balloon', ids: [b.id, a.id] });
            }
        }
    }

    // ─── Spinning blades: shred anyone who touches the sides ───────────
    {
        const alive = Object.values(room.players).filter(p => p.alive);
        for (const a of alive) {
            if (a.bladeTimer <= 0) continue;
            const reachA = PHYS.CAR_HALF_LEN * a.carStats.size * a.scale + 24;
            for (const b of alive) {
                if (b === a || !b.alive || mates(a, b)) continue;
                const d = Math.hypot(b.x - a.x, b.y - a.y);
                const reachB = PHYS.CAR_HALF_WID * b.carStats.size * b.scale + 12;
                if (d > reachA + reachB || d < 1) continue;
                if (now - (a.bladeHits[b.id] || 0) < BLADE_HIT_EVERY_MS) continue;
                a.bladeHits[b.id] = now;
                const push = 240 / PHYS.carMass(b);
                b.vx += (b.x - a.x) / d * push; b.vy += (b.y - a.y) / d * push;
                b.stun = Math.max(b.stun || 0, 0.3);
                io.to(room.id).emit('collision', { impact: 320, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, type: 'blade', ids: [b.id, a.id] });
                damage(room, b, BLADE_DMG, a, now);
            }
        }
    }
    if (!room.running) return;

    // ─── Trap hazards (dropped Oil / Reverse) ──────────────────────────
    if (room.hazards && room.hazards.length) {
        const alive = Object.values(room.players).filter(p => p.alive);
        const live = [];
        for (const hz of room.hazards) {
            if (now > hz.expires) continue;
            let consumed = false;
            for (const p of alive) {
                if (now < hz.arm && p.id === hz.ownerId) continue;
                const rr = hz.radius + 25 * p.scale * p.carStats.size;
                if (Math.hypot(p.x - hz.x, p.y - hz.y) < rr) {
                    if (hz.type === 'oil') {
                        p.slip = Math.max(p.slip, 2.5);
                    } else { // reverse
                        p.angle += Math.PI;
                        p.av = 0;
                        p.vx *= -0.5; p.vy *= -0.5;
                        io.to(room.id).emit('collision', { impact: 60, x: hz.x, y: hz.y, type: 'reverse', ids: [p.id] });
                        consumed = true;
                        break;
                    }
                }
            }
            if (!consumed) live.push(hz);
        }
        room.hazards = live;
    }

    if (room._tick % SNAPSHOT_EVERY === 0) sendSnapshot(room, now);

    // ─── Win condition ─────────────────────────────────────────────────
    const everyone = Object.values(room.players);
    const aliveNow = everyone.filter(p => p.alive);
    const aliveCount = aliveNow.length;
    const totalPlayers = everyone.length;
    const teamsLeft = new Set(aliveNow.map(p => p.team));
    const king = room.mode === 'koth' ? aliveNow.find(p => p.hill >= PHYS.HILL_TARGET) : null;
    const teamOver = room.mode === 'teams' && totalPlayers > 1 && teamsLeft.size <= 1;

    if (teamOver || king || (totalPlayers > 1 && aliveCount <= 1) || (totalPlayers === 1 && aliveCount === 0)) {
        sendSnapshot(room, now);     // make sure everyone sees the final state
        room.running = false;
        // Last car standing — or, if the final cars went out together, the last one out
        let winner = king || aliveNow[0]
            || (room.eliminationOrder.length ? room.players[room.eliminationOrder[room.eliminationOrder.length - 1].id] : null);
        // Finishing order: best first
        const outIdx = new Map(room.eliminationOrder.map((e, i) => [e.id, i]));
        const order = everyone.slice().sort((a, b) => {
            if (a === winner) return -1;
            if (b === winner) return 1;
            if (room.mode === 'teams' && winner && (a.team === winner.team) !== (b.team === winner.team)) return a.team === winner.team ? -1 : 1;
            if (a.alive !== b.alive) return a.alive ? -1 : 1;
            if (room.mode === 'koth' && Math.abs((b.hill || 0) - (a.hill || 0)) > 0.05) return (b.hill || 0) - (a.hill || 0);
            return (outIdx.get(b.id) ?? -1) - (outIdx.get(a.id) ?? -1);
        });
        const winTeam = room.mode === 'teams' && winner ? winner.team : 0;
        // Score: 1st=10, 2nd=6, 3rd=4, 4th=3, 5th=2, rest=1 (Team Battle: every winner gets 8)
        const scoreTable = [10, 6, 4, 3, 2, 1, 1, 1];
        const rankings = order.map((p, i) => ({ id: p.id, name: p.name, rank: i + 1, team: p.team || 0,
            score: winTeam ? (p.team === winTeam ? 8 : 2) : (scoreTable[i] || 1), hill: room.mode === 'koth' ? Math.floor(p.hill || 0) : undefined }));
        rankings.forEach(r => { room.scores[r.id] = (room.scores[r.id] || 0) + r.score; });
        if (winTeam) winner = { id: winner.id, name: winTeam === 1 ? 'RED TEAM' : 'BLUE TEAM' };

        const matchOver = room.round >= room.maxRounds;

        io.to(room.id).emit('matchEnd', {
            winnerId: winner?.id || null,
            winnerName: winner?.name || null,
            winTeam, mode: room.mode,
            rankings,
            scores: room.scores,
            round: room.round,
            maxRounds: room.maxRounds,
            matchOver,
            // Player stats
            stats: Object.values(room.players).map(p => ({
                id: p.id, name: p.name, isBot: p.isBot,
                kills: p.kills, damageDealt: Math.round(p.damageDealt),
                powerupsCollected: p.powerupsCollected,
                shotsFired: p.shotsFired, dashesUsed: p.dashesUsed,
                survivalTime: Math.round(p.survivalTime / 1000)
            }))
        });
        rankings.forEach(r => {
            const p = room.players[r.id];
            if (p && p.paidRound !== room.round) sendRoundResult(room, p, r.rank, rankings.length, winTeam ? p.team === winTeam : undefined);
        });
        if (matchOver) io.to(room.id).emit('roomUpdate', roomSummary(room));

        // Auto-start next round after delay
        if (!matchOver) {
            setTimeout(() => {
                const r = rooms[roomId];
                if (!r || r.running) return;
                r.round++;
                beginRound(r);
            }, 8000 / SIM_SPEED);   // time for the replay + results
        }
    }
}

// ─── Game loop: fixed 60 Hz steps driven by the real clock ───────────────
// (setInterval alone drifts to ~49 Hz on some hosts, which made the whole
// game run slow — and client prediction needs the server at exactly 60 Hz)
let simTime = clock();
setInterval(() => {
    if (!PHYS) return;
    const real = clock();
    if (real - simTime > 250 * SIM_SPEED) simTime = real - 250 * SIM_SPEED;   // after a stall, don't fast-forward forever
    while (real - simTime >= 1000 / TICK_RATE) {
        simTime += 1000 / TICK_RATE;
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.running) tickRoom(room, roomId, simTime);
        }
    }
}, 4);

// ─── Room cleanup ──────────────────────────────────────────────────────────
setInterval(() => {
    const now = Date.now();
    for (const roomId in rooms) {
        const room = rooms[roomId];
        for (const p of Object.values(room.players)) {
            if (p.isBot || p.connected !== false) continue;
            if (now - p.disconnectedAt > (room.running ? MATCH_GRACE_MS : LOBBY_GRACE_MS)) removePlayer(room, p.id);
        }
        if (!rooms[roomId]) continue;
        const humans = Object.values(room.players).filter(p => !p.isBot);
        if (humans.length === 0 && now - room.createdAt > ROOM_CLEANUP_MS) {
            delete rooms[roomId];
            console.log(`[cleanup] Room ${roomId} removed (empty)`);
        }
    }
}, 15000);

// ─── Serve client ──────────────────────────────────────────────────────────
// Hashed build files never change → cache for a year; the page, manifest and
// service worker must always be re-checked so app updates reach players.
app.use(express.static(path.join(__dirname, '../client/dist'), {
    setHeaders: (res, file) => {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
        if (file.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
    },
}));
app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
import('../shared/physics.mjs').then((mod) => {
    PHYS = mod;
    CAR_TYPES = mod.CAR_TYPES;
    server.listen(PORT, () => console.log(`🏎️  Dash Arena server on :${PORT}`));
}).catch((err) => {
    console.error('Failed to load shared physics', err);
    process.exit(1);
});

// Render's free tier sleeps after ~15 min without inbound traffic. Pinging our own
// public URL counts as inbound traffic, so the server stays awake for players.
const KEEPALIVE_URL = process.env.RENDER_EXTERNAL_URL;
if (KEEPALIVE_URL) {
    const https = require('https');
    setInterval(() => {
        https.get(`${KEEPALIVE_URL}/api/health`, res => res.resume()).on('error', () => {});
    }, 10 * 60 * 1000);
}
