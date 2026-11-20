class SoundEffects {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
  }

  _ensureCtx() {
    if (this.muted) return null;
    if (typeof globalThis === 'undefined') return null;
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _tone({ freq = 440, endFreq = null, duration = 0.08, type = 'sine', gain = 0.08, delay = 0 }) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), now + duration);
    }
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.linearRampToValueAtTime(gain, now + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playMove() {
    this._tone({ freq: 290, endFreq: 220, duration: 0.035, type: 'triangle', gain: 0.035 });
  }

  playWarp() {
    this._tone({ freq: 340, endFreq: 680, duration: 0.09, type: 'sine', gain: 0.06 });
  }

  playGem(combo = 1) {
    const base = 523.25 * Math.pow(1.06, Math.min(combo - 1, 10));
    this._tone({ freq: base, endFreq: base * 1.25, duration: 0.1, type: 'triangle', gain: 0.09 });
    this._tone({ freq: base * 1.5, endFreq: base * 1.8, duration: 0.11, type: 'sine', gain: 0.06, delay: 0.045 });
  }

  playSlash() {
    this._tone({ freq: 720, endFreq: 180, duration: 0.09, type: 'sawtooth', gain: 0.055 });
  }

  playZap() {
    this._tone({ freq: 180, endFreq: 75, duration: 0.16, type: 'sawtooth', gain: 0.09 });
    this._tone({ freq: 140, endFreq: 60, duration: 0.16, type: 'square', gain: 0.05, delay: 0.02 });
  }

  playBump() {
    this._tone({ freq: 150, endFreq: 95, duration: 0.06, type: 'square', gain: 0.045 });
  }

  playTick() {
    this._tone({ freq: 880, endFreq: 880, duration: 0.03, type: 'sine', gain: 0.03 });
  }

  playVictory() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this._tone({ freq: n, duration: 0.16, type: 'triangle', gain: 0.08, delay: idx * 0.075 });
    });
  }

  playFail() {
    const notes = [330, 261.63, 196];
    notes.forEach((n, idx) => {
      this._tone({ freq: n, duration: 0.18, type: 'sawtooth', gain: 0.06, delay: idx * 0.1 });
    });
  }
}

export const sfx = new SoundEffects();
