// SPICE DREAMER simulation — everything that decides how a run turns out lives here.
//
// It's pure and deterministic: no engine, no DOM, no clock, no Math.random, and no Math.sin/exp
// (their precision can differ between browsers). Only + - * / and exact helpers like Math.floor,
// so the same inputs give the exact same run in any JS engine. The game draws a run from this file,
// and the leaderboard API replays a run's recorded inputs through this same file to verify a score.

export const DT = 1/60;                  // fixed step, matches the engine's update rate
export const LANES = 26;                 // playable depth: lane 0 is nearest the camera, lane 26 farthest
export const METERS = 2;                 // meters per world unit
export const START_REL = 8;              // worm start position relative to the camera center (world units)
// The view: how the game projects the world onto the screen. The sim needs it because the run ends when
// the worm's head (its brain) leaves the player's screen, and screens differ in width.
export const PPU = 5;                    // pixels per world unit at lane 0
export const depthScale = L => 1 - L*.01; // farther lanes are drawn a little smaller
export const HEAD_R = 1.7;               // the head's radius, world units
export const MIN_VIEW_W = 320, MAX_VIEW_W = 480; // view widths in pixels (it's always 180 tall)
export const STEER_UNITS = 32;           // steering input is quantized to 1/32 of a lane per frame
export const MAX_STEER = 5*STEER_UNITS;  // most a single frame can steer
export const SIM_VERSION = 3;            // bump whenever a change here would alter replays (3: head leaves the player's screen; 2: Fremen lines, wide trail, eased steering)

///////////////////////////////////////////////////////////////////////////////
// deterministic math

const PI = 3.141592653589793, TAU = 2*PI;

// sine from a Taylor series after range reduction, accurate to ~1e-7 and identical everywhere
export function dsin(x)
{
  x -= TAU*Math.round(x/TAU);
  if (x > PI/2) x = PI - x;
  else if (x < -PI/2) x = -PI - x;
  const x2 = x*x;
  return x*(1 + x2*(-1/6 + x2*(1/120 + x2*(-1/5040 + x2*(1/362880 + x2*(-1/39916800))))));
}

// e^x by halving into a small range, a Taylor series, then squaring back up
export function dexp(x)
{
  let k = 0;
  while (x < -.5 || x > .5) { x /= 2; k++; }
  let term = 1, sum = 1;
  for (let i = 1; i < 14; i++) { term *= x/i; sum += term; }
  while (k--) sum *= sum;
  return sum;
}

export const clamp = (v, min=0, max=1) => v < min ? min : v > max ? max : v;
export const lerp = (a, b, p) => a + (b - a)*p;
export const smooth = t => t*t*(3 - 2*t);
export const approach = (v, target, step) => v < target ? Math.min(v + step, target) : Math.max(v - step, target);
const ramp = (m, start, end) => smooth(clamp((m - start)/(end - start)));

export function seededRandom(seed)
{
  let a = seed >>> 0;
  const next = () =>
  {
    a = a + 0x6D2B79F5 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0)/4294967296;
  };
  return (a=1, b=0) => b + next()*(a - b);
}

// the course changes every Sunday at midnight UTC, the same for everyone all week
export const weekNumber = (now=Date.now()) => Math.floor((now/864e5 + 4)/7);

///////////////////////////////////////////////////////////////////////////////
// progression — everything scales with meters travelled
//
//   0m     open sands: wide and twisty but forgiving, nothing in the way. Learn to steer.
//   600m   first Fremen line, standing along the trail's edge like a guardrail.
//   700m+  trail breaks: stretches of deep sand you have to coast across.
//   800m+  each stage raises the score multiplier, so pushing deeper is where the points are.
//   2500m+ Fremen lines on both sides now and then.  3500m+ wrecked harvesters in the middle of the trail.
//   The world speed never stops rising.
//   Hazard timing is keyed to distance, not score, so changing the multipliers won't move it.

export const STAGES = [
  { m: 0,    name: 'THE FUNERAL PLAIN', mult: 1 },
  { m: 800,  name: 'THE SHIELD WALL',   mult: 2 },
  { m: 2000, name: 'THE DEEP DESERT',   mult: 3 },
  { m: 3500, name: "MAKER'S DOMAIN",    mult: 4 },
  { m: 5500, name: 'THE ENDLESS SPICE', mult: 5 },
];
export const stageAt = m => { let i = 0; while (i + 1 < STAGES.length && m >= STAGES[i + 1].m) i++; return i; };

