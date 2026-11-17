// The dice table: a throw must come to rest inside the tray, and the rigged faces must read the values the game
// asked for. Run with: npm test
import * as CANNON from 'cannon-es';
import { DiceTable, STEP } from '../../../packages/dice-physics/src/index.js';
import { relabelForUp, STANDARD_D6, FACE_DIRS } from '../../../packages/dice-physics/src/faces.js';

let failures = 0;
const fail = (...a) => { failures++; console.log('FAIL', ...a); };

// relabelling keeps a legal die (opposite faces add to 7) and puts the wanted value up
for (let up = 0; up < 6; up++) for (let v = 1; v <= 6; v++) for (let pick = 0; pick < 4; pick++)
{
  const l = relabelForUp(STANDARD_D6, up, v, pick);
  if (l[up] !== v) fail('relabel up', up, v);
  for (let f = 0; f < 6; f += 2) if (l[f] + l[f + 1] !== 7) fail('opposites', l);
  if ([...l].sort().join('') !== '123456') fail('labels not a permutation', l);
}

const bounds = { x0: -7, x1: 7, z0: -3.5, z1: 3.5 };
const N = 150;
let rest = 0, matched = 0, totalSteps = 0, maxSteps = 0, inBounds = 0, impacts = 0, ms = 0;
for (let n = 0; n < N; n++)
{
  const count = [2, 2, 1, 5][n % 4];
  const t = new DiceTable(CANNON, { bounds, count, size: 1, gravity: 70 });
  t.on('impact', () => impacts++);
  t.on('rest', () => rest++);
  const targets = Array.from({ length: count }, () => 1 + Math.floor(Math.random()*6));
  // half the throws come from a hand that was moved around first, the others are a plain toss
  if (n % 2)
  {
    t.grab(0, 0);
    for (let i = 0; i < 40; i++) { t.move(Math.sin(i/5)*3, Math.cos(i/4)*1.5, 1/60); t.update(1/60); }
    t.cast(Math.random()*40 - 20, Math.random()*20 - 10, targets);
  }
  else t.cast(0, 0, targets);
  const castSteps = t.playback.frames.length, t0 = performance.now();
  // play it out at a ragged frame rate, as a browser would
  let frames = 0;
  while (t.phase === 'cast' && frames++ < 4000) t.update([1/60, 1/30, 1/144, 1/60, 1/50][frames % 5]);
  ms += performance.now() - t0;
  totalSteps += castSteps; maxSteps = Math.max(maxSteps, castSteps);
  const values = t.values();
  if (t.phase !== 'rest') fail('never came to rest', n);
  else if (values.every((v, i) => v === targets[i])) matched++;
  else fail('wrong faces', values, targets);
  const inside = t.dice.every(d => d.body.position.x > bounds.x0 && d.body.position.x < bounds.x1 && d.body.position.z > bounds.z0 && d.body.position.z < bounds.z1 && Math.abs(d.body.position.y - .5) < .15);
  if (inside) inBounds++; else fail('a die ended up outside the tray or off the felt', n, JSON.stringify(t.dice.map(d => [d.body.position.x, d.body.position.y, d.body.position.z].map(v => +v.toFixed(2)))));
}
console.log(`dice: ${matched}/${N} throws read the rigged faces, ${rest} came to rest, ${inBounds} stayed in the tray flat on the felt, ${impacts} impacts`);
console.log(`  mean ${(totalSteps/N/120).toFixed(2)}s to rest (max ${(maxSteps/120).toFixed(1)}s), ${(ms/N).toFixed(1)}ms CPU per throw`);
if (failures) process.exit(1);
