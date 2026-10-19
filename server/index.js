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
const ARENA_RADIUS = 1000;
const POWERUP_INTERVAL = 4000;
const MAX_POWERUPS = 12;
const DASH_COOLDOWN = 2.0;
const ROOM_CLEANUP_MS = 5 * 60 * 1000;   // clean empty rooms after 5 min
const MAX_ROOMS = 50;
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_PROJECTILES = 30;
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
    easy:   { reactionTime: 0.4, accuracy: 0.5, aggression: 0.3, dashSkill: 0.3, shootSkill: 0.2 },
    medium: { reactionTime: 0.25, accuracy: 0.7, aggression: 0.5, dashSkill: 0.6, shootSkill: 0.5 },
    hard:   { reactionTime: 0.12, accuracy: 0.9, aggression: 0.7, dashSkill: 0.85, shootSkill: 0.8 },
    insane: { reactionTime: 0.06, accuracy: 0.97, aggression: 0.9, dashSkill: 0.95, shootSkill: 0.95 }
};

// ─── Car types ────────────────────────────────────────────────────────────
const CAR_TYPES = {
    sports:   { name: 'Venom GT',      maxSpeed: 1.3,  accel: 1.2,  turn: 1.1,  mass: 0.8,  dashForce: 1.0,  size: 0.9,  desc: 'Fast and agile' },
    muscle:   { name: 'Thunder V8',    maxSpeed: 1.15, accel: 1.0,  turn: 0.85, mass: 1.3,  dashForce: 1.3,  size: 1.1,  desc: 'Heavy hitter' },
    truck:    { name: 'War Rig',       maxSpeed: 0.75, accel: 0.7,  turn: 0.65, mass: 2.0,  dashForce: 1.6,  size: 1.4,  desc: 'Unstoppable force' },
    rally:    { name: 'Dust Devil',    maxSpeed: 1.1,  accel: 1.1,  turn: 1.3,  mass: 0.9,  dashForce: 0.9,  size: 0.95, desc: 'Best handling' },
    kart:     { name: 'Pocket Rocket', maxSpeed: 1.4,  accel: 1.4,  turn: 1.2,  mass: 0.5,  dashForce: 0.7,  size: 0.7,  desc: 'Tiny but fast' },
    suv:      { name: 'Iron Shield',   maxSpeed: 0.9,  accel: 0.85, turn: 0.9,  mass: 1.5,  dashForce: 1.2,  size: 1.2,  desc: 'Tank with style' },
    drift:    { name: 'Sidewinder',    maxSpeed: 1.05, accel: 1.0,  turn: 1.5,  mass: 0.85, dashForce: 0.85, size: 0.95, desc: 'Drift king' },
    supercar: { name: 'Phantom X',     maxSpeed: 1.5,  accel: 1.3,  turn: 0.95, mass: 0.7,  dashForce: 0.8,  size: 0.85, desc: 'Pure speed' },
};

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
        wheel: pick(c.wheel) || 'stock',
        topper: pick(c.topper) || 'none',
        trail: pick(c.trail) || 'classic',
    };
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
        name: name || `Player_${id.slice(0, 4)}`,
        carType: validCar,
        carStats: CAR_TYPES[validCar],
        cosmetics: sanitizeCosmetics(cosmetics),
        x: 0, y: 0,
        angle: 0,
        vx: 0, vy: 0,
        av: 0,               // angular velocity (rad/s)
        alive: true,
        dashCooldown: 0,
        dashTimer: 0,
        shootCooldown: 0,
        lastHitAt: 0,
        lastHitBy: null,
        skid: false,
        speedMult: 1,
        shield: false,
        shieldTimer: 0,
        megaTimer: 0,
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
        _cdlast: 0,
        _lastPU: 0,
        createdAt: Date.now(),
        settings: {
            botCount: 3,
            botDifficulty: 'medium',
            arenaRadius: ARENA_RADIUS,
            powerupInterval: POWERUP_INTERVAL
        }
    };
    return rooms[roomId];
}

function spawnPowerup(room) {
    if (room.powerups.length >= MAX_POWERUPS) return;
    const types = ['SpeedBoost', 'Shield', 'MegaPush', 'Oil', 'Reverse', 'Magnet'];
    const weights = [25, 20, 15, 15, 10, 15]; // weighted random
    const totalW = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalW;
    let type = types[0];
    for (let i = 0; i < types.length; i++) {
        r -= weights[i];
        if (r <= 0) { type = types[i]; break; }
    }
    const dist = Math.sqrt(Math.random()) * ((room.arenaR || room.settings.arenaRadius) * 0.75);
    const ang = Math.random() * Math.PI * 2;
    room.powerups.push({
        id: uuidv4().slice(0, 6),
        type,
        x: Math.cos(ang) * dist,
        y: Math.sin(ang) * dist,
        created: Date.now()
    });
}

