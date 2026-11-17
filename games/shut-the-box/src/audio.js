// Synthesized sound, no audio files: dice rattling on felt, wood clacking on wood, a little chime for good news.
import { zzfx } from 'littlejsengine';

const KEY = 'shut-the-box.muted';
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch {}

export const isMuted = () => muted;
export function setMuted(m)
{
  muted = m;
  try { localStorage.setItem(KEY, m ? '1' : '0'); } catch {}
}

const play = (...params) => { if (!muted) zzfx(...params); };
const later = (ms, fn) => setTimeout(fn, ms);
const r = (a, b) => a + Math.random()*(b - a);

export const sfx = {
  // a die tumbling: a run of soft knocks that thin out, then the landing
  rattle(duration=1)
  {
    for (let t = 0, gap = 38; t < duration*850; t += gap, gap *= 1.09)
      later(t + r(0, 12), () => play(r(.16, .3), .4, r(300, 620), 0, 0, .025, 4, .6, 0, 0, 0, 0, 0, .7, 0, 0, 0, .5, .01));
  },
  // a die or tile landing on wood or felt
  thud(strength=1) { play(.55*strength, .05, r(130, 170), 0, .004, .09, 0, 2, -9, 0, 0, 0, 0, .1, 0, 0, 0, .4, .03); },
  // the tile snapping down: a dry wooden clack with a short knock under it
  clack(strength=1)
  {
    const v = .35 + .65*strength;
    play(.8*v, .06, r(190, 230), 0, .004, .07, 0, 2.2, -12, 0, 0, 0, 0, .15, 0, 0, 0, .4, .02);
    play(.5*v, 0, r(1100, 1500), 0, 0, .018, 4, 0, 0, 0, 0, 0, 0, .9, 0, 0, 0, .5, .005);
  },
  // dice knocking on each other or on the rail, and a short rattle while they're shaken in the hand
  diceClick(s=1) { play(.25 + .4*s, .1, r(1500, 2300), 0, 0, .02, 4, .4, 0, 0, 0, 0, 0, .6, 0, 0, 0, .5, .005); play(.2 + .3*s, .05, r(420, 520), 0, .003, .05, 0, 1.5, -6, 0, 0, 0, 0, .1, 0, 0, 0, .4, .02); },
  knock(s=1) { play(.2 + .5*s, .05, r(220, 300), 0, .003, .07, 0, 2, -8, 0, 0, 0, 0, .2, 0, 0, 0, .4, .02); },
  rattleBurst(s=.5)
  {
    const t = performance.now();
    if (t - (sfx._lastBurst || 0) < 70) return;
    sfx._lastBurst = t;
    play(.1 + .22*s, .5, r(700, 1500), 0, 0, .025, 4, .5, 0, 0, 0, 0, 0, .8, 0, 0, 0, .5, .008);
  },
  tick() { play(.35, 0, r(560, 620), 0, .004, .035, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6, .01); },
  untick() { play(.28, 0, r(400, 440), 0, .004, .03, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6, .01); },
  nope() { play(.5, 0, 120, .01, .04, .12, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, .7, .02); },
  // out of moves
  bust()
  {
    play(.5, 0, 196, .01, .1, .35, 1, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6, .1);
    later(220, () => play(.5, 0, 147, .01, .14, .5, 1, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6, .15));
  },
  // every tile down
  fanfare() { [523, 659, 784, 1047, 1319].forEach((f, i) => later(i*110, () => play(.6, 0, f, .01, .12, .5, 1, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6, .12))); },
  // a finished match
  done() { [392, 494, 587].forEach((f, i) => later(i*130, () => play(.5, 0, f, .01, .1, .4, 1, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, .6, .1))); },
};
