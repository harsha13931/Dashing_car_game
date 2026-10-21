import { useEffect, useState } from 'react';

// ─── Installable app (PWA) ───────────────────────────────────────────────
// Android/desktop Chrome hand us an install prompt we can trigger from our own
// button; iPhones can only install via Share → Add to Home Screen, so for
// those we show the steps instead.

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

export const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function registerPWA() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferred = e;
        notify();
    });
    window.addEventListener('appinstalled', () => { deferred = null; notify(); });
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
        window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }
}

export async function promptInstall() {
    if (!deferred) return false;
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferred = null;
    notify();
    return outcome === 'accepted';
}

// { canPrompt, showIOSSteps, installed }
export function useInstall() {
    const [, force] = useState(0);
    useEffect(() => {
        const fn = () => force(n => n + 1);
        listeners.add(fn);
        return () => listeners.delete(fn);
    }, []);
    const installed = isStandalone();
    return { canPrompt: !installed && !!deferred, showIOSSteps: !installed && !deferred && isIOS(), installed };
}
