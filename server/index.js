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
const DANGER_ZONE = ARENA_RADIUS * 0.85; // visual warning ring
const ROOM_CLEANUP_MS = 5 * 60 * 1000;   // clean empty rooms after 5 min
const MAX_ROOMS = 50;
const MAX_PLAYERS_PER_ROOM = 8;
const MAX_PROJECTILES = 30;

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
function makePlayer(id, name, isBot = false, difficulty = 'medium') {
    const diff = BOT_DIFFICULTY[difficulty] || BOT_DIFFICULTY.medium;
    return {
        id,
        name: name || `Player_${id.slice(0, 4)}`,
        x: 0, y: 0,
        angle: 0,
        vx: 0, vy: 0,
        alive: true,
        dashCooldown: 0,
        shootCooldown: 0,
        speedMult: 1,
        shield: false,
        shieldTimer: 0,
        megaTimer: 0,
        speedTimer: 0,
        inputs: { forward: 0, steer: 0, dash: false, shoot: false },
        lastProcessedInput: 0,
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
    const dist = Math.random() * (room.settings.arenaRadius * 0.8);
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
        const spawnR = room.settings.arenaRadius * 0.3;
        p.x = Math.cos(a) * spawnR;
        p.y = Math.sin(a) * spawnR;
        p.vx = p.vy = 0;
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
        p.shootCooldown = 0;
        p.inputs = { forward: 0, steer: 0, dash: false, shoot: false };
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
    const arenaR = room.settings.arenaRadius;
    const dangerZone = arenaR * 0.8;
    const criticalZone = arenaR * 0.92;
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

    bot.inputs = { forward, steer, dash, shoot };
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
            player.slip = 3.0;
            break;
        case 'Reverse':
            player.angle += Math.PI;
            player.vx *= -0.5;
            player.vy *= -0.5;
            break;
        case 'Magnet':
            // Pull nearby powerups toward player for 3 seconds (handled in tick)
            player.magnetTimer = 3;
            break;
    }
}

function tickTimers(p) {
    if (p.shieldTimer > 0) { p.shieldTimer -= DT; if (p.shieldTimer <= 0) p.shield = false; }
    if (p.megaTimer > 0) { p.megaTimer -= DT; if (p.megaTimer <= 0) { p.scale = 1; if (p.speedTimer <= 0) p.speedMult = 1; } }
    if (p.speedTimer > 0) { p.speedTimer -= DT; if (p.speedTimer <= 0 && p.megaTimer <= 0) p.speedMult = 1; }
    if (p.magnetTimer > 0) p.magnetTimer -= DT;
}

