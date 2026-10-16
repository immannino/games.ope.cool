// A bot that plays the sim, used by the tests and API checks to produce real, verifiable replays.
import { createCourse, createRun, stepRun, trailLane, createRecorder, record, encodeReplay,
  seededRandom, STEER_UNITS, MAX_STEER, START_REL } from '../src/sim.js';

// a bot that roughly follows the trail and holds its place, with some noise so runs differ
export function botRun(week, seed, viewW=320)
{
  const rand = seededRandom(seed), course = createCourse(week), run = createRun(course, { viewW }), rec = createRecorder(viewW);
  const skill = rand(.3, 1);
  while (!run.dead && run.frame < 60*60*10)
  {
    const want = trailLane(course, run.x + 6) + rand(-1, 1)*(1 - skill)*3;
    const steer = Math.max(-MAX_STEER, Math.min(MAX_STEER, Math.round((want - run.targetL)*STEER_UNITS*.3)));
    const throttle = run.x - run.camX < START_REL + rand(-6, 6) || run.speed < 20;
    const input = rand() < skill ? steer : 0;
    record(rec, throttle, input);
    stepRun(run, throttle, input);
  }
  return { run, replay: encodeReplay(rec) };
}