function roomSummary(room) {
    return {
        id: room.id,
        hostId: room.hostId,
        players: Object.values(room.players).map(p => ({
            id: p.id, name: p.name, alive: p.alive, isBot: p.isBot,
            carType: p.carType, connected: p.connected !== false,
            kills: p.kills, powerupsCollected: p.powerupsCollected
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
        p.speedTimer = 0;
        p.slip = 0;
        p.scale = 1;
        p.isDashing = false;
        p.dashCooldown = 0;
        p.dashTimer = 0;
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
function updateBotAI(bot, room, now) {
    if (!bot.alive || !bot.isBot || !bot.botState) return;

    const bs = bot.botState;
    bs.thinkTimer -= DT;

    // Only recalculate decisions periodically (based on reaction time)
    if (bs.thinkTimer > 0) return;
    bs.thinkTimer = bs.reactionTime + Math.random() * 0.1;

    const players = Object.values(room.players).filter(p => p.alive && p.id !== bot.id);
    const powerups = room.powerups;
    const projectiles = room.projectiles;

    // State calculations
    const distFromCenter = Math.hypot(bot.x, bot.y);
    const arenaR = room.arenaR || room.settings.arenaRadius;
    const margin = room.suddenDeath ? 230 : 170;     // electric fence = keep well clear
    const dangerZone = arenaR - margin;
    const criticalZone = arenaR - margin * 0.45;
    const speed = Math.hypot(bot.vx, bot.vy);

    let forward = 0, steer = 0, dash = false, shoot = false;

    // ─── PRIORITY 1: Survive — flee from edge ─────────────────────────
    if (distFromCenter > dangerZone) {
        const toCenter = Math.atan2(-bot.y, -bot.x);
        let angleDiff = toCenter - bot.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        steer = Math.max(-1, Math.min(1, angleDiff * 3));
        forward = 1;
        // Nose against the fence: back away first (reverse steering is mirrored)
        if (Math.abs(angleDiff) > 1.9) { forward = -1; steer = -Math.sign(angleDiff); }

        // Emergency dash toward center if critical
        if (distFromCenter > criticalZone && bot.dashCooldown <= 0 && Math.abs(angleDiff) < 0.5) {
            dash = true;
        }

        bot.inputs = { forward, steer, dash, shoot };
        return;
    }

    // ─── PRIORITY 2: Dodge incoming projectiles ────────────────────────
    let dodging = false;
    for (const proj of projectiles) {
        if (proj.ownerId === bot.id) continue;
        const dx = proj.x - bot.x;
        const dy = proj.y - bot.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 300) continue;

        // Predict if projectile will hit us
        const projSpeed = Math.hypot(proj.vx, proj.vy);
        if (projSpeed < 100) continue;
        const timeToReach = dist / projSpeed;
        const futureX = proj.x + proj.vx * timeToReach;
        const futureY = proj.y + proj.vy * timeToReach;
        const futureDistToMe = Math.hypot(futureX - bot.x, futureY - bot.y);

        if (futureDistToMe < 80) {
            // Dodge perpendicular to projectile path
            const projAngle = Math.atan2(proj.vy, proj.vx);
            const dodgeAngle = projAngle + (bs.dodgeDir > 0 ? Math.PI / 2 : -Math.PI / 2);
            let angleDiff = dodgeAngle - bot.angle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            steer = Math.max(-1, Math.min(1, angleDiff * 3));
            forward = 1;
            if (dist < 150 && bot.dashCooldown <= 0) dash = true;
            dodging = true;
            break;
        }
    }

    if (dodging) {
        bot.inputs = { forward, steer, dash, shoot };
        return;
    }

    // ─── PRIORITY 3: Personality-driven behavior ───────────────────────

    // Find nearest enemy and nearest powerup
    let nearestEnemy = null, nearestEnemyDist = Infinity;
    let weakestEnemy = null, weakestEdgeDist = Infinity;
    for (const p of players) {
        if (p.isBot && bs.personality === 'collector') continue; // collectors ignore other bots
        const d = Math.hypot(p.x - bot.x, p.y - bot.y);
        if (d < nearestEnemyDist) { nearestEnemy = p; nearestEnemyDist = d; }
        // Find enemies near edge (weak targets)
        const edgeDist = arenaR - Math.hypot(p.x, p.y);
        if (edgeDist < weakestEdgeDist) { weakestEnemy = p; weakestEdgeDist = edgeDist; }
    }

    let nearestPU = null, nearestPUDist = Infinity;
    for (const pu of powerups) {
        const d = Math.hypot(pu.x - bot.x, pu.y - bot.y);
        if (d < nearestPUDist) { nearestPU = pu; nearestPUDist = d; }
    }

    // Decide target
    let targetX, targetY, targetType = 'roam';

    switch (bs.personality) {
        case 'aggressive':
            // Ram the nearest enemy, prefer weak ones near edge
            if (weakestEdgeDist < 200 && weakestEnemy) {
                targetX = weakestEnemy.x; targetY = weakestEnemy.y; targetType = 'ram';
            } else if (nearestEnemy && nearestEnemyDist < 500) {
                targetX = nearestEnemy.x; targetY = nearestEnemy.y; targetType = 'ram';
            } else if (nearestPU && nearestPUDist < 400) {
                targetX = nearestPU.x; targetY = nearestPU.y; targetType = 'powerup';
            } else {
                targetX = nearestEnemy ? nearestEnemy.x : 0;
                targetY = nearestEnemy ? nearestEnemy.y : 0;
                targetType = 'chase';
            }
            break;

        case 'hunter':
            // Prioritize shooting from medium range
            if (nearestEnemy) {
                const idealRange = 250;
                const dx = nearestEnemy.x - bot.x;
                const dy = nearestEnemy.y - bot.y;
                const dist = Math.hypot(dx, dy);
                if (dist < idealRange * 0.7) {
                    // Too close, back off slightly
                    targetX = bot.x - dx * 0.5;
                    targetY = bot.y - dy * 0.5;
                    targetType = 'kite';
                } else {
                    targetX = nearestEnemy.x; targetY = nearestEnemy.y; targetType = 'shoot';
                }
            } else {
                targetX = 0; targetY = 0; targetType = 'roam';
            }
            break;

        case 'collector':
            // Prioritize powerups
            if (nearestPU) {
                targetX = nearestPU.x; targetY = nearestPU.y; targetType = 'powerup';
            } else if (nearestEnemy && bot.scale > 1.2) {
                // Got MegaPush, go ram!
                targetX = nearestEnemy.x; targetY = nearestEnemy.y; targetType = 'ram';
            } else {
                // Roam center
                targetX = Math.cos(now / 3000) * 200;
                targetY = Math.sin(now / 3000) * 200;
                targetType = 'roam';
            }
            break;

        case 'defensive':
        default:
            // Stay near center, collect powerups, engage only when strong
            if (nearestPU && nearestPUDist < 300) {
                targetX = nearestPU.x; targetY = nearestPU.y; targetType = 'powerup';
            } else if (bot.shield || bot.scale > 1.2) {
                // We have an advantage — attack!
                if (nearestEnemy) {
                    targetX = nearestEnemy.x; targetY = nearestEnemy.y; targetType = 'ram';
                }
            } else {
                // Stay near center
                targetX = Math.cos(now / 4000 + bot.x) * 150;
                targetY = Math.sin(now / 4000 + bot.y) * 150;
                targetType = 'roam';
            }
            break;
    }

    if (targetX === undefined) { targetX = 0; targetY = 0; }

    // ─── Steering toward target ────────────────────────────────────────
    const toTarget = Math.atan2(targetY - bot.y, targetX - bot.x);
    let angleDiff = toTarget - bot.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Add inaccuracy
    angleDiff += (Math.random() - 0.5) * (1 - bs.accuracy) * 0.5;

    steer = Math.max(-1, Math.min(1, angleDiff * 2.5));
    forward = 1;

    // Slow down if very close to powerup (precision collection)
    if (targetType === 'powerup' && nearestPUDist < 50) forward = 0.5;

    // Reverse if stuck
    if (bs.stuckTimer > 0.5) { forward = -0.5; steer = 1; bs.stuckTimer = 0; }
    const moved = Math.hypot(bot.x - bs.lastX, bot.y - bs.lastY);
    if (moved < 1) bs.stuckTimer += DT; else bs.stuckTimer = 0;
    bs.lastX = bot.x; bs.lastY = bot.y;

    // ─── Dash decision ─────────────────────────────────────────────────
    if (bot.dashCooldown <= 0) {
        if (targetType === 'ram' && nearestEnemyDist < 200 && Math.abs(angleDiff) < 0.4) {
            if (Math.random() < bs.dashSkill) dash = true;
        }
        // Also dash if enemy is near edge and we're pointed at them
        if (weakestEnemy && weakestEdgeDist < 150 && nearestEnemyDist < 250 && Math.abs(angleDiff) < 0.5) {
            if (Math.random() < bs.dashSkill * 1.2) dash = true;
        }
    }

    // ─── Shoot decision ────────────────────────────────────────────────
    if (bot.shootCooldown <= 0 && nearestEnemy) {
        const shootAngle = Math.atan2(nearestEnemy.y - bot.y, nearestEnemy.x - bot.x);
        let shootDiff = shootAngle - bot.angle;
        while (shootDiff > Math.PI) shootDiff -= Math.PI * 2;
        while (shootDiff < -Math.PI) shootDiff += Math.PI * 2;

        if (Math.abs(shootDiff) < 0.3 && nearestEnemyDist < 500 && nearestEnemyDist > 80) {
            if (Math.random() < bs.shootSkill) shoot = true;
        }
    }

    // Flip dodge direction periodically
    if (Math.random() < 0.02) bs.dodgeDir = -bs.dodgeDir || 1;

    bot.inputs = { forward, steer, dash, shoot, drop: !!bot.weapon && Math.random() < 0.03 };
}

// ─── Physics helpers ───────────────────────────────────────────────────────
function applyPowerup(type, player, room) {
    player.powerupsCollected++;
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
    room.matchStartTime = Date.now() + 3000;
    room.eliminationOrder = [];
    room.arenaR = room.settings.arenaRadius;
    room.suddenDeath = false;
    room._shrinkAnnounced = false;
    room._cdlast = 0;
    room._cdSnap = 0;
    room._lastPU = 0;
    resetPlayers(room);
    io.to(room.id).emit('matchStart', { count: room.countdown, round: room.round, maxRounds: room.maxRounds });
}

function tickTimers(p) {
    if (p.shieldTimer > 0) { p.shieldTimer -= DT; if (p.shieldTimer <= 0) p.shield = false; }
    if (p.megaTimer > 0) { p.megaTimer -= DT; if (p.megaTimer <= 0) { p.scale = 1; if (p.speedTimer <= 0) p.speedMult = 1; } }
    if (p.speedTimer > 0) { p.speedTimer -= DT; if (p.speedTimer <= 0 && p.megaTimer <= 0) p.speedMult = 1; }
    if (p.magnetTimer > 0) p.magnetTimer -= DT;
}

// ─── Seats: leaving, reclaiming, host hand-off ────────────────────────────
function connectedHumans(room) {
    return Object.values(room.players).filter(p => !p.isBot && p.connected !== false);
}

function removePlayer(room, id) {
    delete room.players[id];
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

    socket.on('createRoom', ({ name, botCount, botDifficulty, carType, cosmetics, token }, cb) => {
        if (typeof cb !== 'function') return;
        const room = createRoom(socket.id);
        if (!room) return cb({ error: 'Server full, try again later' });

        socket.join(room.id);
        room.players[socket.id] = makePlayer(socket.id, name, false, 'medium', carType, cosmetics, sanitizeToken(token));
        const requestedBots = parseInt(botCount);
        room.settings.botCount = Math.min(7, Math.max(0, Number.isNaN(requestedBots) ? 3 : requestedBots));
        room.settings.botDifficulty = BOT_DIFFICULTY[botDifficulty] ? botDifficulty : 'medium';

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
        room.players[socket.id] = makePlayer(socket.id, name, false, 'medium', carType, cosmetics, sanitizeToken(token));
        cb({ roomId: room.id, player: room.players[socket.id] });
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('updateSettings', ({ roomId, settings }) => {
        const room = rooms[roomId];
        if (!room || room.hostId !== socket.id || room.running) return;
        if (settings.botCount !== undefined) room.settings.botCount = Math.min(MAX_PLAYERS_PER_ROOM - 1, Math.max(0, parseInt(settings.botCount) || 0));
        if (settings.botDifficulty && BOT_DIFFICULTY[settings.botDifficulty]) room.settings.botDifficulty = settings.botDifficulty;
        if (settings.maxRounds !== undefined) room.maxRounds = Math.min(10, Math.max(1, parseInt(settings.maxRounds) || 3));
        io.to(room.id).emit('roomUpdate', roomSummary(room));
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
            room.players[botId] = makePlayer(botId, botName, true, room.settings.botDifficulty, botCar);
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

    socket.on('input', ({ roomId, input, seq }) => {
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
        p.lastProcessedInput = seq || (p.lastProcessedInput + 1);
    });

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

// ─── Car physics ───────────────────────────────────────────────────────────
// Cars are oriented boxes (matched to the sprite) with mass, rotational inertia
// and tyre grip. Movement + contacts run in sub-steps so fast cars can't tunnel.
const SUBSTEPS = 4;
const CAR_HALF_LEN = 44;            // px at size 1 (sprite 131px × 0.7 scale)
const CAR_HALF_WID = 23;            // px at size 1 (sprite 71px × 0.7 scale)
const INERTIA_FACTOR = 4;           // >1 = cars resist spinning (heavier than a uniform box)
const MAX_SPIN = 5;                 // rad/s cap on collision-induced spin
const FENCE_BREAK_SPEED = 380;      // wall impact (px/s) that smashes through — only after a hit
const HIT_WINDOW_MS = 1500;         // how long a hit counts as "being pushed"
const SHRINK_START = 25;            // s — arena starts closing in
const SHRINK_END = 75;              // s — fully shrunk; fence turns electric (sudden death)
const FINAL_END = 120;             // s — slow final squeeze
const SHRINK_FRAC = 0.5;
const FINAL_FRAC = 0.3;

function carSpec(p) {
    const s = p.carStats;
    return {
        top: 330 + 230 * (s.maxSpeed - 0.75) / 0.75,   // 330 (truck) … 560 (supercar) px/s
        accel: 560 * s.accel,
        turn: 2.5 * s.turn,
        grip: s.turn > 1.25 ? 950 : 1500,              // drifters let go of the rear sooner
    };
}

function carMass(p) { return p.carStats.mass * p.scale * p.scale; }

function carBox(p) {
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

function markHit(victim, attacker, now) {
    victim.lastHitAt = now;
    victim.lastHitBy = attacker.id;
}

function eliminate(p, room, now, reason) {
    p.alive = false;
    p.av = 0;
    room.eliminationOrder.push({ id: p.id, name: p.name });
    const killer = now - (p.lastHitAt || 0) < HIT_WINDOW_MS ? room.players[p.lastHitBy] : null;
    if (killer && killer.id !== p.id) { killer.kills++; }
    io.to(room.id).emit('playerEliminated', {
        id: p.id, name: p.name, x: p.x, y: p.y, reason,
        by: killer ? killer.name : null, byId: killer ? killer.id : null,
    });

    // Solo vs bots: once the only human is out there's nothing to watch —
    // end the match and send them back to the lobby.
    const all = Object.values(room.players);
    const humans = all.filter(q => !q.isBot);
    if (!p.isBot && humans.length === 1 && all.length > 1) {
        const rank = all.filter(q => q.alive).length + 1;
        room.running = false;
        room.round = 0;
        room.scores = {};
        io.to(room.id).emit('soloOut', { rank, total: all.length, by: killer ? killer.name : null, reason });
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    }
}

// Keep only the strongest hit per pair of cars (or car + fence) each tick, so
// clients can shake the camera only for the cars that were actually involved.
function addFx(fx, key, ev) {
    const cur = fx.get(key);
    if (!cur || ev.impact > cur.impact) fx.set(key, ev);
}

// Car vs car: positional correction + impulse with spin and a bit of scraping friction
function resolveCars(A, B, room, now, fx) {
    const c = boxContact(A, B);
    if (!c) return;
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
    if (vn >= 0) return; // already separating

    let e = 0.3;
    if (a.dashTimer > 0 || b.dashTimer > 0) e = 0.6;   // a dash ram hits hard
    if (a.megaTimer > 0 || b.megaTimer > 0) e += 0.15;

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
    a.av -= (rax * iy - ray * ix) / A.inertia;
    b.av += (rbx * iy - rby * ix) / B.inertia;
    a.av = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, a.av));
    b.av = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, b.av));

    const impact = -vn;
    if (impact > 60) {
        markHit(a, b, now);
        markHit(b, a, now);
        a.damageDealt += impact * 0.5;
        b.damageDealt += impact * 0.5;
    }
    if (impact > 90) addFx(fx, a.id < b.id ? a.id + b.id : b.id + a.id, { impact, x: cx, y: cy, type: 'car', ids: [a.id, b.id] });
}

// Car vs fence: a solid barrier that bounces you back. It only gives way when you
// are slammed into it by someone else — or in sudden death, when it's electrified.
function resolveFence(B, R, room, now, fx) {
    const p = B.p;
    let far = null, farD = 0;
    for (const c of B.corners) {
        const d = Math.hypot(c[0], c[1]);
        if (d > farD) { farD = d; far = c; }
    }
    if (farD <= R) return;

    const nx = far[0] / farD, ny = far[1] / farD;     // outward normal
    const rx = far[0] - p.x, ry = far[1] - p.y;
    const vcx = p.vx - p.av * ry, vcy = p.vy + p.av * rx;
    const vn = vcx * nx + vcy * ny;                    // >0 = heading out

    const pushed = now - (p.lastHitAt || 0) < HIT_WINDOW_MS;
    const lethal = (room.suddenDeath && vn > 80) || (vn > FENCE_BREAK_SPEED && pushed);
    if (lethal) {
        if (p.shield) {
            p.shield = false; p.shieldTimer = 0;       // shield absorbs it once
        } else {
            eliminate(p, room, now, room.suddenDeath ? 'electric' : 'fence');
            return;
        }
    }

    if (vn > 0) {
        const rn = rx * ny - ry * nx;
        const j = (1 + 0.3) * vn / (1 / B.m + rn * rn / B.inertia);
        p.vx -= nx * j / B.m; p.vy -= ny * j / B.m;
        p.av -= rn * j / B.inertia;
        p.av = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, p.av));
        if (vn > 140) addFx(fx, 'wall' + p.id, { impact: vn, x: far[0], y: far[1], type: 'wall', ids: [p.id] });
    }
    const pen = farD - R;
    p.x -= nx * pen; p.y -= ny * pen;
}

// Engine, brakes, steering and tyre grip — applied once per tick
function driveCar(p, room, now) {
    const inp = p.inputs;
    const spec = carSpec(p);
    const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
    let fwd = p.vx * fx + p.vy * fy;
    let lat = -p.vx * fy + p.vy * fx;
    const top = spec.top * p.speedMult;
    const accel = spec.accel * p.speedMult;
    const thr = inp.forward;

    // Engine / brakes
    if (thr > 0.05) {
        if (fwd < -15) fwd = Math.min(0, fwd + 1100 * thr * DT);           // braking out of reverse
        else fwd += accel * thr * (1 - fwd / top) * DT;                      // also drags back above top speed
    } else if (thr < -0.05) {
        const rTop = top * 0.45;
        if (fwd > 15) fwd = Math.max(0, fwd + 1100 * thr * DT);           // brake
        else fwd += accel * 0.6 * thr * (1 + fwd / rTop) * DT;              // reverse gear
    } else {
        const roll = (160 + 0.9 * Math.abs(fwd)) * DT;                       // rolling resistance
        fwd = Math.abs(fwd) <= roll ? 0 : fwd - Math.sign(fwd) * roll;
    }

    // Dash: a burst of extra speed that lets you ram
    if (inp.dash && p.dashCooldown <= 0) {
        fwd = Math.max(fwd, 0) + 340 * p.carStats.dashForce;
        p.dashCooldown = DASH_COOLDOWN;
        p.dashTimer = 0.45;
        p.dashesUsed++;
    }

    // Tyre grip: scrub sideways velocity, but only so fast — hits make you slide
    const grip = p.slip > 0 ? 220 : spec.grip;
    const scrub = grip * DT;
    p.skid = Math.abs(lat) > 150 || p.slip > 0;
    lat = Math.abs(lat) <= scrub ? 0 : lat - Math.sign(lat) * scrub;

    // Steering: yaw rate grows with speed, flips in reverse, tyres fight any spin
    const spd = Math.abs(fwd);
    const steerScale = Math.min(1, spd / 120) * (1 - 0.25 * Math.min(1, spd / top));
    const dir = fwd < -5 ? -1 : 1;
    const targetYaw = inp.steer * spec.turn * steerScale * dir;
    const yawResponse = p.slip > 0 ? 2.5 : 10;
    p.av += (targetYaw - p.av) * Math.min(1, yawResponse * DT);
    if (p.slip > 0) p.slip -= DT;

    p.vx = fx * fwd - fy * lat;
    p.vy = fy * fwd + fx * lat;

    const v = Math.hypot(p.vx, p.vy);
    if (v > 1600) { p.vx *= 1600 / v; p.vy *= 1600 / v; }
}

function updateArena(room, now) {
    const t = Math.max(0, (now - room.matchStartTime) / 1000);
    const R0 = room.settings.arenaRadius;
    let frac = 1;
    if (t >= SHRINK_END) frac = SHRINK_FRAC + (FINAL_FRAC - SHRINK_FRAC) * Math.min(1, (t - SHRINK_END) / (FINAL_END - SHRINK_END));
    else if (t >= SHRINK_START) frac = 1 + (SHRINK_FRAC - 1) * (t - SHRINK_START) / (SHRINK_END - SHRINK_START);
    room.arenaR = R0 * frac;
    const wasSD = room.suddenDeath;
    room.suddenDeath = t >= SHRINK_END;
    if (room.suddenDeath && !wasSD) io.to(room.id).emit('arenaEvent', { type: 'suddenDeath' });
    if (t >= SHRINK_START && !room._shrinkAnnounced) {
        room._shrinkAnnounced = true;
        io.to(room.id).emit('arenaEvent', { type: 'shrink' });
    }
    return t;
}

function sendSnapshot(room, now) {
    const t = Math.max(0, (now - room.matchStartTime) / 1000);
    io.to(room.id).emit('snapshot', {
        players: Object.values(room.players).map(p => ({
            id: p.id, name: p.name, isBot: p.isBot, carType: p.carType,
            cosmetics: p.cosmetics,
            x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
            angle: Math.round(p.angle * 1000) / 1000,
            alive: p.alive, shield: p.shield, scale: p.scale,
            isDashing: p.dashTimer > 0, skid: !!p.skid,
            dashCooldown: p.dashCooldown, shootCooldown: p.shootCooldown,
            speedMult: p.speedMult, slip: p.slip,
            magnetTimer: p.magnetTimer || 0,
            weapon: p.weapon || null,
            kills: p.kills
        })),
        powerups: room.powerups,
        projectiles: room.projectiles,
        hazards: room.hazards.map(h => ({ id: h.id, type: h.type, x: h.x, y: h.y })),
        timestamp: now,
        elapsed: Math.max(0, now - room.matchStartTime),
        arenaRadius: room.arenaR || room.settings.arenaRadius,
        arenaBase: room.settings.arenaRadius,
        suddenDeath: !!room.suddenDeath,
        shrinkIn: room.countdown > 0 ? SHRINK_START : Math.max(0, SHRINK_START - t),
        round: room.round,
        maxRounds: room.maxRounds,
    });
}

// ─── Game loop ─────────────────────────────────────────────────────────────
setInterval(() => {
    const now = Date.now();

    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (!room.running) continue;

        // Countdown — cars sit on the grid, but clients still get the scene
        if (room.countdown > 0) {
            if (!room._cdlast || now - room._cdlast >= 1000) {
                room.countdown -= 1;
                room._cdlast = now;
                io.to(room.id).emit('countdown', { count: Math.max(0, room.countdown) });
            }
            if (room.countdown <= 0) {
                room.countdown = 0;
                room.matchStartTime = now;
                for (let i = 0; i < 6; i++) spawnPowerup(room);
            } else {
                room.arenaR = room.settings.arenaRadius;
                if (++room._cdSnap % 6 === 0) sendSnapshot(room, now);
                continue;
            }
        }

        updateArena(room, now);

        // Spawn powerups
        if (!room._lastPU || now - room._lastPU > room.settings.powerupInterval) {
            spawnPowerup(room);
            room._lastPU = now;
        }

        // ─── Update AI bots ────────────────────────────────────────────
        for (const id in room.players) {
            const p = room.players[id];
            if (p.isBot && p.alive) updateBotAI(p, room, now);
        }

        // ─── Controls, weapons, powerups per player ────────────────────
        for (const id in room.players) {
            const p = room.players[id];
            if (!p.alive) {
                // Wrecks keep sliding out through the broken fence
                p.x += p.vx * DT; p.y += p.vy * DT;
                p.vx *= 0.95; p.vy *= 0.95;
                continue;
            }
            p.survivalTime = now - room.matchStartTime;

            const inp = p.inputs;
            tickTimers(p);
            driveCar(p, room, now);

            // Drop a held trap weapon (Oil / Reverse) behind the car
            if (inp.drop && p.weapon && p.dropCooldown <= 0) {
                const bx = p.x - Math.cos(p.angle) * 56;
                const by = p.y - Math.sin(p.angle) * 56;
                const isOil = p.weapon === 'oil';
                room.hazards.push({
                    id: uuidv4().slice(0, 6),
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
            if (inp.shoot && p.shootCooldown <= 0 && room.projectiles.length < MAX_PROJECTILES) {
                const speed = 1150;
                room.projectiles.push({
                    id: uuidv4().slice(0, 6),
                    ownerId: p.id,
                    x: p.x + Math.cos(p.angle) * 50,
                    y: p.y + Math.sin(p.angle) * 50,
                    vx: Math.cos(p.angle) * speed + p.vx,
                    vy: Math.sin(p.angle) * speed + p.vy,
                    created: now
                });
                p.shootCooldown = 0.8;
                p.vx -= Math.cos(p.angle) * 50;
                p.vy -= Math.sin(p.angle) * 50;
                p.shotsFired++;
            }

            // Magnet: pull nearby powerups
            if (p.magnetTimer > 0) {
                for (const pu of room.powerups) {
                    const dx = p.x - pu.x, dy = p.y - pu.y;
                    const dist = Math.hypot(dx, dy);
                    if (dist < 300 && dist > 5) {
                        pu.x += (dx / dist) * 200 * DT;
                        pu.y += (dy / dist) * 200 * DT;
                    }
                }
            }

            p.dashCooldown = Math.max(0, p.dashCooldown - DT);
            p.dashTimer = Math.max(0, p.dashTimer - DT);
            p.shootCooldown = Math.max(0, p.shootCooldown - DT);
            p.dropCooldown = Math.max(0, p.dropCooldown - DT);
        }

        // ─── Integrate + resolve contacts in sub-steps ─────────────────
        const fx = new Map();
        const h = DT / SUBSTEPS;
        for (let s = 0; s < SUBSTEPS; s++) {
            const alive = Object.values(room.players).filter(p => p.alive);
            for (const p of alive) {
                p.x += p.vx * h;
                p.y += p.vy * h;
                p.angle += p.av * h;
            }
            let boxes = alive.map(carBox);
            for (let i = 0; i < boxes.length; i++) {
                for (let j = i + 1; j < boxes.length; j++) {
                    const A = boxes[i], B = boxes[j];
                    const reach = (A.hl + B.hl) + 2;
                    if (Math.abs(A.p.x - B.p.x) > reach || Math.abs(A.p.y - B.p.y) > reach) continue;
                    resolveCars(A, B, room, now, fx);
                }
            }
            boxes = alive.map(carBox);          // positions moved — rebuild before the fence pass
            for (const B of boxes) resolveFence(B, room.arenaR, room, now, fx);
        }
        for (const ev of fx.values()) io.to(room.id).emit('collision', ev);
        if (!room.running) continue;   // solo match ended this tick

        // Powerup pickup
        for (const id in room.players) {
            const p = room.players[id];
            if (!p.alive) continue;
            for (let i = room.powerups.length - 1; i >= 0; i--) {
                const pu = room.powerups[i];
                if (Math.hypot(p.x - pu.x, p.y - pu.y) < 40 * p.scale * p.carStats.size) {
                    applyPowerup(pu.type, p, room);
                    room.powerups.splice(i, 1);
                    io.to(room.id).emit('powerupCollected', { playerId: p.id, puId: pu.id, type: pu.type });
                }
            }
        }
        // Powerups caught outside the shrinking fence are lost
        room.powerups = room.powerups.filter(pu => Math.hypot(pu.x, pu.y) < room.arenaR - 30);

        // ─── Projectile physics ────────────────────────────────────────
        for (let i = room.projectiles.length - 1; i >= 0; i--) {
            const proj = room.projectiles[i];
            proj.x += proj.vx * DT;
            proj.y += proj.vy * DT;

            if (Math.hypot(proj.x, proj.y) > room.arenaR + 40 || now - proj.created > 1300) {
                room.projectiles.splice(i, 1);
                continue;
            }

            for (const id in room.players) {
                const p = room.players[id];
                if (!p.alive || p.id === proj.ownerId) continue;
                if (Math.hypot(p.x - proj.x, p.y - proj.y) < 34 * p.scale * p.carStats.size) {
                    const ang = Math.atan2(proj.vy, proj.vx);
                    const force = (p.shield ? 160 : 420) / carMass(p);
                    p.vx += Math.cos(ang) * force;
                    p.vy += Math.sin(ang) * force;
                    p.av += (Math.random() - 0.5) * 3;

                    const shooter = room.players[proj.ownerId];
                    if (shooter) { shooter.damageDealt += force; markHit(p, shooter, now); }

                    room.projectiles.splice(i, 1);
                    io.to(room.id).emit('collision', { impact: 260, x: p.x, y: p.y, type: 'projectile', ids: [p.id] });
                    break;
                }
            }
        }

        // ─── Trap hazards (dropped Oil / Reverse) ──────────────────────
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

        sendSnapshot(room, now);

        // ─── Win condition ─────────────────────────────────────────────
        const aliveCount = Object.values(room.players).filter(p => p.alive).length;
        const totalPlayers = Object.keys(room.players).length;

        if ((totalPlayers > 1 && aliveCount <= 1) || (totalPlayers === 1 && aliveCount === 0)) {
            room.running = false;
            // Last car standing — or, if the final cars went out together, the last one out
            const winner = Object.values(room.players).find(p => p.alive)
                || (room.eliminationOrder.length ? room.players[room.eliminationOrder.pop().id] : null);

            // Score: 1st=10, 2nd=6, 3rd=4, 4th=3, 5th=2, rest=1
            const scoreTable = [10, 6, 4, 3, 2, 1, 1, 1];
            if (winner) room.eliminationOrder.push({ id: winner.id, name: winner.name });
            const rankings = [...room.eliminationOrder].reverse();
            rankings.forEach((r, i) => {
                r.rank = i + 1;
                r.score = scoreTable[i] || 1;
                room.scores[r.id] = (room.scores[r.id] || 0) + r.score;
            });

            const matchOver = room.round >= room.maxRounds;

            io.to(room.id).emit('matchEnd', {
                winnerId: winner?.id || null,
                winnerName: winner?.name || null,
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
            if (matchOver) io.to(room.id).emit('roomUpdate', roomSummary(room));

            // Auto-start next round after delay
            if (!matchOver) {
                setTimeout(() => {
                    const r = rooms[roomId];
                    if (!r || r.running) return;
                    r.round++;
                    beginRound(r);
                }, 6000);
            }
        }
    }
}, 1000 / TICK_RATE);

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
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🏎️  Dash Arena server on :${PORT}`));

// Render's free tier sleeps after ~15 min without inbound traffic. Pinging our own
// public URL counts as inbound traffic, so the server stays awake for players.
const KEEPALIVE_URL = process.env.RENDER_EXTERNAL_URL;
if (KEEPALIVE_URL) {
    const https = require('https');
    setInterval(() => {
        https.get(`${KEEPALIVE_URL}/api/health`, res => res.resume()).on('error', () => {});
    }, 10 * 60 * 1000);
}
