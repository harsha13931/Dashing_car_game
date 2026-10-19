// ─── Car cosmetics catalog + canvas draw helpers ──────────────────────────
// Shared by the lobby customize screen, the showroom preview, and the
// in-match renderer so an equipped item looks identical everywhere.

export const PAINTS = [
    { key: 'factory', name: 'Factory', color: null },   // null = car's own default color
    { key: 'blue',    name: 'Azure',   color: '#1199dd' },
    { key: 'red',     name: 'Crimson', color: '#cc2244' },
    { key: 'orange',  name: 'Sunset',  color: '#dd7a1a' },
    { key: 'green',   name: 'Venom',   color: '#22aa44' },
    { key: 'purple',  name: 'Royal',   color: '#9944cc' },
    { key: 'gold',    name: 'Gold',    color: '#e8a030' },
    { key: 'teal',    name: 'Lagoon',  color: '#00aaaa' },
    { key: 'pink',    name: 'Candy',   color: '#ee5599' },
    { key: 'white',   name: 'Pearl',   color: '#d8dde6' },
    { key: 'black',   name: 'Carbon',  color: '#2a2e36' },
    { key: 'lime',    name: 'Toxic',   color: '#9ad11f' },
];

export const WHEELS = [
    { key: 'stock',  name: 'Stock',  rim: '#3a3a3a', hub: '#555' },
    { key: 'gold',   name: 'Gold',   rim: '#b8902a', hub: '#ffe9a0' },
    { key: 'chrome', name: 'Chrome', rim: '#aab0bb', hub: '#eef2f8' },
    { key: 'red',    name: 'Racing', rim: '#aa2222', hub: '#ff8080' },
    { key: 'neon',   name: 'Neon',   rim: '#1fae6e', hub: '#9effcf' },
    { key: 'blue',   name: 'Ice',    rim: '#2a6fae', hub: '#9ad4ff' },
];

export const TOPPERS = [
    { key: 'none',      name: 'None' },
    { key: 'party',     name: 'Party Hat' },
    { key: 'crown',     name: 'Crown' },
    { key: 'halo',      name: 'Halo' },
    { key: 'propeller', name: 'Propeller' },
    { key: 'horns',     name: 'Horns' },
    { key: 'cap',       name: 'Cap' },
    { key: 'antenna',   name: 'Antenna' },
];

export const TRAILS = [
    { key: 'classic', name: 'Classic', color: '#ffa000' },
    { key: 'fire',    name: 'Fire',    color: '#ff4a1a' },
    { key: 'ice',     name: 'Ice',     color: '#3fc6ff' },
    { key: 'toxic',   name: 'Toxic',   color: '#6cff33' },
    { key: 'purple',  name: 'Plasma',  color: '#b24aff' },
    { key: 'rainbow', name: 'Rainbow', rainbow: true },
];

export const DEFAULT_COSMETICS = {
    paint: 'factory',
    wheel: 'stock',
    topper: 'none',
    trail: 'classic',
};

const STORAGE_KEY = 'dasharena.cosmetics';

export function loadCosmetics() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return { ...DEFAULT_COSMETICS, ...JSON.parse(raw) };
    } catch (e) { /* ignore */ }
    return { ...DEFAULT_COSMETICS };
}

export function saveCosmetics(c) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ }
}

export function paintColor(key) {
    return (PAINTS.find(p => p.key === key) || PAINTS[0]).color;
}
export function wheelStyle(key) {
    return WHEELS.find(w => w.key === key) || WHEELS[0];
}
export function trailStyle(key) {
    return TRAILS.find(t => t.key === key) || TRAILS[0];
}

// Rainbow cycles over time; others are a fixed color.
export function trailColor(key, t = 0) {
    const s = trailStyle(key);
    if (s.rainbow) {
        const h = (t * 0.12) % 360;
        return `hsl(${h},90%,55%)`;
    }
    return s.color;
}

