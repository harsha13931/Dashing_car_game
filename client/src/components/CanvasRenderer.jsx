import React, { useRef, useEffect } from 'react';

const ARENA_RADIUS = 1000;

function lerp(a, b, t) { return a + (b - a) * t; }

export default function CanvasRenderer({ snapshot, localId }) {
    const cvsRef = useRef();
    const prevRef = useRef({ players: [], powerups: [], time: Date.now() });
    const cameraRef = useRef({ x: 0, y: 0 }); // Store camera position for smoothing

    useEffect(() => {
        const cvs = cvsRef.current;
        const ctx = cvs.getContext('2d');
        let raf;

        function resize() {
            const DPR = window.devicePixelRatio || 1;
            cvs.width = window.innerWidth * DPR;
            cvs.height = window.innerHeight * DPR;
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        }
        window.addEventListener('resize', resize);
        resize();

        function draw() {
            ctx.clearRect(0, 0, cvs.width, cvs.height);

            // Interpolation factor
            const prev = prevRef.current;
            const now = Date.now();
            const elapsed = Math.min(200, now - prev.time);
            const t = Math.min(1, elapsed / Math.max(1, (snapshot.timestamp - prev.time || 50)));

            // Calculate interpolated positions for all players
            const players = (snapshot.players || []).map(sp => {
                const pr = prev.players.find(pp => pp.id === sp.id) || sp;
                // Handle angle wrapping for smooth rotation
                let ang = sp.angle;
                if (Math.abs(ang - pr.angle) > Math.PI) {
                    if (ang > pr.angle) ang -= Math.PI * 2;
                    else ang += Math.PI * 2;
                }
                return {
                    ...sp,
                    ix: lerp(pr.x, sp.x, t),
                    iy: lerp(pr.y, sp.y, t),
                    ia: lerp(pr.angle, ang, t),
                    iscale: lerp(pr.scale || 1, sp.scale || 1, t)
                };
            });

            // --- Camera Logic ---
            let target = players.find(p => p.id === localId);
            let spectating = false;

            // If local player is dead or missing, spectate first alive player
            if (!target || !target.alive) {
                const alivePlayer = players.find(p => p.alive);
                if (alivePlayer) {
                    target = alivePlayer;
                    spectating = true;
                } else if (!target && players.length > 0) {
                    // Fallback if everyone is dead or I'm not in list yet
                    target = players[0];
                    spectating = true;
                }
            }

            const tx = target ? target.ix : 0;
            const ty = target ? target.iy : 0;

            // Smooth camera movement (Lerp)
            // 0.1 factor gives a nice smooth follow, reducing jitter
            cameraRef.current.x = lerp(cameraRef.current.x, tx, 0.1);
            cameraRef.current.y = lerp(cameraRef.current.y, ty, 0.1);

            const camX = cameraRef.current.x;
            const camY = cameraRef.current.y;

            ctx.save();
            // Center camera on screen
            ctx.translate(window.innerWidth / 2, window.innerHeight / 2);
            // Move world opposite to camera position
            ctx.translate(-camX, -camY);

            // --- Draw World ---

            // Infinite Grid Effect
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.03)';
            ctx.lineWidth = 1;
            const gridSize = 100;
            const startX = Math.floor((camX - window.innerWidth / 2) / gridSize) * gridSize;
            const startY = Math.floor((camY - window.innerHeight / 2) / gridSize) * gridSize;
            const endX = startX + window.innerWidth + gridSize * 2;
            const endY = startY + window.innerHeight + gridSize * 2;

            ctx.beginPath();
            for (let x = startX; x < endX; x += gridSize) {
                ctx.moveTo(x, startY);
                ctx.lineTo(x, endY);
            }
            for (let y = startY; y < endY; y += gridSize) {
                ctx.moveTo(startX, y);
                ctx.lineTo(endX, y);
            }
            ctx.stroke();
            ctx.restore();

            // Arena Boundary
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = '#0f1724';
            ctx.fill();
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#00f0ff';
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#00f0ff';
            ctx.stroke();
            ctx.restore();

            // Arena Grid (clipped inside)
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
            ctx.clip();
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
            ctx.lineWidth = 2;
            for (let i = -ARENA_RADIUS; i < ARENA_RADIUS; i += 100) {
                ctx.beginPath(); ctx.moveTo(i, -ARENA_RADIUS); ctx.lineTo(i, ARENA_RADIUS); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-ARENA_RADIUS, i); ctx.lineTo(ARENA_RADIUS, i); ctx.stroke();
            }
            ctx.restore();

            // Powerups
            (snapshot.powerups || []).forEach(p => {
                ctx.save();
                ctx.translate(p.x, p.y);
                const pulse = 1 + Math.sin(Date.now() / 200) * 0.2;
                ctx.scale(pulse, pulse);
                ctx.shadowBlur = 15;

                let color = 'gold';
                let label = '?';
                if (p.type === 'SpeedBoost') { color = '#00ff00'; label = '⚡'; }
                if (p.type === 'Shield') { color = '#00f0ff'; label = '🛡️'; }
                if (p.type === 'MegaPush') { color = '#ff0055'; label = '💪'; }
                if (p.type === 'Oil') { color = '#555'; label = '🛢️'; }
                if (p.type === 'Reverse') { color = '#aa00ff'; label = '😵'; }

                ctx.shadowColor = color;
                ctx.beginPath();
                ctx.arc(0, 0, 15, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();

                ctx.fillStyle = 'white';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, 0, 0);
                ctx.restore();
            });

            // Projectiles
            (snapshot.projectiles || []).forEach(proj => {
                ctx.save();
                ctx.translate(proj.x, proj.y);

                // Cannonball look
                ctx.beginPath();
                ctx.arc(0, 0, 8, 0, Math.PI * 2);
                ctx.fillStyle = '#111';
                ctx.fill();

                // Shine
                ctx.beginPath();
                ctx.arc(-2, -2, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#555';
                ctx.fill();

                // Glow/Trail
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#ff5500';
                ctx.restore();
            });

            // Players
            players.forEach(p => {
                ctx.save();
                ctx.translate(p.ix, p.iy);
                ctx.rotate(p.ia);

                const scale = p.iscale || 1;
                ctx.scale(scale, scale);

                const isMe = p.id === localId;
                const color = p.alive ? (isMe ? '#00f0ff' : '#ff0055') : '#333';
                const glow = p.alive ? (isMe ? 'rgba(0, 240, 255, 0.6)' : 'rgba(255, 0, 85, 0.6)') : 'transparent';

                if (p.shield) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(0, 0, 25, 0, Math.PI * 2);
                    ctx.strokeStyle = '#00f0ff';
                    ctx.lineWidth = 2;
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = '#00f0ff';
                    ctx.stroke();
                    ctx.restore();
                }

                if (p.alive) {
                    ctx.save();
                    ctx.globalCompositeOperation = 'screen';
                    ctx.shadowBlur = 20;
                    const trailColor = p.isDashing ? '#ffaa00' : '#00f0ff';
                    ctx.shadowColor = trailColor;
                    ctx.fillStyle = p.isDashing ? 'rgba(255, 170, 0, 0.6)' : 'rgba(0, 240, 255, 0.5)';

                    ctx.beginPath();
                    const trailLen = p.isDashing ? 40 : 25;
                    ctx.moveTo(-12, -4);
                    ctx.lineTo(-trailLen - Math.random() * 10, 0);
                    ctx.lineTo(-12, 4);
                    ctx.fill();
                    ctx.restore();
                }

                ctx.shadowBlur = 15;
                ctx.shadowColor = glow;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(12, 0);
                ctx.lineTo(8, -8);
                ctx.lineTo(-8, -8);
                ctx.lineTo(-12, -5);
                ctx.lineTo(-12, 5);
                ctx.lineTo(-8, 8);
                ctx.lineTo(8, 8);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.beginPath();
                ctx.moveTo(2, 0);
                ctx.lineTo(-2, -4);
                ctx.lineTo(-6, -4);
                ctx.lineTo(-6, 4);
                ctx.lineTo(-2, 4);
                ctx.closePath();
                ctx.fill();

                ctx.shadowBlur = 5;
                ctx.fillStyle = '#222';
                ctx.fillRect(-8, -11, 6, 3);
                ctx.fillRect(-8, 8, 6, 3);
                ctx.fillRect(6, -11, 6, 3);
                ctx.fillRect(6, 8, 6, 3);

                ctx.save();
                ctx.scale(1 / scale, 1 / scale);
                ctx.rotate(-p.ia);
                ctx.fillStyle = 'white';
                ctx.font = '12px Inter';
                ctx.textAlign = 'center';
                ctx.fillText(isMe ? 'YOU' : p.name || p.id.slice(0, 4), 0, -25 * scale);
                ctx.restore();

                ctx.restore();
            });

            ctx.restore(); // End camera transform

            // Spectator Overlay
            if (spectating && target) {
                ctx.save();
                ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                ctx.font = 'bold 20px Inter';
                ctx.textAlign = 'center';
                ctx.fillText(`SPECTATING: ${target.name || target.id.slice(0, 4)}`, cvs.width / 2, cvs.height - 100);
                ctx.restore();
            }

            raf = requestAnimationFrame(draw);
        }

        draw();

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
        }
    }, [snapshot, localId]);

    useEffect(() => {
        prevRef.current = { players: snapshot.players || [], powerups: snapshot.powerups || [], time: snapshot.timestamp || Date.now() };
    }, [snapshot]);

    return <canvas ref={cvsRef} className="full-screen" />;
}
