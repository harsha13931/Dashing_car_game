// ─── Power-up badge art (shared by the 2D and 3D renderers) ──────────────

export const POWERUP_META = {
    SpeedBoost: { color: '#3fa9ff', label: 'SPEED!', icon: (c, s) => { // lightning bolt
        c.beginPath(); c.moveTo(s * 0.56, s * 0.2); c.lineTo(s * 0.34, s * 0.54);
        c.lineTo(s * 0.48, s * 0.54); c.lineTo(s * 0.42, s * 0.8); c.lineTo(s * 0.68, s * 0.44);
        c.lineTo(s * 0.52, s * 0.44); c.closePath(); c.fill();
    } },
    Shield: { color: '#2fd0d0', label: 'SHIELD!', icon: (c, s) => { // shield
        c.beginPath(); c.moveTo(s * 0.5, s * 0.2); c.lineTo(s * 0.74, s * 0.3);
        c.lineTo(s * 0.74, s * 0.52); c.quadraticCurveTo(s * 0.74, s * 0.72, s * 0.5, s * 0.82);
        c.quadraticCurveTo(s * 0.26, s * 0.72, s * 0.26, s * 0.52); c.lineTo(s * 0.26, s * 0.3);
        c.closePath(); c.fill();
    } },
    MegaPush: { color: '#ff4a5a', label: 'MEGA!', icon: (c, s) => { // double up-chevron
        for (const off of [0, 0.22]) {
            c.beginPath(); c.moveTo(s * 0.5, s * (0.24 + off)); c.lineTo(s * 0.72, s * (0.46 + off));
            c.lineTo(s * 0.62, s * (0.46 + off)); c.lineTo(s * 0.5, s * (0.34 + off));
            c.lineTo(s * 0.38, s * (0.46 + off)); c.lineTo(s * 0.28, s * (0.46 + off));
            c.closePath(); c.fill();
        }
    } },
    Magnet: { color: '#e8a030', label: 'MAGNET!', icon: (c, s) => { // horseshoe magnet
        c.lineWidth = s * 0.14; c.strokeStyle = c.fillStyle;
        c.beginPath(); c.arc(s * 0.5, s * 0.46, s * 0.22, Math.PI, Math.PI * 2); c.stroke();
        c.fillRect(s * 0.21, s * 0.46, s * 0.14, s * 0.22);
        c.fillRect(s * 0.65, s * 0.46, s * 0.14, s * 0.22);
    } },
    Oil: { color: '#b08a52', label: 'OIL!', icon: (c, s) => { // droplet
        c.beginPath(); c.moveTo(s * 0.5, s * 0.22);
        c.quadraticCurveTo(s * 0.74, s * 0.56, s * 0.5, s * 0.8);
        c.quadraticCurveTo(s * 0.26, s * 0.56, s * 0.5, s * 0.22); c.closePath(); c.fill();
    } },
    Repair: { color: '#2fbf5f', label: '+40 HEALTH', icon: (c, s) => { // first-aid cross
        c.fillRect(s * 0.42, s * 0.24, s * 0.16, s * 0.52);
        c.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.16);
    } },
    Blades: { color: '#8f9aa8', label: 'BLADES!', icon: (c, s) => { // saw blade
        c.beginPath();
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2, r = i % 2 ? s * 0.2 : s * 0.29;
            c.lineTo(s * 0.5 + Math.cos(a) * r, s * 0.5 + Math.sin(a) * r);
        }
        c.closePath(); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.45)';
        c.beginPath(); c.arc(s * 0.5, s * 0.5, s * 0.07, 0, Math.PI * 2); c.fill();
    } },
    Bumper: { color: '#ff5fa2', label: 'BALLOONS!', icon: (c, s) => { // three balloons
        for (const [x, y, r] of [[0.36, 0.4, 0.13], [0.62, 0.36, 0.14], [0.5, 0.56, 0.12]]) {
            c.beginPath(); c.arc(s * x, s * y, s * r, 0, Math.PI * 2); c.fill();
        }
        c.lineWidth = s * 0.03; c.strokeStyle = c.fillStyle;
        c.beginPath(); c.moveTo(s * 0.36, s * 0.53); c.lineTo(s * 0.5, s * 0.82); c.lineTo(s * 0.62, s * 0.5);
        c.moveTo(s * 0.5, s * 0.68); c.lineTo(s * 0.5, s * 0.82); c.stroke();
    } },
    Gatling: { color: '#ff7a1a', label: 'GATLING!', icon: (c, s) => { // three-barrel gun
        c.fillRect(s * 0.22, s * 0.46, s * 0.26, s * 0.22);             // body
        c.fillRect(s * 0.3, s * 0.66, s * 0.1, s * 0.12);               // grip
        for (const y of [0.4, 0.5, 0.6]) c.fillRect(s * 0.46, s * (y - 0.035), s * 0.34, s * 0.07);
        c.fillRect(s * 0.76, s * 0.34, s * 0.06, s * 0.32);             // muzzle ring
    } },
    Reverse: { color: '#a24aff', label: 'REVERSE!', icon: (c, s) => { // circular arrows
        c.lineWidth = s * 0.1; c.strokeStyle = c.fillStyle;
        c.beginPath(); c.arc(s * 0.5, s * 0.5, s * 0.2, 0.5, Math.PI * 1.7); c.stroke();
        c.beginPath(); c.moveTo(s * 0.5 + 0.2 * s * Math.cos(1.7 * Math.PI), s * 0.5 + 0.2 * s * Math.sin(1.7 * Math.PI));
        c.lineTo(s * 0.72, s * 0.34); c.lineTo(s * 0.64, s * 0.5); c.closePath(); c.fill();
    } },
};

export function makePowerupCanvas(type) {
    const s = 64;
    const meta = POWERUP_META[type] || POWERUP_META.SpeedBoost;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    // Round badge with glow ring
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(s / 2, s * 0.4, 2, s / 2, s / 2, s * 0.44);
    g.addColorStop(0, meta.color);
    g.addColorStop(1, shadeHex(meta.color, -60));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); ctx.stroke();
    // Icon
    ctx.fillStyle = '#ffffff';
    meta.icon(ctx, s);
    return c;
}

export function shadeHex(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return `rgb(${r},${g},${b})`;
}

// Small hard spark dot.
