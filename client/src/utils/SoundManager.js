// ─── Dash Arena audio ──────────────────────────────────────────────────────
// Everything is synthesised with Web Audio (no sample files): a speed-driven
// engine with gear changes, tyre squeal, layered crash sounds, race-start
// beeps and two looping music tracks (menu + race).

const SETTINGS_KEY = 'dasharena.settings';
const DEFAULT_SETTINGS = { sound: true, music: true, vibration: true };

export function loadSettings() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch (_) { return { ...DEFAULT_SETTINGS }; }
}

// Gear top speeds (px/s) used to fake an rpm curve with shifts
const GEARS = [120, 230, 350, 470, 620];
// Engine character per car type: base pitch multiplier + roughness
const ENGINE_VOICE = {
    sports: 1.0, muscle: 0.78, truck: 0.62, rally: 0.95,
    kart: 1.45, suv: 0.72, drift: 1.05, supercar: 1.2,
};

// Music: A minor progression (Am F C G), MIDI note numbers
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const BASS = [45, 41, 36, 43];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

class SoundManager {
    constructor() {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = AC ? new AC() : null;
        this.settings = loadSettings();
        if (!this.ctx) return;

        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        // Gentle limiter so big crashes don't clip
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
        this.master.connect(comp); comp.connect(this.ctx.destination);

        this.sfx = this.ctx.createGain();
        this.sfx.gain.value = this.settings.sound ? 1 : 0;
        this.sfx.connect(this.master);

        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = this.settings.music ? 0.32 : 0;
        this.musicBus.connect(this.master);

        // Short echo used to give UI / pickup sounds some space
        this.echo = this.ctx.createDelay(0.5);
        this.echo.delayTime.value = 0.16;
        const fb = this.ctx.createGain(); fb.gain.value = 0.28;
        const wet = this.ctx.createGain(); wet.gain.value = 0.25;
        this.echo.connect(fb); fb.connect(this.echo);
        this.echo.connect(wet); wet.connect(this.sfx);

        this.noiseBuf = this._makeNoise(2);
        this.engine = null;
        this.skid = null;
        this.music = null;
    }

    // ─── Settings ───────────────────────────────────────────────────────
    setSetting(key, value) {
        this.settings = { ...this.settings, [key]: value };
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (_) { /* ignore */ }
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        if (key === 'sound') this.sfx.gain.setTargetAtTime(value ? 1 : 0, t, 0.05);
        if (key === 'music') this.musicBus.gain.setTargetAtTime(value ? 0.32 : 0, t, 0.1);
    }

    vibrate(ms) {
        if (!this.settings.vibration || !navigator.vibrate) return;
        try { navigator.vibrate(ms); } catch (_) { /* ignore */ }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    _makeNoise(seconds) {
        const len = Math.floor(this.ctx.sampleRate * seconds);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    // One enveloped oscillator note
    _tone(freq, { type = 'sine', dur = 0.15, vol = 0.3, at = 0, glide = null, dest = null, attack = 0.005 } = {}) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime + at;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(dest || this.sfx);
        o.start(t); o.stop(t + dur + 0.05);
        return g;
    }

    // Filtered noise burst
    _noise({ dur = 0.2, vol = 0.4, at = 0, type = 'lowpass', freq = 1200, endFreq = null, q = 0.8, dest = null } = {}) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime + at;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const f = this.ctx.createBiquadFilter();
        f.type = type; f.Q.value = q;
        f.frequency.setValueAtTime(freq, t);
        if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(dest || this.sfx);
        src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    }

