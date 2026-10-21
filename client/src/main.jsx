import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { registerPWA } from './pwa'

registerPWA()

// Size the game to the part of the screen you can actually see. On some phones
// 100dvh still includes area hidden behind browser bars, cutting off the bottom.
function fitViewport() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
    document.documentElement.style.setProperty('--app-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);
}
fitViewport();
window.addEventListener('resize', fitViewport);
window.addEventListener('orientationchange', () => setTimeout(fitViewport, 300));
window.visualViewport?.addEventListener('resize', fitViewport);
window.visualViewport?.addEventListener('scroll', fitViewport);
document.addEventListener('fullscreenchange', () => setTimeout(fitViewport, 200));

createRoot(document.getElementById('root')).render(<App />)