export const baseSpeed = m => 45 + 45*(1 - dexp(-m/3000)) + m/1100; // the road's pace, keeps climbing forever
// space is the throttle: it pushes past the road's pace, letting go slows toward a stop.
// Matching the pace holds your place on screen; the further right you ride, the less road you see coming.
const topSpeed = m => baseSpeed(m)*1.45;
const surgeAccel = m => 20 + baseSpeed(m)*1.8;                     // twitchy on purpose: small taps matter
const coastDecel = m => (12 + baseSpeed(m)*1.1)*lerp(.6, 1, ramp(m, 0, 1500));
const trailWidthAt = m => 6.5 + 8*dexp(-m/3000);                   // lanes: ~14 at the start, ~10.5 at 2km, ~8 at 5km
export const offTrailGrace = m => lerp(.8, .25, ramp(m, 0, 3000)); // seconds off the trail before the run ends
const turnDemand = m => lerp(4, 14, ramp(m, 150, 5000));           // lanes/sec of steering the shifts ask for
const sharpChance = m => m < 300 ? 0 : lerp(.06, .2, ramp(m, 300, 5000)); // now and then the trail jogs hard
const straightChance = m => lerp(.3, .1, ramp(m, 0, 4000));
const flipChance = m => lerp(.4, .6, ramp(m, 0, 5000));            // how often the trail changes direction

// trail breaks: stretches of deep sand with no trail. The throttle can't grip there and the worm
// bleeds speed fast, so you need to hit them going fast enough to coast across.
export const FIRST_BREAK = 700;
const breakGap = m => lerp(900, 320, ramp(m, FIRST_BREAK, 6000));   // meters between breaks
const breakDrag = m => baseSpeed(m)*.9;                             // speed lost per second in deep sand
// coasting distance from top speed is topSpeed^2/(2*drag) = ~1.17x the road pace; a break uses part of that
const breakLength = m => lerp(.35, .7, ramp(m, FIRST_BREAK, 6000))*1.17*baseSpeed(m);

const HAZARD_RAMP = 1900;                                           // ~3000 score: where hazards start to get busy
const hazardGap = m => m < HAZARD_RAMP ? 600 : lerp(300, 90, ramp(m, HAZARD_RAMP, 7000)); // meters between hazards
const wreckChance = m => m < 3500 ? 0 : lerp(.1, .3, ramp(m, 3500, 7000));
// Fremen lines stand along a stretch of the trail's edge like guardrails: off the trail you normally get a
// moment's grace, but brush a line of Fremen and the run is over
export const FIRST_FREMEN = 600;
const fremenGap = m => lerp(260, 120, ramp(m, FIRST_FREMEN, 6000));     // meters between lines
const fremenLength = m => lerp(22, 55, ramp(m, FIRST_FREMEN, 6000));    // world units

const ATTRACT_SPEED = 60;               // the title / screensaver worm cruises instead of speeding up forever
// steering eases in and out: the worm's lane chases a point that itself chases where you've rolled to.
// Two of these chained make an S-curve, a soft start and a soft landing, and it's still ~90% there in 0.1s.
const STEER_EASE = 1 - dexp(-42*DT);
const HIT = .55;                         // how close to a hazard's edge counts as touching it

///////////////////////////////////////////////////////////////////////////////
// the course — the spice trail, its breaks and its hazards, generated lazily as the camera moves.
// The trail is built from control points every TRAIL_SEG units joined with a Catmull-Rom spline,
// so how hard the curves are can follow the progression exactly.

const TRAIL_SEG = 12;
const TRAIL_START = -10*TRAIL_SEG;

export function createCourse(week)
{
  const course = {
    week, trailPts: [], breaks: [], nextBreakX: FIRST_BREAK/METERS,
    trailRand: seededRandom(week*3 + 1), hazardRand: seededRandom(week*3 + 2), breakRand: seededRandom(week*3 + 4),
  };
  course.trailDir = course.trailRand() < .5 ? 1 : -1;
  return course;
}

// the trail swells and pinches a little along its length so no two stretches feel the same
export const trailWidth = (course, x) =>
  trailWidthAt(Math.max(0, x*METERS))*(1 + .14*dsin(x*.043 + course.week) + .06*dsin(x*.11));

export const breakAt = (course, x) => course.breaks.find(b => x >= b.x0 && x <= b.x1);

function extendBreaks(course, toX)
{
  while (course.nextBreakX < toX)
  {
    const m = course.nextBreakX*METERS, len = breakLength(m);
    course.breaks.push({ x0: course.nextBreakX, x1: course.nextBreakX + len });
    course.nextBreakX += len + breakGap(m)/METERS*course.breakRand(.8, 1.25);
  }
}