// ─── Topper art ────────────────────────────────────────────────────────────
// Drawn in the car's local space (nose = +x, up-screen = -y), sitting on the
// cabin. Shapes are chosen to read from the top-down view and rotate with the car.
export function drawTopper(ctx, key) {
    if (!key || key === 'none') return;
    ctx.save();
    ctx.lineJoin = 'round';
    switch (key) {
        case 'party': {
            // Cone rising up-screen from the cabin
            const apexX = 1, apexY = -16;
            ctx.beginPath();
            ctx.moveTo(apexX, apexY);
            ctx.lineTo(-4, -3);
            ctx.lineTo(6, -3);
            ctx.closePath();
            const g = ctx.createLinearGradient(-4, -3, apexX, apexY);
            g.addColorStop(0, '#ffd23f');
            g.addColorStop(1, '#ff8c1a');
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
            // Dots
            ctx.fillStyle = '#ff3b6b';
            ctx.beginPath(); ctx.arc(1, -6, 0.9, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#3fc6ff';
            ctx.beginPath(); ctx.arc(-0.5, -10, 0.8, 0, Math.PI * 2); ctx.fill();
            // Pom
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(apexX, apexY, 1.6, 0, Math.PI * 2); ctx.fill();
            break;
        }
        case 'crown': {
            ctx.fillStyle = '#ffcf33';
            ctx.strokeStyle = '#b8860b';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(-5, 4);
            ctx.lineTo(-6, -5); ctx.lineTo(-2.5, -1); ctx.lineTo(1, -7);
            ctx.lineTo(4.5, -1); ctx.lineTo(7, -5); ctx.lineTo(6, 4);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            // Jewels
            ctx.fillStyle = '#ff3b6b';
            ctx.beginPath(); ctx.arc(1, 1.5, 1, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#3fc6ff';
            ctx.beginPath(); ctx.arc(-3, 2, 0.7, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(4.5, 2, 0.7, 0, Math.PI * 2); ctx.fill();
            break;
        }
        case 'halo': {
            ctx.save();
            ctx.translate(1, -1);
            ctx.strokeStyle = '#ffe66b';
            ctx.shadowColor = '#ffd23f';
            ctx.shadowBlur = 6;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(0, 0, 8, 4.5, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            break;
        }
        case 'propeller': {
            // Beanie dome + 3 blades (reads great top-down)
            ctx.fillStyle = '#e23b4e';
            ctx.beginPath(); ctx.arc(1, 0, 4.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#2a7fd4';
            ctx.beginPath(); ctx.arc(1, 0, 2.2, 0, Math.PI * 2); ctx.fill();
            ctx.save();
            ctx.translate(1, 0);
            ctx.fillStyle = '#ffd23f';
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.lineWidth = 0.4;
            for (let i = 0; i < 3; i++) {
                ctx.rotate((Math.PI * 2) / 3);
                ctx.beginPath();
                ctx.ellipse(6, 0, 5, 1.6, 0, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();
            }
            ctx.fillStyle = '#888';
            ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            break;
        }
        case 'horns': {
            ctx.fillStyle = '#e23b4e';
            ctx.strokeStyle = '#8c1f2c';
            ctx.lineWidth = 0.5;
            // Left horn
            ctx.beginPath();
            ctx.moveTo(-2, -5); ctx.quadraticCurveTo(-7, -7, -8, -11);
            ctx.quadraticCurveTo(-4, -8, -1, -6); ctx.closePath();
            ctx.fill(); ctx.stroke();
            // Right horn
            ctx.beginPath();
            ctx.moveTo(-2, 5); ctx.quadraticCurveTo(-7, 7, -8, 11);
            ctx.quadraticCurveTo(-4, 8, -1, 6); ctx.closePath();
            ctx.fill(); ctx.stroke();
            break;
        }
        case 'cap': {
            // Dome + brim toward the nose
            ctx.fillStyle = '#2a7fd4';
            ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#1f5fa0';
            ctx.beginPath();
            ctx.ellipse(6, 0, 4, 3, 0, -Math.PI / 2, Math.PI / 2);
            ctx.fill();
            ctx.fillStyle = '#ffd23f';
            ctx.beginPath(); ctx.arc(0, 0, 1.3, 0, Math.PI * 2); ctx.fill();
            break;
        }
        case 'antenna': {
            ctx.strokeStyle = '#222';
            ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(1, -13); ctx.stroke();
            ctx.fillStyle = '#ff3b6b';
            ctx.shadowColor = '#ff3b6b';
            ctx.shadowBlur = 5;
            ctx.beginPath(); ctx.arc(1, -14, 2, 0, Math.PI * 2); ctx.fill();
            break;
        }
    }
    ctx.restore();
}
