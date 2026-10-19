class SoundManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3;
        this.masterGain.connect(this.ctx.destination);
    }

    resume() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    playTone(freq, type, duration, startTime = 0) {
        this.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTime);
        gain.gain.setValueAtTime(1, this.ctx.currentTime + startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + startTime + duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(this.ctx.currentTime + startTime);
        osc.stop(this.ctx.currentTime + startTime + duration);
    }

    playCrash(intensity = 1) {
        this.resume();
        const bufferSize = this.ctx.sampleRate * 0.2;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const gain = this.ctx.createGain();
        gain.gain.value = Math.min(1, intensity / 200);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
        noise.connect(gain);
        gain.connect(this.masterGain);
        noise.start();
    }

    playPowerup() {
        this.playTone(440, 'sine', 0.1, 0);
        this.playTone(554, 'sine', 0.1, 0.1);
        this.playTone(659, 'sine', 0.2, 0.2);
    }

    playElimination() {
        this.playTone(150, 'sawtooth', 0.5);
        this.playTone(100, 'sawtooth', 0.5, 0.1);
    }

    playClick() {
        this.playTone(800, 'sine', 0.05);
    }

    playShoot() {
        this.playTone(200, 'sawtooth', 0.08);
        this.playTone(400, 'square', 0.06, 0.02);
    }

    playDash() {
        this.playTone(120, 'sawtooth', 0.15);
        this.playTone(180, 'square', 0.1, 0.05);
    }

    playCountdown() {
        this.playTone(600, 'square', 0.1);
    }

    playGo() {
        this.playTone(800, 'square', 0.12);
        this.playTone(1000, 'square', 0.15, 0.12);
    }

    playWin() {
        this.playTone(523.25, 'square', 0.2, 0);
        this.playTone(523.25, 'square', 0.2, 0.2);
        this.playTone(523.25, 'square', 0.2, 0.4);
        this.playTone(659.25, 'square', 0.6, 0.6);
    }

    playLose() {
        this.playTone(300, 'sawtooth', 0.3, 0);
        this.playTone(220, 'sawtooth', 0.3, 0.2);
        this.playTone(150, 'sawtooth', 0.5, 0.4);
    }
}

export const soundManager = new SoundManager();
