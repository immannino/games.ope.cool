// Replays must reproduce a run exactly: play bot runs through the sim, encode their inputs,
// replay them from scratch and check every result matches. Run with: npm test
import { replayRun, decodeReplay } from '../src/sim.js';
import { botRun } from './bot.mjs';

let failures = 0, totalFrames = 0, best = 0;
const week = 2964;
for (let seed = 1; seed <= 60; seed++)
{
  const viewW = [320, 390, 480][seed % 3]; // phones, desktops and ultrawides each set where the head leaves the screen
  const { run, replay } = botRun(week, seed, viewW);
  if (decodeReplay(replay).viewW !== viewW) { failures++; console.log('view width not kept, seed', seed); }
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
// and a view width outside what the game allows is refused
let badWidthRefused = false;
try { replayRun(week, replay.replace(/\|w\d+\|/, '|w2000|')); } catch { badWidthRefused = true; }
console.log(`replays: ${60 - failures}/60 exact, ${totalFrames} frames, best bot score ${best}, tamper caught: ${tamperCaught}, bad width refused: ${badWidthRefused}`);
if (failures || !tamperCaught || !badWidthRefused) process.exit(1);
