// Sound: one-shot effects are ZzFX sounds through LittleJS; the continuous
// ball-rolling rumble and bar motor whine are small WebAudio graphs driven
// every frame from the simulation.

import { Sound, audioContext, audioMasterGain } from 'littlejsengine';

export function makeSfx() {
  return {
    clack: new Sound([0.35, 0.1, 2400, 0, 0.004, 0.03, 0, 2, 0, 0, 0, 0, 0, 0.35, 0, 0, 0, 0.5, 0.01]),
    drop: new Sound([0.9, 0.05, 110, 0.005, 0.06, 0.4, 0, 1.4, -1.5, 0, 0, 0, 0, 0.7, 0, 0, 0.11, 0.55, 0.04]),
    win: new Sound([0.8, 0, 523, 0.01, 0.12, 0.25, 0, 1.6, 0, 0, 262, 0.07, 0.07, 0, 0, 0, 0, 0.7, 0.03]),
    lose: new Sound([0.8, 0, 260, 0.02, 0.25, 0.5, 2, 1.2, -3, 0, 0, 0, 0, 0, 0, 0.08, 0, 0.6, 0.08]),
    feed: new Sound([0.7, 0.05, 160, 0, 0.03, 0.14, 4, 1, 0, 0, 0, 0, 0, 0.6, 0, 0, 0.04, 0.45]),
    tick: new Sound([0.18, 0, 1320, 0, 0.008, 0.02, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5]),
    start: new Sound([0.6, 0, 392, 0.01, 0.08, 0.18, 0, 1.6, 0, 0, 196, 0.05, 0.06, 0, 0, 0, 0, 0.7]),
  };
}

export class Loops {
  constructor() {
    this.ready = false;
  }

  // must run after a user gesture has unlocked audio
  init() {
    if (this.ready || !audioContext) return;
    const ac = audioContext, out = audioMasterGain || ac.destination;

    // rolling: looping noise through a band-pass whose pitch follows ball speed
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
    const noise = ac.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    this.rollFilter = ac.createBiquadFilter();
    this.rollFilter.type = 'bandpass';
    this.rollFilter.Q.value = 1.2;
    this.rollGain = ac.createGain();
    this.rollGain.gain.value = 0;
    noise.connect(this.rollFilter).connect(this.rollGain).connect(out);
    noise.start();

    // bar motors: two slightly detuned buzzy oscillators
    this.motorGain = ac.createGain();
    this.motorGain.gain.value = 0;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520;
    this.motors = [92, 97].map((f) => {
      const o = ac.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(lp); o.start();
      return o;
    });
    lp.connect(this.motorGain).connect(out);
    this.ready = true;
  }

  update(rollSpeed, rolling, motorL, motorR) {
    if (!this.ready) return;
    const t = audioContext.currentTime;
    const s = rolling ? Math.min(1, rollSpeed / 0.35) : 0;
    this.rollGain.gain.setTargetAtTime(0.32 * s, t, 0.03);
    this.rollFilter.frequency.setTargetAtTime(180 + 900 * s, t, 0.05);
    const m = Math.min(1, Math.abs(motorL) + Math.abs(motorR));
    this.motorGain.gain.setTargetAtTime(0.045 * m, t, 0.04);
    this.motors[0].frequency.setTargetAtTime(80 + 30 * Math.abs(motorL), t, 0.05);
    this.motors[1].frequency.setTargetAtTime(84 + 30 * Math.abs(motorR), t, 0.05);
  }
}
