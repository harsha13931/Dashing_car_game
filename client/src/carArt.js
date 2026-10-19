// ─── Shared Kenney car art for the lobby (showroom + thumbnails) ───────────
// Loads the sprite PNGs, builds a desaturated "neutral" version of each body
// variant, and produces tinted copies so the menu matches the in-match look.

export const CAR_VARIANT = {           // car type → Kenney body style (1-5)
    sports: 3, muscle: 1, truck: 4, rally: 5,
    kart: 2, suv: 4, drift: 3, supercar: 2,
};
export const CAR_COLOR = {             // factory paint per car type
    sports: '#1199dd', muscle: '#cc2244', truck: '#dd8800', rally: '#22aa44',
    kart: '#ccaa00', suv: '#00aaaa', drift: '#9944cc', supercar: '#cc5522',
};
export const TYPE_SIZE = {
    sports: 0.9, muscle: 1.1, truck: 1.4, rally: 0.95,
    kart: 0.7, suv: 1.2, drift: 0.95, supercar: 0.85,
};

const VARIANTS = [1, 2, 3, 4, 5];
const neutral = {};               // variant → canvas
const tintCache = {};             // `${variant}:${hex}` → canvas
let loaded = false;
const listeners = [];

function makeNeutral(img) {
    const w = img.width, h = img.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = Math.max(0, Math.min(255, luma * 1.25 + 60));
        d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(id, 0, 0);
    return c;
}

export function preloadCarArt(onReady) {
    if (loaded) { onReady && onReady(); return; }
    if (onReady) listeners.push(onReady);
    if (preloadCarArt._started) return;
    preloadCarArt._started = true;
    let pending = VARIANTS.length;
    for (const v of VARIANTS) {
        const img = new Image();
        img.onload = () => { neutral[v] = makeNeutral(img); if (--pending === 0) done(); };
        img.onerror = () => { if (--pending === 0) done(); };
        img.src = `/assets/game/cars/car_blue_${v}.png`;
    }
    function done() { loaded = true; listeners.splice(0).forEach(fn => fn()); }
}

export function isCarArtLoaded() { return loaded; }

// Returns a canvas of the car (variant) tinted to paintHex, or null if not ready.
export function tintedCar(variant, paintHex) {
    const n = neutral[variant];
    if (!n) return null;
    const key = `${variant}:${paintHex}`;
    if (tintCache[key]) return tintCache[key];
    const w = n.width, h = n.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(n, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = paintHex;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';   // clip to car silhouette
    ctx.drawImage(n, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    tintCache[key] = c;
    return c;
}