export function extendTrail(course, toX)
{
  const pts = course.trailPts, rand = course.trailRand;
  while (TRAIL_START + (pts.length - 3)*TRAIL_SEG < toX)
  {
    const x = TRAIL_START + pts.length*TRAIL_SEG, m = Math.max(0, x*METERS);
    const prev = pts[pts.length - 1] ?? LANES/2;
    let L = LANES/2;
    extendBreaks(course, x + TRAIL_SEG*3);
    // straight across a break, so where it picks up again lines up with where it gave out
    if (course.breaks.some(b => x > b.x0 - TRAIL_SEG && x < b.x1 + TRAIL_SEG))
      L = prev;
    else if (m > 150)
    {
      const w = trailWidthAt(m)*1.2, lo = w/2 + .8, hi = LANES - w/2 - .8;
      const maxDelta = turnDemand(m)*TRAIL_SEG/(baseSpeed(m)*1.5);
      if (rand() < flipChance(m)) course.trailDir = -course.trailDir;
      const straight = rand() < straightChance(m);
      // mostly sweeps of varying size, now and then a sharp jog
      const size = rand() < sharpChance(m) ? rand(2, 2.8) : rand() < .2 ? rand(1.1, 1.5) : rand(.35, 1);
      L = prev + (straight ? rand(-.2, .2) : course.trailDir*size)*maxDelta;
      if (L < lo || L > hi)
      {
        course.trailDir = -course.trailDir;
        L = clamp(L, lo, hi);
      }
    }
    pts.push(L);
  }
}

export function trailLane(course, x)
{
  const pts = course.trailPts;
  const f = (x - TRAIL_START)/TRAIL_SEG, i = Math.floor(f), t = f - i;
  const p = k => pts[clamp(k, 0, pts.length - 1)];
  const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
  return .5*(2*p1 + (p2 - p0)*t + (2*p0 - 5*p1 + 4*p2 - p3)*t*t + (3*p1 - p0 - 3*p2 + p3)*t*t*t);
}

// a line of Fremen along one edge of the trail from x0 to x1, following its curves
// where a Fremen line stands: just outside the trail's edge
export const fremenLane = (course, x, side) => trailLane(course, x) + side*(trailWidth(course, x)/2 + .4);

function addFremenLine(run, x0, x1, side)
{
  run.hazards.push({ kind: 'fremen', x: x1, x0, x1, side, seed: run.course.hazardRand(99) });
}

// Fremen lines come along on their own schedule, sometimes lining both sides as a corridor
function spawnFremen(run, x)
{
  const course = run.course, rand = course.hazardRand, m = x*METERS;
  const len = fremenLength(m)*rand(.8, 1.2);
  if (!course.breaks.some(b => b.x1 > x - 10 && b.x0 < x + len + 10)) // they don't stand over a break
  {
    const side = rand() < .5 ? 1 : -1;
    addFremenLine(run, x, x + len, side);
    if (m > 2500 && rand() < .3) addFremenLine(run, x, x + len, -side);
  }
  return len;
}

function spawnHazard(run, x)
{
  const course = run.course, rand = course.hazardRand;
  const m = x*METERS, c = trailLane(course, x), w = trailWidth(course, x);
  if (course.breaks.some(b => x > b.x0 - 20 && x < b.x1 + 25)) return;

  if (rand() < wreckChance(m))
  {
    // a wrecked harvester in the middle: pass on either side
    const half = Math.min(w*lerp(.15, .22, ramp(m, 3500, 7000)), w/2 - 1.5);
    run.hazards.push({ kind: 'wreck', x, L0: c - half, L1: c + half, halfX: 1.1, seed: rand(99) });
    return;
  }
}

///////////////////////////////////////////////////////////////////////////////
// a run

// attract mode is the title screen: the worm follows the trail on its own and can't die or score
// viewW is the player's view width: the screen the head has to stay on
export function createRun(course, { startMeters=0, attract=false, viewW=MIN_VIEW_W }={})
{
  const x0 = startMeters/METERS;
  extendTrail(course, x0 + 200);
  const L = trailLane(course, x0), speed = baseSpeed(startMeters);
  return {
    course, attract, x: x0, L, steerL: L, targetL: L, speed, frame: 0,
    throttle: false, inBreak: false, offTrail: false, offTime: 0,
    dead: false, deathReason: '', score: 0, stage: stageAt(startMeters),
    nextMilestone: Math.floor(startMeters/1000 + 1)*1000,
    camX: x0 - START_REL, camSpeed: speed, viewW: clamp(Math.round(viewW), MIN_VIEW_W, MAX_VIEW_W),
    hazards: [], nextHazardX: Math.max(HAZARD_RAMP/METERS, x0 + 40), nextFremenX: Math.max(FIRST_FREMEN/METERS, x0 + 60),
  };
}

