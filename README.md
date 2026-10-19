# Dash Arena

A multiplayer car-dashing arena game. Knock your opponents out of the ring to win!

## Features

- **Solo + AI Bots** — Play solo against 1-7 AI bots with 4 difficulty levels
- **Multiplayer** — Create or join rooms with friends via Socket.IO
- **Multi-round scoring** — Cumulative points across rounds; track your stats
- **Dash / Nitro** — Boost forward to slam into opponents
- **Shoot** — Fire projectiles for ranged knockback
- **6 Powerups** — SpeedBoost, Shield, MegaPush, Oil, Reverse, Magnet
- **AI Personalities** — Aggressive, defensive, hunter, and collector bot types
- **Particle effects** — Dash trails, death explosions, tire marks, projectile glow
- **Screen shake** — Impact feedback on collisions
- **Danger zone** — Pulsing red warning ring near arena edge
- **Minimap** — Full arena overview at a glance
- **Mobile controls** — Virtual joystick + action buttons
- **Sound effects** — Procedural audio via Web Audio API (no assets needed)
- **Smooth rendering** — 60 FPS interpolation, camera smoothing, headlights

## Controls

| Action | Keyboard | Mobile |
|---|---|---|
| Drive forward | W / Up | Joystick up |
| Reverse | S / Down | Joystick down |
| Steer | A/D / Left/Right | Joystick left/right |
| Dash / Nitro | Space | NITRO button |
| Shoot | Shift / F | SHOOT button |

## Quick Start

```bash
# Install everything
npm run postinstall

# Dev mode (client + server)
cd server && node index.js &
cd client && npm run dev
```

Or for production:
```bash
npm start   # serves built client + game server on port 3000
```

## Bot Difficulty

| Level | Description |
|---|---|
| Easy | Slow reactions, low accuracy — good for learning |
| Medium | Balanced — a fair challenge |
| Hard | Fast reactions, high accuracy — serious opponents |
| Insane | Near-instant reactions — good luck |

## Tech Stack

| Component | Technology |
|---|---|
| Server | Node.js, Express, Socket.IO |
| Client | React 18, Vite, HTML5 Canvas |
| Sound | Web Audio API (procedural) |
| Deploy | Render (render.yaml included) |

## Project Structure

```
├── server/
│   └── index.js          # Game server: rooms, physics, AI bots, powerups
├── client/
│   ├── src/
│   │   ├── App.jsx       # Router: lobby ↔ game
│   │   ├── components/
│   │   │   ├── Lobby.jsx           # Room create/join + bot settings
│   │   │   ├── Game.jsx            # Input, HUD, mobile controls, match UI
│   │   │   ├── CanvasRenderer.jsx  # Arena, cars, particles, minimap
│   │   │   └── HUD.jsx             # Player list overlay
│   │   ├── net/socket.js           # Socket.IO client
│   │   └── utils/
│   │       ├── SoundManager.js     # Web Audio sound effects
│   │       └── physics.js          # Client-side helpers
│   └── index.html
├── package.json          # Root scripts (install + build + start)
└── render.yaml           # Render deployment config
```
