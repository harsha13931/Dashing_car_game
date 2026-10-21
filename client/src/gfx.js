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

// ─── View: the 3D arena (default) or the classic flat 2D one ──────────────
export function viewSetting() {
    try { return localStorage.getItem('dasharena.view') || '3d'; } catch (_) { return '3d'; }
}
export function setViewSetting(v) {
    try { localStorage.setItem('dasharena.view', v); } catch (_) { /* ignore */ }
}
export function webglOK() {
    try {
        const c = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (_) { return false; }
}