// ─── Socket events ─────────────────────────────────────────────────────────
io.on('connection', socket => {
    console.log(`[connect] ${socket.id}`);

    socket.on('createRoom', ({ name, botCount, botDifficulty }, cb) => {
        if (typeof cb !== 'function') return;
        const room = createRoom(socket.id);
        if (!room) return cb({ error: 'Server full, try again later' });

        socket.join(room.id);
        room.players[socket.id] = makePlayer(socket.id, name);
        room.settings.botCount = Math.min(7, Math.max(0, parseInt(botCount) || 3));
        room.settings.botDifficulty = BOT_DIFFICULTY[botDifficulty] ? botDifficulty : 'medium';

        cb({ roomId: room.id, player: room.players[socket.id] });
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('joinRoom', ({ roomId, name }, cb) => {
        if (typeof cb !== 'function') return;
        const room = rooms[roomId?.toUpperCase?.()];
        if (!room) return cb({ error: 'Room not found' });
        if (Object.keys(room.players).length >= MAX_PLAYERS_PER_ROOM) return cb({ error: 'Room is full' });
        if (room.running) return cb({ error: 'Match in progress' });

        socket.join(room.id);
        room.players[socket.id] = makePlayer(socket.id, name);
        cb({ roomId: room.id });
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('updateSettings', ({ roomId, settings }) => {
        const room = rooms[roomId];
        if (!room || room.hostId !== socket.id || room.running) return;
        if (settings.botCount !== undefined) room.settings.botCount = Math.min(7, Math.max(0, parseInt(settings.botCount) || 0));
        if (settings.botDifficulty && BOT_DIFFICULTY[settings.botDifficulty]) room.settings.botDifficulty = settings.botDifficulty;
        if (settings.maxRounds !== undefined) room.maxRounds = Math.min(10, Math.max(1, parseInt(settings.maxRounds) || 3));
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('leaveRoom', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        delete room.players[socket.id];
        socket.leave(room.id);
        // Remove bots too if this was the only human
        const humans = Object.values(room.players).filter(p => !p.isBot);
        if (humans.length === 0) {
            delete rooms[roomId];
        } else {
            // Transfer host
            if (room.hostId === socket.id) room.hostId = humans[0].id;
            io.to(room.id).emit('roomUpdate', roomSummary(room));
        }
    });

    socket.on('startMatch', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.running) return;
        // Only host can start
        if (room.hostId !== socket.id) return;

        // Add bots
        const existingBots = Object.values(room.players).filter(p => p.isBot);
        existingBots.forEach(b => delete room.players[b.id]);

        const usedNames = new Set(Object.values(room.players).map(p => p.name));
        const availableNames = BOT_NAMES.filter(n => !usedNames.has(n));
        for (let i = 0; i < room.settings.botCount; i++) {
            const botId = `bot_${uuidv4().slice(0, 6)}`;
            const botName = availableNames.length > 0
                ? availableNames.splice(Math.floor(Math.random() * availableNames.length), 1)[0]
                : `Bot_${i + 1}`;
            room.players[botId] = makePlayer(botId, botName, true, room.settings.botDifficulty);
        }

        room.round++;
        room.running = true;
        room.countdown = 3;
        room.powerups = [];
        room.projectiles = [];
        room.matchStartTime = Date.now() + 3000;
        room.eliminationOrder = [];
        room._cdlast = 0;
        room._lastPU = 0;

        resetPlayers(room);

        io.to(room.id).emit('matchStart', { count: room.countdown, round: room.round });
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
            shoot: !!input?.shoot
        };
        p.lastProcessedInput = seq || (p.lastProcessedInput + 1);
    });

    socket.on('disconnect', () => {
        console.log(`[disconnect] ${socket.id}`);
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (!room.players[socket.id]) continue;
            delete room.players[socket.id];
            const humans = Object.values(room.players).filter(p => !p.isBot);
            if (humans.length === 0) {
                delete rooms[roomId];
            } else {
                if (room.hostId === socket.id) room.hostId = humans[0].id;
                io.to(roomId).emit('roomUpdate', roomSummary(room));
            }
        }
    });
});

// ─── Game loop ─────────────────────────────────────────────────────────────
setInterval(() => {
    const now = Date.now();

    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (!room.running) continue;

        // Countdown
        if (room.countdown > 0) {
            if (!room._cdlast || now - room._cdlast >= 1000) {
                room.countdown -= 1;
                room._cdlast = now;
                io.to(room.id).emit('countdown', { count: Math.max(0, room.countdown) });
            }
            if (room.countdown <= 0) {
                room.countdown = 0;
                for (let i = 0; i < 6; i++) spawnPowerup(room);
            } else continue;
        }

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

        // ─── Physics per player ────────────────────────────────────────
        for (const id in room.players) {
            const p = room.players[id];
            if (!p.alive) { p.survivalTime = p.survivalTime || 0; continue; }
            p.survivalTime = now - room.matchStartTime;

            const inp = p.inputs;

            // Timers
            tickTimers(p);

            // Steering
            let steerEffect = 1;
            if (p.slip > 0) { steerEffect = 0.3; p.slip -= DT; }
            p.angle += inp.steer * 4.5 * DT * steerEffect;

            // Acceleration
            const forwardSpeed = 650 * inp.forward * p.speedMult;
            p.vx += Math.cos(p.angle) * forwardSpeed * DT;
            p.vy += Math.sin(p.angle) * forwardSpeed * DT;

            // Dash
            p.isDashing = false;
            if (inp.dash && p.dashCooldown <= 0) {
                p.vx += Math.cos(p.angle) * 1500;
                p.vy += Math.sin(p.angle) * 1500;
                p.dashCooldown = 1.5;
                p.isDashing = true;
                p.dashesUsed++;
            }

            // Shoot
            if (inp.shoot && p.shootCooldown <= 0 && room.projectiles.length < MAX_PROJECTILES) {
                const speed = 1500;
                room.projectiles.push({
                    id: uuidv4().slice(0, 6),
                    ownerId: p.id,
                    x: p.x + Math.cos(p.angle) * 40,
                    y: p.y + Math.sin(p.angle) * 40,
                    vx: Math.cos(p.angle) * speed,
                    vy: Math.sin(p.angle) * speed,
                    created: now
                });
                p.shootCooldown = 0.8;
                p.vx -= Math.cos(p.angle) * 150;
                p.vy -= Math.sin(p.angle) * 150;
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

            // Friction
            const friction = p.slip > 0 ? 0.99 : 0.94;
            p.vx *= friction;
            p.vy *= friction;

            // Velocity cap
            const vel = Math.hypot(p.vx, p.vy);
            const maxVel = 2500;
            if (vel > maxVel) { p.vx = (p.vx / vel) * maxVel; p.vy = (p.vy / vel) * maxVel; }

            p.x += p.vx * DT;
            p.y += p.vy * DT;

            p.dashCooldown = Math.max(0, p.dashCooldown - DT);
            p.shootCooldown = Math.max(0, p.shootCooldown - DT);

            // Arena boundary
            const distFromCenter = Math.hypot(p.x, p.y);
            if (distFromCenter > room.settings.arenaRadius) {
                if (!p.shield) {
                    p.alive = false;
                    room.eliminationOrder.push({ id: p.id, name: p.name });
                    io.to(room.id).emit('playerEliminated', { id: p.id, name: p.name });
                } else {
                    const ang = Math.atan2(p.y, p.x);
                    p.vx = -Math.cos(ang) * 600;
                    p.vy = -Math.sin(ang) * 600;
                    p.x = Math.cos(ang) * (room.settings.arenaRadius - 10);
                    p.y = Math.sin(ang) * (room.settings.arenaRadius - 10);
                    p.shield = false;
                    p.shieldTimer = 0;
                }
            }

            // Powerup pickup
            for (let i = room.powerups.length - 1; i >= 0; i--) {
                const pu = room.powerups[i];
                if (Math.hypot(p.x - pu.x, p.y - pu.y) < 30 * p.scale) {
                    applyPowerup(pu.type, p, room);
                    room.powerups.splice(i, 1);
                    io.to(room.id).emit('powerupCollected', { playerId: p.id, puId: pu.id, type: pu.type });
                }
            }
        }

        // ─── Projectile physics ────────────────────────────────────────
        for (let i = room.projectiles.length - 1; i >= 0; i--) {
            const proj = room.projectiles[i];
            proj.x += proj.vx * DT;
            proj.y += proj.vy * DT;

            if (Math.hypot(proj.x, proj.y) > room.settings.arenaRadius || now - proj.created > 2000) {
                room.projectiles.splice(i, 1);
                continue;
            }

            for (const id in room.players) {
                const p = room.players[id];
                if (!p.alive || p.id === proj.ownerId) continue;
                if (Math.hypot(p.x - proj.x, p.y - proj.y) < 30 * p.scale) {
                    const ang = Math.atan2(proj.vy, proj.vx);
                    const force = p.shield ? 400 : 1000;
                    p.vx += Math.cos(ang) * force;
                    p.vy += Math.sin(ang) * force;

                    // Track damage
                    const shooter = room.players[proj.ownerId];
                    if (shooter) shooter.damageDealt += force;

                    room.projectiles.splice(i, 1);
                    io.to(room.id).emit('collision', { impact: 500, x: p.x, y: p.y, type: 'projectile' });
                    break;
                }
            }
        }

        // ─── Car-to-car collisions ─────────────────────────────────────
        const alive = Object.values(room.players).filter(p => p.alive);
        for (let i = 0; i < alive.length; i++) {
            for (let j = i + 1; j < alive.length; j++) {
                const a = alive[i], b = alive[j];
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.hypot(dx, dy);
                const rA = 25 * a.scale, rB = 25 * b.scale;
                const minDist = rA + rB;

                if (dist < minDist && dist > 0) {
                    const overlap = minDist - dist;
                    const nx = dx / dist, ny = dy / dist;

                    // Separate
                    a.x -= nx * overlap * 0.5;
                    a.y -= ny * overlap * 0.5;
                    b.x += nx * overlap * 0.5;
                    b.y += ny * overlap * 0.5;

                    const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
                    const vn = dvx * nx + dvy * ny;
                    if (vn > 0) continue;

                    let bounce = 1.3;
                    const massA = a.scale * a.scale;
                    const massB = b.scale * b.scale;
                    if (a.scale > 1.2) bounce *= 1.5;
                    if (b.scale > 1.2) bounce *= 1.5;
                    if (a.isDashing) bounce *= 1.4;
                    if (b.isDashing) bounce *= 1.4;

                    const impulse = -vn * bounce;
                    const totalMass = massA + massB;

                    a.vx -= nx * impulse * (massB / totalMass);
                    a.vy -= ny * impulse * (massB / totalMass);
                    b.vx += nx * impulse * (massA / totalMass);
                    b.vy += ny * impulse * (massA / totalMass);

                    // Track damage/kills
                    const impactForce = Math.abs(vn);
                    a.damageDealt += impactForce * 0.5;
                    b.damageDealt += impactForce * 0.5;

                    if (impactForce > 80) {
                        io.to(room.id).emit('collision', {
                            impact: impactForce,
                            x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
                            type: 'car'
                        });
                    }
                }
            }
        }

        // ─── Broadcast snapshot ────────────────────────────────────────
        io.to(room.id).emit('snapshot', {
            players: Object.values(room.players).map(p => ({
                id: p.id, name: p.name, isBot: p.isBot,
                x: p.x, y: p.y, angle: p.angle,
                alive: p.alive, shield: p.shield, scale: p.scale,
                isDashing: p.isDashing,
                dashCooldown: p.dashCooldown, shootCooldown: p.shootCooldown,
                speedMult: p.speedMult, slip: p.slip,
                magnetTimer: p.magnetTimer || 0,
                kills: p.kills
            })),
            powerups: room.powerups,
            projectiles: room.projectiles,
            timestamp: Date.now(),
            elapsed: Math.max(0, Date.now() - room.matchStartTime),
            dangerZone: DANGER_ZONE,
            arenaRadius: room.settings.arenaRadius
        });

        // ─── Win condition ─────────────────────────────────────────────
        const aliveCount = Object.values(room.players).filter(p => p.alive).length;
        const totalPlayers = Object.keys(room.players).length;

        if ((totalPlayers > 1 && aliveCount <= 1) || (totalPlayers === 1 && aliveCount === 0)) {
            room.running = false;
            const winner = Object.values(room.players).find(p => p.alive);

            // Score: 1st=10, 2nd=6, 3rd=4, 4th=3, 5th=2, rest=1
            const scoreTable = [10, 6, 4, 3, 2, 1, 1, 1];
            if (winner) room.eliminationOrder.push({ id: winner.id, name: winner.name });
            const rankings = [...room.eliminationOrder].reverse();
            rankings.forEach((r, i) => {
                r.rank = i + 1;
                r.score = scoreTable[i] || 1;
                room.scores[r.id] = (room.scores[r.id] || 0) + r.score;
                // Count kills (players eliminated while being pushed by this player... simplified: winner gets kill credit)
                if (winner && r.id !== winner.id) winner.kills++;
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

            // Auto-start next round after delay
            if (!matchOver) {
                setTimeout(() => {
                    if (!rooms[roomId] || rooms[roomId].running) return;
                    rooms[roomId].running = true;
                    rooms[roomId].countdown = 3;
                    rooms[roomId].powerups = [];
                    rooms[roomId].projectiles = [];
                    rooms[roomId].round++;
                    rooms[roomId].matchStartTime = Date.now() + 3000;
                    rooms[roomId].eliminationOrder = [];
                    rooms[roomId]._cdlast = 0;
                    resetPlayers(rooms[roomId]);
                    io.to(roomId).emit('matchStart', { count: 3, round: rooms[roomId].round });
                }, 5000);
            }
        }
    }
}, 1000 / TICK_RATE);

// ─── Room cleanup ──────────────────────────────────────────────────────────
setInterval(() => {
    const now = Date.now();
    for (const roomId in rooms) {
        const room = rooms[roomId];
        const humans = Object.values(room.players).filter(p => !p.isBot);
        if (humans.length === 0 && now - room.createdAt > ROOM_CLEANUP_MS) {
            delete rooms[roomId];
            console.log(`[cleanup] Room ${roomId} removed (empty)`);
        }
    }
}, 60000);

// ─── Serve client ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🏎️  Dash Arena server on :${PORT}`));
