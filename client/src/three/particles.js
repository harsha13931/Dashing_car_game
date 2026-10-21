import * as THREE from 'three';

// ─── Pooled GPU particles ──────────────────────────────────────────────────
// One THREE.Points per blend mode; particles are recycled from a ring buffer,
// so explosions never allocate. Each particle: position, velocity, life,
// size (start → end), colour (start → end), alpha (start → end), gravity, drag.

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
}`;

function softDot() {
    const s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.45, 'rgba(255,255,255,0.65)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
}

export class Particles {
    constructor(scene, { max = 1500, additive = false } = {}) {
        this.max = max;
        this.next = 0;
        this.alive = 0;
        const geo = new THREE.BufferGeometry();
        this.pos = new Float32Array(max * 3);
        this.col = new Float32Array(max * 3);
        this.size = new Float32Array(max);
        this.alpha = new Float32Array(max);
        geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.geo = geo;
        // per-particle simulation state
        this.v = new Float32Array(max * 3);
        this.life = new Float32Array(max);
        this.age = new Float32Array(max);
        this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
        this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
        this.a0 = new Float32Array(max); this.a1 = new Float32Array(max);
        this.grav = new Float32Array(max); this.drag = new Float32Array(max);
        this.mat = new THREE.ShaderMaterial({
            vertexShader: VERT, fragmentShader: FRAG,
            uniforms: { uMap: { value: softDot() }, uScale: { value: 600 } },
            transparent: true, depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        this.points = new THREE.Points(geo, this.mat);
        this.points.frustumCulled = false;
        this.points.renderOrder = additive ? 20 : 19;
        scene.add(this.points);
    }

    // o: { x, y, z, vx, vy, vz, spread, life, size:[a,b], color:[hex,hex], alpha:[a,b], gravity, drag, count }
    emit(o) {
        const n = o.count || 1;
        const c0 = new THREE.Color(o.color ? o.color[0] : 0xffffff), c1 = new THREE.Color(o.color ? o.color[1] ?? o.color[0] : 0xffffff);
        for (let k = 0; k < n; k++) {
            const i = this.next;
            this.next = (this.next + 1) % this.max;
            const sp = o.spread || 0;
            const ang = Math.random() * Math.PI * 2, up = (o.up ?? 0.5);
            const r = sp * (0.4 + Math.random() * 0.6);
            this.pos[i * 3] = o.x + (Math.random() - 0.5) * (o.jitter || 0);
            this.pos[i * 3 + 1] = o.y || 0;
            this.pos[i * 3 + 2] = o.z + (Math.random() - 0.5) * (o.jitter || 0);
            this.v[i * 3] = (o.vx || 0) + Math.cos(ang) * r;
            this.v[i * 3 + 1] = (o.vy || 0) + (Math.random() * up + (1 - up) * 0.5) * sp * (o.upScale ?? 1);
            this.v[i * 3 + 2] = (o.vz || 0) + Math.sin(ang) * r;
            this.life[i] = (o.life || 0.6) * (0.7 + Math.random() * 0.6);
            this.age[i] = 0;
            this.s0[i] = o.size ? o.size[0] : 10; this.s1[i] = o.size ? o.size[1] ?? o.size[0] : 10;
            this.c0[i * 3] = c0.r; this.c0[i * 3 + 1] = c0.g; this.c0[i * 3 + 2] = c0.b;
            this.c1[i * 3] = c1.r; this.c1[i * 3 + 1] = c1.g; this.c1[i * 3 + 2] = c1.b;
            this.a0[i] = o.alpha ? o.alpha[0] : 1; this.a1[i] = o.alpha ? o.alpha[1] ?? 0 : 0;
            this.grav[i] = o.gravity || 0;
            this.drag[i] = o.drag ?? 1.5;
        }
    }

    update(dt, scaleUniform) {
        if (scaleUniform) this.mat.uniforms.uScale.value = scaleUniform;
        for (let i = 0; i < this.max; i++) {
            if (this.age[i] >= this.life[i]) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
            this.age[i] += dt;
            const t = Math.min(1, this.age[i] / this.life[i]);
            const d = Math.exp(-this.drag[i] * dt);
            this.v[i * 3] *= d; this.v[i * 3 + 2] *= d;
            this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.grav[i] * dt;
            this.pos[i * 3] += this.v[i * 3] * dt;
            this.pos[i * 3 + 1] = Math.max(0.5, this.pos[i * 3 + 1] + this.v[i * 3 + 1] * dt);
            this.pos[i * 3 + 2] += this.v[i * 3 + 2] * dt;
            this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
            this.alpha[i] = this.a0[i] + (this.a1[i] - this.a0[i]) * t;
            this.col[i * 3] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * t;
            this.col[i * 3 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * t;
            this.col[i * 3 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * t;
        }
        const a = this.geo.attributes;
        a.position.needsUpdate = true; a.aColor.needsUpdate = true; a.aSize.needsUpdate = true; a.aAlpha.needsUpdate = true;
    }

    dispose() {
        this.points.parent && this.points.parent.remove(this.points);
        this.geo.dispose(); this.mat.uniforms.uMap.value.dispose(); this.mat.dispose();
    }
}
