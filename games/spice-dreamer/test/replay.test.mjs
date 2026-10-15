// Replays must reproduce a run exactly: play bot runs through the sim, encode their inputs,
// replay them from scratch and check every result matches. Run with: npm test
import { replayRun } from '../src/sim.js';
import { botRun } from './bot.mjs';

let failures = 0, totalFrames = 0, best = 0;
const week = 2964;
for (let seed = 1; seed <= 60; seed++)
{
  const { run, replay } = botRun(week, seed);
  const r = replayRun(week, replay);
  totalFrames += run.frame;
  best = Math.max(best, run.score);
  if (!r.ok || r.score !== run.score || r.frames !== run.frame || r.deathReason !== run.deathReason)
  {
    failures++;
    console.log('MISMATCH seed', seed, { live: [run.score, run.frame, run.deathReason], replay: r.ok ? [r.score, r.frames, r.deathReason] : r.error });
  }
}
// tampering must be caught: a changed input changes the result or invalidates the replay
const { run, replay } = botRun(week, 7);
const tampered = replay.replace(/T/, 'N');
const t = replayRun(week, tampered);
const tamperCaught = !t.ok || t.score !== run.score || t.frames !== run.frame;
console.log(`replays: ${60 - failures}/60 exact, ${totalFrames} frames, best bot score ${best}, tamper caught: ${tamperCaught}`);
if (failures || !tamperCaught) process.exit(1);