    // ─── Engine ─────────────────────────────────────────────────────────
    startEngine(carType = 'sports') {
        if (!this.ctx || this.engine) return;
        this.resume();
        const ctx = this.ctx, t = ctx.currentTime;
        const voice = ENGINE_VOICE[carType] || 1;
        const out = ctx.createGain(); out.gain.value = 0;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5; lp.frequency.value = 500;
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); }
        shaper.curve = curve;

        const mk = (type, mult, vol) => {
            const o = ctx.createOscillator(); o.type = type;
            const g = ctx.createGain(); g.gain.value = vol;
            o.connect(g); g.connect(shaper); o.start();
            return { o, mult };
        };
        const oscs = [mk('sawtooth', 1, 0.5), mk('sawtooth', 0.5, 0.6), mk('square', 2, 0.12), mk('sawtooth', 1.01, 0.3)];

        // Combustion "chug": amplitude wobble at firing frequency
        const am = ctx.createGain(); am.gain.value = 0.75;
        const lfo = ctx.createOscillator(); lfo.type = 'triangle';
        const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.25;
        lfo.connect(lfoDepth); lfoDepth.connect(am.gain); lfo.start();

        // Intake hiss that opens with the throttle
        const hiss = ctx.createBufferSource(); hiss.buffer = this.noiseBuf; hiss.loop = true;
        const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 900; hf.Q.value = 0.7;
        const hg = ctx.createGain(); hg.gain.value = 0;
        hiss.connect(hf); hf.connect(hg); hg.connect(out); hiss.start();

        shaper.connect(lp); lp.connect(am); am.connect(out); out.connect(this.sfx);
        out.gain.setTargetAtTime(0.16, t, 0.3);
        this.engine = { out, lp, oscs, lfo, hg, hiss, voice, rpm: 0.15, gear: 0, shiftUntil: 0 };
    }

    // speed px/s, throttle -1..1, boost bool
    updateEngine(speed, throttle, boost = false) {
        const e = this.engine;
        if (!e) return;
        const t = this.ctx.currentTime;
        let gear = 0;
        while (gear < GEARS.length - 1 && speed > GEARS[gear] * 0.96) gear++;
        const lo = gear === 0 ? 0 : GEARS[gear - 1] * 0.55;
        let rpm = Math.min(1, Math.max(0, (speed - lo) / (GEARS[gear] - lo)));
        rpm = 0.12 + rpm * 0.88;
        if (throttle > 0.1 && speed < 40) rpm = Math.max(rpm, 0.35);       // revving off the line
        if (gear !== e.gear) { e.shiftUntil = t + 0.12; e.gear = gear; }   // brief dip on a gear change
        if (t < e.shiftUntil) rpm *= 0.82;
        e.rpm += (rpm - e.rpm) * 0.35;

        const base = (38 + e.rpm * 120) * e.voice * (boost ? 1.12 : 1);
        for (const { o, mult } of e.oscs) o.frequency.setTargetAtTime(base * mult, t, 0.04);
        e.lfo.frequency.setTargetAtTime(base * 0.5, t, 0.04);
        const load = Math.max(0, throttle);
        e.lp.frequency.setTargetAtTime(350 + e.rpm * 1400 + load * 900 + (boost ? 800 : 0), t, 0.05);
        e.out.gain.setTargetAtTime(0.1 + load * 0.1 + e.rpm * 0.06, t, 0.06);
        e.hg.gain.setTargetAtTime(load * 0.05 + (boost ? 0.08 : 0), t, 0.08);
    }

    stopEngine() {
        const e = this.engine;
        if (!e) return;
        this.engine = null;
        const t = this.ctx.currentTime;
        e.out.gain.setTargetAtTime(0, t, 0.15);
        setTimeout(() => {
            e.oscs.forEach(({ o }) => { try { o.stop(); } catch (_) { /* ignore */ } });
            try { e.lfo.stop(); e.hiss.stop(); } catch (_) { /* ignore */ }
            e.out.disconnect();
        }, 900);
        this.setSkid(0);
    }

    // Tyre squeal, 0..1
    setSkid(amount) {
        if (!this.ctx) return;
        if (!this.skid && amount > 0) {
            const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
            const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 6;
            const bp2 = this.ctx.createBiquadFilter(); bp2.type = 'peaking'; bp2.frequency.value = 3200; bp2.gain.value = 8;
            const g = this.ctx.createGain(); g.gain.value = 0;
            src.connect(bp); bp.connect(bp2); bp2.connect(g); g.connect(this.sfx); src.start();
            this.skid = { src, g, bp };
        }
        if (!this.skid) return;
        const t = this.ctx.currentTime;
        this.skid.g.gain.setTargetAtTime(amount * 0.22, t, 0.06);
        this.skid.bp.frequency.setTargetAtTime(1800 + Math.random() * 600, t, 0.1);
    }

    // ─── Effects ────────────────────────────────────────────────────────
    playCrash(impact = 100, type = 'car') {
        if (!this.ctx) return;
        this.resume();
        const k = Math.min(1, impact / 600);
        // Body thump
        this._tone(95, { type: 'sine', dur: 0.28, vol: 0.35 + k * 0.5, glide: 38 });
        // Crunch
        this._noise({ dur: 0.18 + k * 0.25, vol: 0.25 + k * 0.5, freq: 700 + k * 2600, endFreq: 300, q: 0.9 });
        // Metal clank (inharmonic partials) — not for soft fence bumps
        if (type !== 'wall' || k > 0.4) {
            [287, 431, 643, 977].forEach((f, i) => this._tone(f * (0.9 + Math.random() * 0.2),
                { type: 'triangle', dur: 0.12 + k * 0.25, vol: (0.06 + k * 0.08) / (i + 1), at: 0.004 }));
        }
        if (type === 'projectile') this._noise({ dur: 0.12, vol: 0.3, type: 'highpass', freq: 2500 });
    }

    playPowerup() {
        [0, 4, 7, 12].forEach((s, i) => {
            const g = this._tone(midi(72 + s), { type: 'triangle', dur: 0.18, vol: 0.18, at: i * 0.06 });
            if (g) g.connect(this.echo);
        });
    }

    playElimination() {
        this._tone(220, { type: 'sawtooth', dur: 0.6, vol: 0.16, glide: 55 });
        this._noise({ dur: 0.6, vol: 0.3, freq: 1600, endFreq: 120 });
    }

    playClick() {
        this.resume();
        const g = this._tone(1100, { type: 'triangle', dur: 0.06, vol: 0.14, glide: 700 });
        if (g) g.connect(this.echo);
    }

    playShoot() {
        this._tone(900, { type: 'square', dur: 0.12, vol: 0.12, glide: 160 });
        this._noise({ dur: 0.1, vol: 0.2, type: 'highpass', freq: 1800 });
    }

    playDash() {
        // Nitro: rising whoosh + pop
        this._noise({ dur: 0.7, vol: 0.4, type: 'bandpass', freq: 400, endFreq: 3000, q: 1.2 });
        this._tone(70, { type: 'sine', dur: 0.2, vol: 0.4, glide: 140 });
        this.vibrate(40);
    }

    // Race-start lights: three low beeps, then a high GO
    playCountdown() { this._tone(440, { type: 'square', dur: 0.28, vol: 0.13, attack: 0.002 }); }
    playGo() {
        this._tone(880, { type: 'square', dur: 0.55, vol: 0.15, attack: 0.002 });
        this._tone(1320, { type: 'sine', dur: 0.55, vol: 0.08 });
    }

    playWin() {
        [[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79]].forEach((ch, i) =>
            ch.forEach(n => {
                const g = this._tone(midi(n), { type: 'triangle', dur: i === 3 ? 1.1 : 0.22, vol: 0.1, at: i * 0.18 });
                if (g) g.connect(this.echo);
            }));
    }

    playLose() {
        [64, 62, 59, 55].forEach((n, i) =>
            this._tone(midi(n), { type: 'triangle', dur: i === 3 ? 0.8 : 0.24, vol: 0.12, at: i * 0.2 }));
    }

    // Quick engine "blip" when browsing cars in the menu
    playRev(carType = 'sports') {
        const v = ENGINE_VOICE[carType] || 1;
        this._tone(55 * v, { type: 'sawtooth', dur: 0.45, vol: 0.09, glide: 150 * v, attack: 0.02 });
        this._tone(27 * v, { type: 'sawtooth', dur: 0.45, vol: 0.08, glide: 75 * v, attack: 0.02 });
    }

    playArenaWarning() {
        [0, 0.25].forEach(at => this._tone(660, { type: 'sawtooth', dur: 0.2, vol: 0.07, at, glide: 520 }));
    }

    // ─── Music (procedural, scheduled ahead with a look-ahead timer) ─────
    playMusic(kind = 'menu') {
        if (!this.ctx) return;
        if (this.music && this.music.kind === kind) return;
        this.stopMusic();
        this.resume();
        const bpm = kind === 'race' ? 124 : 96;
        const out = this.ctx.createGain();
        out.gain.value = 0;
        out.gain.setTargetAtTime(1, this.ctx.currentTime, 0.8);
        out.connect(this.musicBus);
        const m = { kind, out, step: 0, next: this.ctx.currentTime + 0.1, spb: 60 / bpm / 2 }; // 8th notes
        m.timer = setInterval(() => this._schedule(m), 50);
        this.music = m;
    }

    stopMusic() {
        const m = this.music;
        if (!m) return;
        this.music = null;
        clearInterval(m.timer);
        m.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
        setTimeout(() => m.out.disconnect(), 1500);
    }

    _schedule(m) {
        const ahead = this.ctx.currentTime + 0.25;
        while (m.next < ahead) {
            const s = m.step, at = m.next - this.ctx.currentTime;
            const bar = Math.floor(s / 8) % 4, beat = s % 8;
            const race = m.kind === 'race';
            const opt = (o) => ({ ...o, at, dest: m.out });

            // Pad chord at the start of each bar
            if (beat === 0) CHORDS[bar].forEach(n => {
                this._tone(midi(n), opt({ type: 'triangle', dur: m.spb * 8, vol: race ? 0.035 : 0.05, attack: 0.3 }));
                this._tone(midi(n) * 1.004, opt({ type: 'sawtooth', dur: m.spb * 8, vol: 0.012, attack: 0.4 }));
            });
            // Bass
            if (race || beat % 2 === 0) {
                const n = BASS[bar] + (race && beat % 4 === 3 ? 12 : 0);
                this._tone(midi(n), opt({ type: 'sawtooth', dur: m.spb * 0.9, vol: race ? 0.09 : 0.06 }));
            }
            // Arpeggio
            if (race ? beat % 1 === 0 : beat % 2 === 1) {
                const ch = CHORDS[bar];
                const n = ch[(s * (race ? 1 : 2)) % 3] + 12;
                this._tone(midi(n), opt({ type: 'square', dur: m.spb * 0.6, vol: race ? 0.022 : 0.018 }));
            }
            // Drums
            if (race) {
                if (beat % 4 === 0) this._tone(110, opt({ type: 'sine', dur: 0.22, vol: 0.32, glide: 40 }));
                if (beat % 4 === 2) this._noise(opt({ dur: 0.14, vol: 0.12, type: 'bandpass', freq: 1800, q: 0.7 }));
                this._noise(opt({ dur: 0.04, vol: beat % 2 ? 0.05 : 0.025, type: 'highpass', freq: 7000 }));
            } else if (beat % 2 === 1) {
                this._noise(opt({ dur: 0.03, vol: 0.02, type: 'highpass', freq: 8000 }));
            }
            m.step++;
            m.next += m.spb;
        }
    }
}

export const soundManager = new SoundManager();