// how far the head is from the middle of the screen, in pixels (negative is left)
export const headScreenOffset = run => (run.x - run.camX)*PPU*depthScale(run.L);

function die(run, reason, events)
{
  run.dead = true;
  run.deathReason = reason;
  run.score = Math.floor(run.score);
  events.push({ type: 'die', reason });
}

// advance one frame. throttle is a boolean, steer is in 1/STEER_UNITS lanes.
// Returns the events that happened this frame so the game can react with popups and sounds.
export function stepRun(run, throttle, steer)
{
  const course = run.course, events = [];
  const alive = !run.dead && !run.attract;
  const c = trailLane(course, run.x), w = trailWidth(course, run.x);

  // steering: wheel slides the worm nearer / farther
  if (alive)
    run.targetL = clamp(run.targetL + clamp(steer | 0, -MAX_STEER, MAX_STEER)/STEER_UNITS, -.5, LANES + .5);
  else if (run.attract)
    run.targetL = trailLane(course, run.x + 4);
  run.steerL += (run.targetL - run.steerL)*STEER_EASE;
  run.L += (run.steerL - run.L)*STEER_EASE;

  // speed: space is the throttle, the road's pace keeps rising underneath it
  const meters = run.x*METERS, base = baseSpeed(meters);
  run.throttle = alive && !!throttle;
  run.inBreak = !!breakAt(course, run.x);
  run.offTrail = !run.inBreak && Math.abs(run.L - c) > w/2 + .25;
  if (run.dead)
    run.speed = approach(run.speed, 0, 30*DT);
  else if (run.attract)
    run.speed = Math.min(base, ATTRACT_SPEED);
  else if (run.inBreak)
    run.speed = approach(run.speed, 0, breakDrag(meters)*DT); // deep sand: no grip, just momentum
  else if (run.offTrail)
    run.speed = approach(run.speed, base*.5, 30*DT);
  else if (run.throttle)
    run.speed = approach(run.speed, topSpeed(meters), surgeAccel(meters)*DT);
  else
    run.speed = approach(run.speed, 0, coastDecel(meters)*DT);

  const dx = run.speed*DT;
  run.x += dx;
  run.frame++;

  if (alive)
    checkRun(run, dx, meters, events);

  // the camera ignores the worm and just keeps the road's pace
  run.camSpeed = run.dead ? approach(run.camSpeed, 0, 25*DT) : run.attract ? run.speed : baseSpeed(run.camX*METERS);
  run.camX += run.camSpeed*DT;
  extendTrail(course, run.camX + 160);
  // the attract worm (title screen, screensaver) rides the middle of the trail and can't die: wrecks in the
  // middle would just pass through it, so it gets none. Fremen lines stand outside the edge, so it keeps those.
  while (!run.attract && run.nextHazardX < run.camX + 75)
  {
    spawnHazard(run, run.nextHazardX);
    run.nextHazardX += hazardGap(run.nextHazardX*METERS)/METERS*course.hazardRand(.75, 1.3);
  }
  while (run.nextFremenX < run.camX + 75)
  {
    const len = spawnFremen(run, run.nextFremenX);
    run.nextFremenX += len + fremenGap(run.nextFremenX*METERS)/METERS*course.hazardRand(.7, 1.4);
  }
  run.hazards = run.hazards.filter(o => o.x > run.camX - 80);
  // old breaks are behind the camera for good; dropping them keeps endless screensaver runs fast
  if (course.breaks.length > 8 && course.breaks[0].x1 < run.camX - 200) course.breaks.shift();
  return events;
}

