import React, { useEffect, useRef, useState } from 'react';
import { socket } from '../net/socket';
import { soundManager } from '../utils/SoundManager';
import { renderCar } from '../carRender';

// ─── Loading / title screen ────────────────────────────────────────────────
// Loads the car art and wakes the server while a car drifts around the logo,
// then waits for a tap (which also lets us go fullscreen and unlock audio).

const WAKE_HINT_MS = 4000;     // after this, explain the free server is waking up
const MAX_WAIT_MS = 9000;      // never block the menu longer than this

function DriftCanvas() {
    const ref = useRef(null);
    useEffect(() => {
        const cv = ref.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        const img = renderCar('sports', { paint: 'red', finish: 'metallic', decal: 'stripes', decalColor: 'white', spoiler: 'wing' }, { res: 0.6 });
        const trail = [];
        let raf, t = 0, last = performance.now();

        const frame = (now) => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            t += dt;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const W = cv.clientWidth, H = cv.clientHeight;
            if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);

            // Car drifts around an ellipse, body angled into the slide
            const rx = Math.min(W * 0.4, 260), ry = Math.min(H * 0.32, 110);
            const a = t * 1.5;
            const x = W / 2 + Math.cos(a) * rx, y = H / 2 + Math.sin(a) * ry;
            const heading = Math.atan2(Math.cos(a) * ry, -Math.sin(a) * rx);
            const body = heading + 0.45;

            // Skid marks from the rear tyres
            const back = 22;
            const bx = x - Math.cos(body) * back, by = y - Math.sin(body) * back;
            const px = -Math.sin(body) * 12, py = Math.cos(body) * 12;
            trail.push({ l: [bx + px, by + py], r: [bx - px, by - py], life: 1 });
            if (trail.length > 140) trail.shift();
            ctx.lineWidth = 5;
            for (let i = 1; i < trail.length; i++) {
                const p = trail[i - 1], q = trail[i];
                q.life -= dt * 0.35;
                if (q.life <= 0) continue;
                ctx.strokeStyle = `rgba(0,0,0,${0.35 * q.life})`;
                ctx.beginPath(); ctx.moveTo(p.l[0], p.l[1]); ctx.lineTo(q.l[0], q.l[1]); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(p.r[0], p.r[1]); ctx.lineTo(q.r[0], q.r[1]); ctx.stroke();
            }

            // Tyre smoke
            for (let i = 0; i < 2; i++) {
                const s = 8 + Math.random() * 14;
                ctx.fillStyle = `rgba(200,200,210,${0.05 + Math.random() * 0.06})`;
                ctx.beginPath();
                ctx.arc(bx + (Math.random() - 0.5) * 22, by + (Math.random() - 0.5) * 22, s, 0, Math.PI * 2);
                ctx.fill();
            }

            {
                const L = 70, Wd = L * img.width / img.height;
                ctx.save();
                ctx.translate(x + 4, y + 6);
                ctx.rotate(body + Math.PI / 2);
                ctx.globalAlpha = 0.35;
                ctx.filter = 'brightness(0)';
                ctx.drawImage(img, -Wd / 2, -L / 2, Wd, L);
                ctx.restore();
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(body + Math.PI / 2);
                ctx.drawImage(img, -Wd / 2, -L / 2, Wd, L);
                ctx.restore();
            }
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, []);
    return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}

export default function Splash({ connected, onDone }) {
    const [artReady, setArtReady] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [shown, setShown] = useState(0);   // displayed progress, eased

    useEffect(() => { setArtReady(true); }, []);   // cars are drawn in code — nothing to download
    useEffect(() => {
        const start = Date.now();
        const id = setInterval(() => setElapsed(Date.now() - start), 100);
        return () => clearInterval(id);
    }, []);

    const target = Math.min(100,
        (artReady ? 45 : Math.min(40, elapsed / 30)) +
        (connected ? 55 : Math.min(45, elapsed / 200)));
    useEffect(() => {
        const id = setTimeout(() => setShown(s => s + (target - s) * 0.35), 60);
        return () => clearTimeout(id);
    }, [shown, target]);

    const ready = artReady && (connected || elapsed > MAX_WAIT_MS) && elapsed > 1200;
    const status = !artReady ? 'Loading cars…'
        : connected ? 'Engines warm — ready!'
        : elapsed > WAKE_HINT_MS ? 'Waking up the server… (free hosting can take up to a minute)'
        : 'Connecting to arena…';

    const start = () => {
        if (!ready) return;
        soundManager.resume();
        soundManager.playClick();
        const el = document.documentElement;
        // Fullscreen + lock to landscape (Android). iPhones can't lock from a
        // web page, so App shows a "rotate your phone" screen in portrait.
        const lockLandscape = () => {
            try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch (_) { /* ignore */ }
        };
        try {
            const req = el.requestFullscreen || el.webkitRequestFullscreen;
            if (req && !document.fullscreenElement) {
                const p = req.call(el, { navigationUI: 'hide' });
                if (p && p.then) p.then(lockLandscape).catch(() => {});
                else lockLandscape();
            } else lockLandscape();
        } catch (_) { /* not supported (e.g. iPhone) */ }
        if (!socket.connected) socket.connect();
        onDone();
    };

    return (
        <div className="full-screen" onClick={start} style={{
            background: 'radial-gradient(ellipse at 50% 40%, #1b2230 0%, #0a0d13 70%)',
            cursor: ready ? 'pointer' : 'default', overflow: 'hidden',
        }}>
            <DriftCanvas />
            <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none',
                padding: '0 16px', textAlign: 'center',
            }}>
                <div style={{ fontSize: 'clamp(0.7rem, 2.6vw, 0.9rem)', letterSpacing: 6, color: '#8899aa', fontWeight: 700 }}>
                    MULTIPLAYER CAR BATTLE
                </div>
                <h1 style={{
                    fontSize: 'clamp(2.6rem, 11vw, 5.5rem)', fontWeight: 900, fontStyle: 'italic',
                    letterSpacing: 2, color: '#e8a030', lineHeight: 1,
                    textShadow: '0 4px 0 #7a4a08, 0 0 40px rgba(232,160,48,0.45)',
                }}>DASH ARENA</h1>

                <div style={{ width: 'min(320px, 80vw)', marginTop: 'clamp(70px, 22vh, 160px)' }}>
                    {!ready ? (
                        <>
                            <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                <div style={{
                                    width: `${Math.max(4, shown)}%`, height: '100%', borderRadius: 4,
                                    background: 'linear-gradient(90deg, #c08020, #ffcf6a)',
                                    boxShadow: '0 0 12px rgba(232,160,48,0.6)', transition: 'width 0.1s linear',
                                }} />
                            </div>
                            <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#9ab' }}>{status}</div>
                        </>
                    ) : (
                        <div style={{
                            fontSize: 'clamp(1.2rem, 5vw, 1.6rem)', fontWeight: 900, letterSpacing: 4, color: '#fff',
                            animation: 'tapPulse 1.2s ease-in-out infinite', textShadow: '0 0 20px rgba(232,160,48,0.7)',
                        }}>TAP TO PLAY</div>
                    )}
                </div>
            </div>
            <div style={{
                position: 'absolute', bottom: 'max(10px, env(safe-area-inset-bottom))', left: 0, right: 0,
                textAlign: 'center', fontSize: '0.65rem', color: '#556', pointerEvents: 'none',
            }}>Landscape game · Best with sound on</div>
        </div>
    );
}
