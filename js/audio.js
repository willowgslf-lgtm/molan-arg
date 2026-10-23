/* ==========================================================
   末栏 · ARG 三部曲 — procedural audio
   No audio files. Heartbeat, hum, whispers and stingers are
   generated with the Web Audio API, only after a user gesture.
   ========================================================== */
(function () {
  'use strict';

  const MUTE_KEY = 'molan_arg_muted';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.modeGain = null;
      this.mode = 'none';
      this.pendingMode = 'none';
      this.nodes = [];
      this.timers = [];
      this.started = false;
      this.muted = false;
      try {
        this.muted = window.localStorage.getItem(MUTE_KEY) === '1';
      } catch (e) {
        this.muted = false;
      }
    }

    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return true;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.58;
        this.master.connect(this.ctx.destination);
        this.modeGain = this.ctx.createGain();
        this.modeGain.gain.value = 0;
        this.modeGain.connect(this.master);
        this.started = true;
        return true;
      } catch (e) {
        return false;
      }
    }

    unlock() {
      if (!this.ensure()) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (this.pendingMode !== 'none' && this.mode === 'none') {
        const m = this.pendingMode;
        this.pendingMode = 'none';
        this.setMode(m);
      }
    }

    setMuted(value) {
      this.muted = !!value;
      try {
        window.localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
      } catch (e) {}
      if (this.master && this.ctx) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(this.muted ? 0 : 0.58, t, 0.08);
      }
      return this.muted;
    }

    toggleMuted() {
      if (!this.ensure()) return this.muted;
      return this.setMuted(!this.muted);
    }

    stopMode() {
      this.clearTimers();
      if (this.modeGain && this.ctx) {
        const t = this.ctx.currentTime;
        this.modeGain.gain.cancelScheduledValues(t);
        this.modeGain.gain.setTargetAtTime(0, t, 0.12);
      }
      const old = this.nodes.slice();
      this.nodes = [];
      window.setTimeout(() => {
        old.forEach((n) => {
          try { n.stop(); } catch (e) {}
          try { n.disconnect(); } catch (e) {}
        });
      }, 700);
      this.mode = 'none';
    }

    setMode(mode) {
      if (!mode) mode = 'none';
      if (mode === this.mode && this.ctx) return;
      this.pendingMode = mode;
      // Never create an AudioContext outside a user gesture. The first
      // pointerdown/keydown calls unlock(), which starts the pending mode.
      if (!this.ctx || !this.started) return;
      this.stopMode();
      this.mode = mode;
      this.pendingMode = mode;
      if (mode === 'none') return;
      if (this.ctx.state === 'suspended') {
        // It will resume on the next gesture; keep a low-cost mode ready.
        this.ctx.resume().catch(() => {});
      }
      const t = this.ctx.currentTime;
      this.modeGain.gain.cancelScheduledValues(t);
      this.modeGain.gain.setValueAtTime(0, t);
      this.modeGain.gain.linearRampToValueAtTime(1, t + (mode === 'heartbeat' ? 1.8 : 2.8));

      if (mode === 'heartbeat') this.startHeartbeat();
      else if (mode === 'ambient') this.startAmbient();
      else if (mode === 'eerie') this.startEerie();
      else if (mode === 'tension') this.startTension();
    }

    clearTimers() {
      this.timers.forEach((t) => window.clearInterval(t));
      this.timers = [];
    }

    addNode(node) {
      this.nodes.push(node);
      return node;
    }

    makeOsc(freq, type, gainValue, dest, detune) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      if (detune) osc.detune.value = detune;
      gain.gain.value = gainValue == null ? 0.05 : gainValue;
      osc.connect(gain).connect(dest || this.modeGain);
      osc.start();
      this.addNode(osc);
      this.addNode(gain);
      return { osc, gain };
    }

    makeNoiseLoop(duration, gainValue, filterType, frequency, q) {
      const ctx = this.ctx;
      const length = Math.max(1, Math.floor(ctx.sampleRate * (duration || 2)));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.018 * white) / 1.018;
        data[i] = last * 2.8;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType || 'lowpass';
      filter.frequency.value = frequency || 500;
      filter.Q.value = q || 0.7;
      const gain = ctx.createGain();
      gain.gain.value = gainValue == null ? 0.04 : gainValue;
      src.connect(filter).connect(gain).connect(this.modeGain);
      src.start();
      this.addNode(src);
      this.addNode(filter);
      this.addNode(gain);
      return { src, filter, gain };
    }

    startHeartbeat() {
      const beat = () => {
        if (!this.ctx || this.mode !== 'heartbeat') return;
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const thump = (at, gainValue, baseFreq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const filter = ctx.createBiquadFilter();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(baseFreq || 68, t + at);
          osc.frequency.exponentialRampToValueAtTime(38, t + at + 0.14);
          filter.type = 'lowpass';
          filter.frequency.value = 190;
          gain.gain.setValueAtTime(0.0001, t + at);
          gain.gain.exponentialRampToValueAtTime(gainValue, t + at + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.2);
          osc.connect(filter).connect(gain).connect(this.modeGain);
          osc.start(t + at);
          osc.stop(t + at + 0.23);
          // chest harmonic
          const h = ctx.createOscillator();
          const hg = ctx.createGain();
          h.type = 'sine';
          h.frequency.setValueAtTime((baseFreq || 68) * 2.02, t + at);
          h.frequency.exponentialRampToValueAtTime(79, t + at + 0.13);
          hg.gain.setValueAtTime(0.0001, t + at);
          hg.gain.exponentialRampToValueAtTime(gainValue * 0.24, t + at + 0.012);
          hg.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.16);
          h.connect(hg).connect(this.modeGain);
          h.start(t + at);
          h.stop(t + at + 0.18);
        };
        thump(0, 0.23, 70);
        thump(0.19, 0.16, 64);
      };
      beat();
      this.timers.push(window.setInterval(beat, 1200));
    }

    startAmbient() {
      const ctx = this.ctx;
      this.makeOsc(43, 'sine', 0.055);
      this.makeOsc(86, 'sine', 0.016);
      this.makeOsc(129.4, 'triangle', 0.006, this.modeGain, 4);
      this.makeNoiseLoop(2.6, 0.023, 'lowpass', 380, 0.5);
      // slow breathing filter
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.055;
      lfoGain.gain.value = 0.012;
      lfo.connect(lfoGain);
      const target = this.makeOsc(64, 'sine', 0, this.modeGain);
      lfoGain.connect(target.gain.gain);
      lfo.start();
      this.addNode(lfo);
      this.addNode(lfoGain);
    }

    startEerie() {
      const ctx = this.ctx;
      this.makeOsc(37.5, 'sine', 0.076);
      this.makeOsc(38.4, 'sine', 0.052, this.modeGain, -5);
      this.makeOsc(56.8, 'triangle', 0.018, this.modeGain, 7);
      this.makeNoiseLoop(3.2, 0.024, 'bandpass', 240, 1.4);
      const spawnWhisper = () => {
        if (!this.ctx || this.mode !== 'eerie') return;
        const t = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        const len = Math.floor(this.ctx.sampleRate * 2.4);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          const env = Math.sin((i / len) * Math.PI);
          d[i] = (Math.random() * 2 - 1) * env * 0.2;
        }
        src.buffer = buf;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 740 + Math.random() * 900;
        filter.Q.value = 5.5;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.024, t + 0.4);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
        src.connect(filter).connect(gain).connect(this.modeGain);
        src.start(t);
        src.stop(t + 2.4);
      };
      this.timers.push(window.setInterval(spawnWhisper, 7800 + Math.random() * 3500));
      window.setTimeout(spawnWhisper, 2600);
    }

    startTension() {
      this.makeOsc(41, 'sine', 0.08);
      this.makeOsc(82.4, 'sine', 0.018);
      this.makeNoiseLoop(1.8, 0.019, 'highpass', 1600, 0.9);
      const tick = () => {
        if (!this.ctx || this.mode !== 'tension') return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(82, t);
        osc.frequency.exponentialRampToValueAtTime(38, t + 0.9);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.055, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        osc.connect(gain).connect(this.modeGain);
        osc.start(t);
        osc.stop(t + 1.2);
      };
      tick();
      this.timers.push(window.setInterval(tick, 2200));
    }

    // ---------- one shots ----------
    sfxTone(freq, duration, type, gainValue, slideTo, delay) {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const t = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
      filter.type = 'lowpass';
      filter.frequency.value = 3200;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(gainValue == null ? 0.08 : gainValue, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(filter).connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + duration + 0.03);
    }

    click() {
      this.sfxTone(880, 0.045, 'sine', 0.035, 520);
    }

    tick() {
      this.sfxTone(1500, 0.03, 'square', 0.012, 900);
    }

    error() {
      this.sfxTone(130, 0.25, 'sawtooth', 0.035, 70);
      this.sfxTone(96, 0.3, 'triangle', 0.025, 52, 0.06);
    }

    unlockChime() {
      this.sfxTone(392, 0.6, 'sine', 0.05, 392);
      this.sfxTone(587.3, 0.9, 'sine', 0.04, 587.3, 0.1);
      this.sfxTone(783.9, 1.2, 'sine', 0.025, 783.9, 0.22);
      this.sfxTone(196, 1.4, 'sine', 0.035, 196, 0.05);
    }

    beep() {
      this.sfxTone(740, 0.1, 'square', 0.045, 740);
    }

    beepLong() {
      this.sfxTone(660, 0.3, 'square', 0.045, 660);
    }

    page() {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      const len = Math.floor(ctx.sampleRate * 0.25);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const env = Math.sin((i / len) * Math.PI);
        d[i] = (Math.random() * 2 - 1) * env * 0.35;
      }
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2200;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0.045;
      src.connect(filter).connect(gain).connect(this.master);
      src.start(t);
    }

    breathe() {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      const len = Math.floor(ctx.sampleRate * 1.8);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const x = i / len;
        const env = Math.sin(x * Math.PI) * (x < 0.4 ? x / 0.4 : 1);
        d[i] = (Math.random() * 2 - 1) * env * 0.32;
      }
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(560, t);
      filter.frequency.linearRampToValueAtTime(210, t + 1.7);
      filter.Q.value = 1.5;
      const gain = ctx.createGain();
      gain.gain.value = 0.05;
      src.connect(filter).connect(gain).connect(this.master);
      src.start(t);
    }

    sigh() {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      const len = Math.floor(ctx.sampleRate * 2.8);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const x = i / len;
        const env = Math.sin(x * Math.PI) * (x < 0.2 ? x / 0.2 : Math.max(0, 1 - (x - 0.2) * 0.8));
        d[i] = (Math.random() * 2 - 1) * env * 0.2;
      }
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(780, t);
      filter.frequency.exponentialRampToValueAtTime(180, t + 2.7);
      filter.Q.value = 2.2;
      const gain = ctx.createGain();
      gain.gain.value = 0.075;
      src.connect(filter).connect(gain).connect(this.master);
      src.start(t);
      this.sfxTone(146.8, 2.8, 'sine', 0.02, 110, 0.1);
    }

    flatline() {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1000;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.032, t + 0.05);
      gain.gain.setValueAtTime(0.032, t + 1.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 2.7);
    }

    staticNoise(duration, gainValue) {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const len = Math.floor(ctx.sampleRate * (duration || 0.2));
      const src = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.4;
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = gainValue == null ? 0.04 : gainValue;
      src.connect(gain).connect(this.master);
      src.start(t);
    }

    countWhisper() {
      this.sfxTone(96 + Math.random() * 22, 0.22, 'sine', 0.0055, 62);
      this.sfxTone(192 + Math.random() * 30, 0.12, 'triangle', 0.0022, 120, 0.035);
    }

    heartbeatNow() {
      if (!this.ensure()) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const thump = (at, g0) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(70, t + at);
        osc.frequency.exponentialRampToValueAtTime(38, t + at + 0.16);
        gain.gain.setValueAtTime(0.0001, t + at);
        gain.gain.exponentialRampToValueAtTime(g0, t + at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.24);
        osc.connect(gain).connect(this.master);
        osc.start(t + at);
        osc.stop(t + at + 0.26);
      };
      thump(0, 0.14);
      thump(0.19, 0.09);
    }
  }

  window.MolanAudio = new AudioEngine();
})();
