// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const TICK_RATE = 60; // 60 FPS for smoother physics
const DT = 1 / TICK_RATE;
const ARENA_RADIUS = 1000; // Increased arena size
const POWERUP_INTERVAL = 5000;

let rooms = {}; // { roomId: Room }

function createRoom() {
    const roomId = uuidv4().slice(0, 6);
    rooms[roomId] = {
        id: roomId,
        players: {}, // socketId -> player
        powerups: [],
        projectiles: [], // New: Array of projectiles
        running: false,
        countdown: 0,
        lastTick: Date.now(),
        matchStartTime: 0,
        eliminationOrder: []
    };
    return rooms[roomId];
}

function makePlayer(socket, name) {
    return {
        id: socket.id,
        name: name || `Player_${socket.id.slice(0, 4)}`,
        x: Math.random() * 200 - 100, // Spawn near center
        y: Math.random() * 200 - 100,
        angle: Math.random() * Math.PI * 2,
        vx: 0,
        vy: 0,
        rotSpeed: 0,
        alive: true,
        dashTimer: 0,
        dashCooldown: 0,
        speedMult: 1,
        shield: false,
        inputs: { forward: 0, steer: 0, dash: false, shoot: false },
        shootCooldown: 0, // New: Cooldown for shooting
        lastProcessedInput: 0,
        slip: 0, // For oil spill effect
        scale: 1, // For MegaPush size effect
        isDashing: false // For visual feedback
    };
}

function spawnPowerup(room) {
    const types = ['SpeedBoost', 'Shield', 'MegaPush', 'Oil', 'Reverse'];
    const type = types[Math.floor(Math.random() * types.length)];
    const r = Math.random() * (ARENA_RADIUS * 0.8);
    const a = Math.random() * Math.PI * 2;
    room.powerups.push({
        id: uuidv4().slice(0, 6),
        type,
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        created: Date.now()
    });
}

io.on('connection', socket => {
    console.log('conn', socket.id);

    socket.on('createRoom', ({ name }, cb) => {
        const room = createRoom();
        socket.join(room.id);
        const p = makePlayer(socket, name);
        room.players[socket.id] = p;
        cb({ roomId: room.id, player: p });
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('joinRoom', ({ roomId, name }, cb) => {
        const room = rooms[roomId];
        if (!room) return cb({ error: 'Room not found' });
        socket.join(room.id);
        room.players[socket.id] = makePlayer(socket, name);
        cb({ roomId: room.id });
        io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('leaveRoom', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        delete room.players[socket.id];
        socket.leave(room.id);
        if (Object.keys(room.players).length === 0) delete rooms[roomId];
        else io.to(room.id).emit('roomUpdate', roomSummary(room));
    });

    socket.on('startMatch', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        room.running = true;
        room.countdown = 3;
        room.powerups = [];
        room.projectiles = []; // Reset projectiles
        room.matchStartTime = Date.now() + 3000; // start time after countdown
        room.eliminationOrder = [];
        // spawn players evenly around center
        const ids = Object.keys(room.players);
        const n = ids.length;
        let i = 0;
        for (const id of ids) {
            const p = room.players[id];
            const a = (i / Math.max(1, n)) * Math.PI * 2;
            p.x = Math.cos(a) * (ARENA_RADIUS * 0.1); // Closer start
            p.y = Math.sin(a) * (ARENA_RADIUS * 0.1);
            p.vx = p.vy = 0;
            p.angle = a + Math.PI; // face center-ish
            p.alive = true;
            p.speedMult = 1;
            p.shield = false;
            p.slip = 0;
            p.scale = 1;
            p.isDashing = false;
            i++;
        }
        io.to(room.id).emit('matchStart', { count: room.countdown });
    });

    socket.on('input', ({ roomId, input, seq }) => {
        const room = rooms[roomId];
        if (!room) return;
        const p = room.players[socket.id];
        if (!p) return;
        p.inputs = input;
        p.lastProcessedInput = seq || (p.lastProcessedInput + 1);
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                if (Object.keys(room.players).length === 0) delete rooms[roomId];
                else io.to(roomId).emit('roomUpdate', roomSummary(room));
            }
        }
    });
});

function roomSummary(room) {
    return {
        id: room.id,
        players: Object.values(room.players).map(p => ({ id: p.id, name: p.name, alive: p.alive })),
        running: room.running,
        powerups: room.powerups,
        projectiles: room.projectiles // Send projectiles in summary
    };
}

