/* ==========================================================================
   3D FORTRIS - WEB AUDIO SYNTHESIZER (no audio files: fully offline)
   Engine from 3D Labyrinth / 3D Tunnel Rush; the sounds are Fortris's own.
   ========================================================================== */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicTimer = null;
    this.level = 1;
    this.lastMove = 0;
  }

  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { this.ctx = new AC(); } catch (e) { console.warn('[Audio] unavailable:', e.message); } }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) this.stopMusic();
    return this.muted;
  }

  ok() { return !this.muted && this.ensureContext(); }

  tone(freq, dur, { type = 'sine', vol = 0.15, at = 0, slideTo = null } = {}) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.2, at = 0, from = 1800, to = 120 } = {}) {
    const c = this.ctx, t = c.currentTime + at, len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t);
  }

  /** Throttled so a held key doesn't buzz. */
  playMove() {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    if (now - this.lastMove < 0.04) return;
    this.lastMove = now;
    this.tone(660, 0.04, { type: 'triangle', vol: 0.06 });
  }

  playBump() { if (this.ok()) this.tone(140, 0.07, { type: 'square', vol: 0.05 }); }
  playRotate() { if (this.ok()) this.tone(520, 0.07, { type: 'triangle', vol: 0.08, slideTo: 880 }); }
  playRelease() { if (this.ok()) this.tone(880, 0.18, { type: 'sine', vol: 0.08, slideTo: 330 }); }

  playLock() {
    if (!this.ok()) return;
    this.tone(180, 0.12, { type: 'triangle', vol: 0.2, slideTo: 90 });
    this.noise(0.08, { vol: 0.08, from: 900, to: 200 });
  }

  playHardDrop(distance) {
    if (!this.ok()) return;
    this.noise(0.12 + Math.min(distance, 18) * 0.008, { vol: 0.12, from: 2400, to: 300 });
  }

  /** More layers = a longer, brighter run. */
  playClear(count) {
    if (!this.ok()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093];
    notes.slice(0, 2 + count).forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', vol: 0.15, at: i * 0.06 }));
    this.tone(2093, 0.5, { type: 'sine', vol: 0.05, at: 0.1 });
  }

  playBomb() {
    if (!this.ok()) return;
    this.noise(0.7, { vol: 0.35, from: 3000, to: 60 });
    this.tone(90, 0.6, { type: 'sine', vol: 0.3, slideTo: 35 });
  }

  playLevelUp() {
    if (!this.ok()) return;
    [659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.12, at: 0.2 + i * 0.07 }));
    this.tone(2093, 0.6, { type: 'sine', vol: 0.08, at: 0.6 });
  }

  playGameOver() {
    if (!this.ok()) return;
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.45, { type: 'sawtooth', vol: 0.07, at: i * 0.22 }));
  }

  playTick() { if (this.ok()) this.tone(900, 0.05, { type: 'square', vol: 0.05 }); }

  /** Calm pad + a sparse arpeggio; a little quicker at higher levels. */
  startMusic() {
    if (this.musicTimer || !this.ok()) return;
    const chords = [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 329.63]];
    let i = 0;
    const play = () => {
      if (this.muted || !this.ctx) return;
      const ch = chords[i++ % chords.length];
      ch.forEach(f => this.tone(f, 2.6, { vol: 0.022 }));
      const step = Math.max(0.22, 0.42 - this.level * 0.015);
      [0, 1, 2, 1].forEach((n, k) => this.tone(ch[n] * 2, 0.25, { type: 'triangle', vol: 0.018, at: 0.2 + k * step }));
    };
    play();
    this.musicTimer = setInterval(play, 2800);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const soundEngine = new SoundEngine();
