import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar, disposeCar } from './carModel';

// ─── Menu showroom: the real 3D car on a spinning turntable ───────────────
// One small WebGL view; swapping cars or paint reuses it. Drag to spin.

export default function Showroom3D({ carKey, cos, height = 215 }) {
    const ref = useRef(null);
    const api = useRef(null);

    useEffect(() => {
        const el = ref.current;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.setClearColor(0x000000, 0);
        el.appendChild(renderer.domElement);
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.touchAction = 'pan-y';

        const scene = new THREE.Scene();
        const pmrem = new THREE.PMREMGenerator(renderer);
        const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
        scene.environment = env;
        scene.environmentIntensity = 0.45;
        scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a3346, 1.1));
        const key = new THREE.DirectionalLight(0xffe2b8, 2.6);
        key.position.set(-90, 200, 120);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        Object.assign(key.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 10, far: 500 });
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x8fb8ff, 1.2);
        rim.position.set(120, 80, -140);
        scene.add(rim);

        // turntable with a glowing edge
        const table = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(78, 82, 6, 64), new THREE.MeshStandardMaterial({ color: 0x1b2232, roughness: 0.35, metalness: 0.6 }));
        disc.position.y = -3; disc.receiveShadow = true;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(80, 1.6, 8, 96), new THREE.MeshBasicMaterial({ color: 0xffb030 }));
        ring.rotation.x = Math.PI / 2; ring.position.y = 0.2;
        const inner = new THREE.Mesh(new THREE.TorusGeometry(62, 0.7, 6, 96), new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0.45 }));
        inner.rotation.x = Math.PI / 2; inner.position.y = 0.3;
        table.add(disc, ring, inner);
        scene.add(table);
        const spin = new THREE.Group();
        scene.add(spin);

        const camera = new THREE.PerspectiveCamera(28, 1, 10, 2000);
        let car = null, angle = -0.6, drag = null, vel = 0.25, raf;

        const resize = () => {
            const w = el.clientWidth || 400, h = el.clientHeight || height;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            // keep the whole car in view whatever the box shape
            const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
            const d = Math.max(100 * 0.75 / t, 96 / (t * camera.aspect));
            camera.position.set(0, d * 0.42, d * 0.9);
            camera.lookAt(0, 10, 0);
            camera.updateProjectionMatrix();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        resize();

        const onDown = (e) => { drag = { x: e.clientX, a: angle }; vel = 0; };
        const onMove = (e) => { if (drag) { const na = drag.a + (e.clientX - drag.x) * 0.012; vel = (na - angle) * 60; angle = na; } };
        const onUp = () => { drag = null; if (Math.abs(vel) < 0.1) vel = 0.25; };
        el.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);

        let last = performance.now();
        const loop = (t) => {
            raf = requestAnimationFrame(loop);
            const dt = Math.min(0.05, (t - last) / 1000); last = t;
            if (!drag) { vel += (0.25 - vel) * Math.min(1, dt * 1.5); angle += vel * dt; }
            spin.rotation.y = angle;
            table.rotation.y = angle;
            if (car) for (const w of car.wheels) w.userData.spin.rotation.z -= dt * 0.6;
            if (car && car.topper && car.topper.userData.spinner) car.topper.userData.spinner.rotation.y += dt * 12;
            renderer.render(scene, camera);
        };
        raf = requestAnimationFrame(loop);

        api.current = {
            setCar(type, look) {
                if (car) { spin.remove(car.group); disposeCar(car); }
                car = buildCar(type, look || {}, env);
                car.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
                car.group.scale.setScalar(1.35);
                spin.add(car.group);
            },
        };
        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            el.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            if (car) { spin.remove(car.group); disposeCar(car); }
            scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
            env.dispose();
            renderer.dispose();
            renderer.domElement.remove();
            api.current = null;
        };
    }, []);

    const cosKey = JSON.stringify(cos || {});
    useEffect(() => { if (api.current) api.current.setCar(carKey, cos); }, [carKey, cosKey]);

    return <div ref={ref} style={{ width: '100%', height, cursor: 'grab' }} />;
}
