# 🏎️ Dash Arena

A multiplayer car-dashing arena game. Knock your opponents out of the ring to win!

## Features

- **Multiplayer** — Create or join rooms with friends via Socket.IO
- **Dash / Nitro** — Boost forward to slam into opponents (Space / on-screen button)
- **Shoot** — Fire projectiles for ranged knockback (Shift / F / on-screen button)
- **Powerups** — SpeedBoost ⚡, Shield 🛡️, MegaPush 💪, Oil 🛢️, Reverse 😵
- **Minimap** — See the full arena at a glance
- **Particle effects** — Dash trails, death explosions, projectile glow
- **Mobile controls** — Virtual joystick + action buttons
- **Sound effects** — Collisions, powerups, eliminations, victory fanfare
- **Smooth rendering** — 60 FPS interpolation, camera smoothing, headlights

## Controls

| Action | Keyboard | Mobile |
|---|---|---|
| Drive forward | W / ↑ | Joystick up |
| Reverse | S / ↓ | Joystick down |
| Steer | A/D / ←/→ | Joystick left/right |
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

## Tech Stack

| Component | Technology |
|---|---|
| Server | Node.js, Express, Socket.IO |
| Client | React 18, Vite, HTML5 Canvas |
| Sound | Web Audio API (no assets needed) |
| Deploy | Render (render.yaml included) |

## Project Structure

```
├── server/
│   └── index.js          # Game server: rooms, physics, powerups, projectiles
├── client/
│   ├── src/
│   │   ├── App.jsx       # Router: lobby ↔ game ↔ game-over
│   │   ├── components/
│   │   │   ├── Lobby.jsx           # Room create/join UI
│   │   │   ├── Game.jsx            # Input handling, HUD, mobile controls
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
