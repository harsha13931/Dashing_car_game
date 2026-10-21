// ─── Graphics quality: Auto (drops to Low if the phone struggles), High, Low ──
const KEY = 'dasharena.gfx';
let autoLow = false;

export function gfxSetting() {
    try { return localStorage.getItem(KEY) || 'auto'; } catch (_) { return 'auto'; }
}
export function setGfxSetting(v) {
    try { localStorage.setItem(KEY, v); } catch (_) { /* ignore */ }
    if (v !== 'auto') autoLow = false;
}
export const isLowGfx = () => gfxSetting() === 'low' || (gfxSetting() === 'auto' && autoLow);

// Called by the renderer when frame rate stays low in Auto mode
export function switchToLowAuto() {
    if (autoLow || gfxSetting() !== 'auto') return;
    autoLow = true;
    try { localStorage.setItem(KEY + '.autolow', '1'); } catch (_) { /* ignore */ }
    window.dispatchEvent(new CustomEvent('dash-gfx-low'));
}
// Remember a slow device between sessions
try { autoLow = localStorage.getItem(KEY + '.autolow') === '1'; } catch (_) { /* ignore */ }