// physics tick
setInterval(() => {
    const now = Date.now();
    for (const roomId in rooms) {
        const room = rooms[roomId];

        if (!room.running) continue;

        // countdown handling (simple)
        if (room.countdown > 0) {
            if (!room._cdlast || now - room._cdlast >= 1000) {
                room.countdown -= 1;
                room._cdlast = now;
                io.to(room.id).emit('countdown', { count: Math.max(0, room.countdown) });
            }
            if (room.countdown <= 0) {
                room.countdown = 0;
                for (let i = 0; i < 5; i++) spawnPowerup(room); // More initial powerups
            } else continue;
        }

        // spawn powerups periodically
        if (!room._lastPU || now - room._lastPU > POWERUP_INTERVAL) {
            spawnPowerup(room);
            room._lastPU = now;
        }

        // Apply physics per player
        for (const id in room.players) {
            const p = room.players[id];
            if (!p.alive) continue;

            const inpt = p.inputs || { forward: 0, steer: 0, dash: false, shoot: false };

            // Steering
            // If slipping (oil), steering is erratic or reduced
            let steerEffect = 1;
            if (p.slip > 0) {
                steerEffect = 0.3;
                p.slip -= DT;
            }
            p.angle += inpt.steer * 4 * DT * steerEffect; // Increased turn speed

            // Acceleration
            // Base speed 600 (tuned for 60FPS and friction)
            const forwardSpeed = 600 * inpt.forward * p.speedMult;

            const ax = Math.cos(p.angle) * forwardSpeed;
            const ay = Math.sin(p.angle) * forwardSpeed;

            p.vx += ax * DT;
            p.vy += ay * DT;

            // Dash
            p.isDashing = false;
            if (inpt.dash && p.dashCooldown <= 0) {
                const dashForce = 1500; // Stronger dash
                p.vx += Math.cos(p.angle) * dashForce;
                p.vy += Math.sin(p.angle) * dashForce;
                p.dashCooldown = 1.5; // Reduced cooldown
                p.isDashing = true; // Mark as dashing this frame
            }

            // Shooting
            if (inpt.shoot && p.shootCooldown <= 0) {
                const speed = 1500;
                room.projectiles.push({
                    id: uuidv4().slice(0, 6),
                    ownerId: p.id,
                    x: p.x + Math.cos(p.angle) * 40, // Spawn slightly in front
                    y: p.y + Math.sin(p.angle) * 40,
                    vx: Math.cos(p.angle) * speed + p.vx, // Add player velocity? Maybe just base speed is better for consistency
                    vy: Math.sin(p.angle) * speed + p.vy,
                    created: now
                });
                p.shootCooldown = 1.0; // 1 second cooldown
                // Recoil?
                p.vx -= Math.cos(p.angle) * 200;
                p.vy -= Math.sin(p.angle) * 200;
            }

            // Friction / Damping
            // 0.94 per tick @ 60FPS provides smooth but quick stops
            const friction = p.slip > 0 ? 0.99 : 0.94; // Slide more if slipping
            p.vx *= friction;
            p.vy *= friction;

            p.x += p.vx * DT;
            p.y += p.vy * DT;

            p.dashCooldown = Math.max(0, p.dashCooldown - DT);
            p.shootCooldown = Math.max(0, p.shootCooldown - DT);

            // Arena boundary
            if (Math.hypot(p.x, p.y) > ARENA_RADIUS) {
                if (!p.shield) {
                    p.alive = false;
                    room.eliminationOrder.push({ id: p.id, name: p.name });
                    io.to(room.id).emit('playerEliminated', { id: p.id });
                } else {
                    // Shield bounce
                    const angle = Math.atan2(p.y, p.x);
                    p.vx = -Math.cos(angle) * 500;
                    p.vy = -Math.sin(angle) * 500;
                    p.x = Math.cos(angle) * (ARENA_RADIUS - 10);
                    p.y = Math.sin(angle) * (ARENA_RADIUS - 10);
                    p.shield = false;
                }
            }

            // Powerup pickup
            for (let i = room.powerups.length - 1; i >= 0; i--) {
                const pu = room.powerups[i];
                const dx = p.x - pu.x, dy = p.y - pu.y;
                // Pickup radius scales with player size
                if (Math.hypot(dx, dy) < 30 * p.scale) {
                    applyPowerup(pu.type, p, room);
                    room.powerups.splice(i, 1);
                    io.to(room.id).emit('powerupCollected', { playerId: p.id, puId: pu.id, type: pu.type });
                }
            }
        }


        // Projectiles Logic
        for (let i = room.projectiles.length - 1; i >= 0; i--) {
            const proj = room.projectiles[i];

            // Move
            proj.x += proj.vx * DT;
            proj.y += proj.vy * DT;

            // Remove if out of bounds or too old (2s lifetime)
            if (Math.hypot(proj.x, proj.y) > ARENA_RADIUS || now - proj.created > 2000) {
                room.projectiles.splice(i, 1);
                continue;
            }

            // Collision with players
            for (const id in room.players) {
                const p = room.players[id];
                if (!p.alive || p.id === proj.ownerId) continue; // Don't hit self or dead

                const dx = p.x - proj.x;
                const dy = p.y - proj.y;
                const dist = Math.hypot(dx, dy);

                // Hit radius
                if (dist < 30 * p.scale) {
                    // HIT!
                    // Knockback
                    const angle = Math.atan2(proj.vy, proj.vx);
                    const force = 1000; // Strong knockback
                    p.vx += Math.cos(angle) * force;
                    p.vy += Math.sin(angle) * force;

                    // Remove projectile
                    room.projectiles.splice(i, 1);
                    io.to(room.id).emit('collision', { impact: 500, x: p.x, y: p.y }); // Sound effect
                    break; // Projectile gone, stop checking players
                }
            }
        }

        // Collisions
        const playersArray = Object.values(room.players).filter(p => p.alive);
        for (let i = 0; i < playersArray.length; i++) {
            for (let j = i + 1; j < playersArray.length; j++) {
                const a = playersArray[i], b = playersArray[j];
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.hypot(dx, dy);

                // Collision radius depends on scale
                const rA = 30 * a.scale;
                const rB = 30 * b.scale;
                const minDist = (rA + rB) * 0.5; // Approx average radius

                if (dist < minDist && dist > 0) {
                    const overlap = (minDist - dist) * 0.5;
                    const nx = dx / dist, ny = dy / dist;

                    // Separate
                    a.x -= nx * overlap;
                    a.y -= ny * overlap;
                    b.x += nx * overlap;
                    b.y += ny * overlap;

                    // Elastic collision response
                    const dvx = a.vx - b.vx;
                    const dvy = a.vy - b.vy;
                    // Project velocity onto normal
                    const vn = dvx * nx + dvy * ny;

                    if (vn > 0) continue; // Moving apart

                    // Collision impulse
                    // MegaPush increases mass/force effectively
                    let forceMult = 1.2; // Bounciness

                    // Mass approximation based on scale
                    const massA = a.scale * a.scale;
                    const massB = b.scale * b.scale;

                    // MegaPush effect (extra force multiplier)
                    if (a.scale > 1.2) forceMult *= 1.5;
                    if (b.scale > 1.2) forceMult *= 1.5;

                    const impulse = -vn * forceMult;

                    // Apply impulse inversely proportional to mass
                    const totalMass = massA + massB;
                    const imA = massB / totalMass; // Heavier object moves less
                    const imB = massA / totalMass;

                    a.vx -= nx * impulse * imA;
                    a.vy -= ny * impulse * imA;
                    b.vx += nx * impulse * imB;
                    b.vy += ny * impulse * imB;

                    // Emit collision event for sound
                    const impact = Math.abs(vn);
                    if (impact > 100) {
                        io.to(room.id).emit('collision', { impact, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
                    }
                }
            }
        }

        // Broadcast snapshot
        const snapshot = {
            players: Object.values(room.players).map(p => ({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                angle: p.angle,
                alive: p.alive,
                shield: p.shield,
                scale: p.scale,
                isDashing: p.isDashing,
                dashCooldown: p.dashCooldown, // Send cooldowns for UI
                shootCooldown: p.shootCooldown
            })),
            powerups: room.powerups,
            projectiles: room.projectiles, // Send projectiles
            timestamp: Date.now(),
            elapsed: room.running ? Math.max(0, Date.now() - room.matchStartTime) : 0
        };
        io.to(room.id).emit('snapshot', snapshot);

        // Win condition
        const aliveCount = Object.values(room.players).filter(p => p.alive).length;
        const totalPlayers = Object.keys(room.players).length;

        if ((totalPlayers > 1 && aliveCount <= 1) || (totalPlayers === 1 && aliveCount === 0)) {
            room.running = false;
            const winner = Object.values(room.players).find(p => p.alive);
            if (winner) {
                room.eliminationOrder.push({ id: winner.id, name: winner.name, rank: 1 });
            }
            const rankings = [...room.eliminationOrder].reverse();
            rankings.forEach((r, i) => r.rank = i + 1);

            io.to(room.id).emit('matchEnd', {
                winnerId: winner ? winner.id : null,
                winnerName: winner ? winner.name : null,
                rankings: rankings
            });
        }
    }
}, 1000 / TICK_RATE);

function applyPowerup(type, player, room) {
    switch (type) {
        case 'SpeedBoost':
            player.speedMult = 1.5;
            setTimeout(() => { player.speedMult = 1; }, 5000);
            break;
        case 'Shield':
            player.shield = true;
            setTimeout(() => { player.shield = false; }, 7000);
            break;
        case 'MegaPush':
            player.scale = 1.5; // Grow bigger
            player.speedMult = 1.2; // Slight speed boost
            setTimeout(() => {
                player.scale = 1;
                player.speedMult = 1;
            }, 7000);
            break;
        case 'Oil':
            player.slip = 3.0; // Seconds of slipping
            break;
        case 'Reverse':
            // Client side visual mostly, or we could invert inputs here
            // Let's just mess with their angle for chaos
            player.angle += Math.PI;
            break;
    }
}

const path = require('path');

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on :${PORT}`));