function checkRun(run, dx, meters, events)
{
  // score is distance, multiplied by the stage — going faster racks it up quicker
  const stage = stageAt(meters), mult = STAGES[stage].mult;
  run.score += dx*METERS*mult;
  if (stage > run.stage)
  {
    run.stage = stage;
    events.push({ type: 'stage', stage });
  }
  else if (meters >= run.nextMilestone)
    events.push({ type: 'milestone', meters: run.nextMilestone });
  if (meters >= run.nextMilestone) run.nextMilestone += 1000;

  // leaving the trail ends the run after a grace period that shrinks as you go
  if (run.offTrail)
  {
    run.offTime += DT;
    if (run.offTime > offTrailGrace(meters)) return die(run, 'LOST THE SPICE TRAIL', events);
  }
  else
    run.offTime = Math.max(0, run.offTime - DT*2);

  if (run.inBreak && run.speed < 1)
    return die(run, 'SANK IN THE DEEP SAND', events);

  // drift off either side of the screen and the run is over
  // the head has to stay on screen: too slow and it slides off the left, too fast and it shoots off the right
  const head = headScreenOffset(run), r = HEAD_R*PPU*depthScale(run.L), half = run.viewW/2;
  if (head + r < -half) return die(run, 'LEFT BEHIND', events);
  if (head - r > half) return die(run, 'OVERSHOT THE ROAD', events);

  // Fremen lines guard stretches of the trail's edge; wrecks block a span of lanes at one spot
  for (const o of run.hazards)
  {
    if (o.kind == 'fremen')
    {
      if (run.x < o.x0 || run.x > o.x1) continue;
      const line = fremenLane(run.course, run.x, o.side);
      if (o.side*(run.L - line) > -HIT) return die(run, 'RAN INTO THE FREMEN', events);
      continue;
    }
    if (Math.abs(o.x - run.x) < o.halfX && run.L > o.L0 - HIT && run.L < o.L1 + HIT)
      return die(run, 'HIT A WRECKED HARVESTER', events);
    if (!o.passed && o.x < run.x - o.halfX)
    {
      o.passed = true;
      const miss = run.L < o.L0 ? o.L0 - HIT - run.L : run.L - o.L1 - HIT;
      if (miss < .8)
      {
        const pts = 50*mult;
        run.score += pts;
        events.push({ type: 'near', pts });
      }
    }
  }
}

///////////////////////////////////////////////////////////////////////////////
// replays — a run's inputs, run-length encoded. "v1|" then comma separated runs of
// <frames in base36><T or N for throttle><steer in base36>, after the view width, e.g. "v3|w390|2sN0,4T0,1T-a"

export function createRecorder(viewW=MIN_VIEW_W) { return { viewW: clamp(Math.round(viewW), MIN_VIEW_W, MAX_VIEW_W), runs: [] }; }

export function record(rec, throttle, steer)
{
  const t = throttle ? 1 : 0, last = rec.runs[rec.runs.length - 1];
  if (last && last[1] == t && last[2] == steer) last[0]++;
  else rec.runs.push([1, t, steer]);
}

export const encodeReplay = rec =>
  'v' + SIM_VERSION + '|w' + rec.viewW + '|' + rec.runs.map(([n, t, s]) => n.toString(36) + (t ? 'T' : 'N') + s.toString(36)).join(',');

// returns { viewW, runs }
export function decodeReplay(str)
{
  const [version, width, body] = String(str).split('|');
  if (version != 'v' + SIM_VERSION) throw new Error('unsupported replay version ' + version);
  const viewW = Number(/^w(\d+)$/.exec(width || '')?.[1]);
  if (!(viewW >= MIN_VIEW_W && viewW <= MAX_VIEW_W)) throw new Error('bad view width ' + width);
  if (!body) return { viewW, runs: [] };
  return { viewW, runs: body.split(',').map(part =>
  {
    const m = /^([0-9a-z]+)([TN])(-?[0-9a-z]+)$/.exec(part);
    if (!m) throw new Error('bad replay segment ' + part);
    const n = parseInt(m[1], 36), s = parseInt(m[3], 36);
    if (!(n > 0) || Math.abs(s) > MAX_STEER) throw new Error('bad replay values ' + part);
    return [n, m[2] == 'T' ? 1 : 0, s];
  }) };
}

// replays a run from the start of a week's course. A valid replay ends on exactly the frame the run died.
export function replayRun(week, replay, maxFrames=60*60*30)
{
  const { viewW, runs } = decodeReplay(replay);
  const run = createRun(createCourse(week), { viewW });
  for (const [n, t, s] of runs)
    for (let i = 0; i < n; i++)
    {
      if (run.dead) return { ok: false, error: 'inputs continue after the run ended', run };
      if (run.frame >= maxFrames) return { ok: false, error: 'replay too long', run };
      stepRun(run, t, s);
    }
  if (!run.dead) return { ok: false, error: 'replay ends before the run did', run };
  return { ok: true, score: run.score, meters: Math.floor(run.x*METERS), frames: run.frame, deathReason: run.deathReason, run };
}
