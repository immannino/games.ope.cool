// SAND EMPEROR — an endless sandworm racer in the style of Black Emperor.
// Side view with fake depth: the glowing spice trail winds toward and away from the camera.
// Two inputs only: the mouse wheel slides the worm nearer / farther, Space surges forward.
// Leave the trail or hit a rock and the run is over.

import {
  engineInit, vec2, rgb, Sound,
  drawRect, drawPoly,
  setCameraPos, setCameraScale, setCanvasClearColor, setCanvasFixedSize, setCanvasPixelated, glSetAntialias, setDebugWatermark,
  keyIsDown, keyWasPressed, mouseIsDown, mouseWasPressed,
  timeDelta, clamp, lerp, rand,
} from 'littlejsengine';

const GAME_TITLE = 'SAND EMPEROR';

///////////////////////////////////////////////////////////////////////////////
// screen & projection — everything is drawn in 320x180 pixel space, y down

const W = 320, H = 180;
const HORIZON = 78;           // screen y of the horizon
const LANES = 20;             // playable depth: lane 0 is nearest the camera, lane 20 farthest
const NEAR_Y = 170, FAR_Y = 100;
const PPU = 6;                // pixels per world unit at lane 0
// the camera rides the road at the world speed; the worm floats forward / back relative to it
const START_POS = -6;         // worm position relative to the camera center, in world units
const BACK_LIMIT = -24, FRONT_LIMIT = 22;  // past these the worm has left the screen
const BACK_WARN = -17, FRONT_WARN = 15;

const groundY = L => NEAR_Y - L*(NEAR_Y - FAR_Y)/LANES;
const depthScale = L => 1 - L*.0225;
let camX = 0, camSpeed = 0;
const screenX = (x, L) => W/2 + (x - camX)*PPU*depthScale(L);

///////////////////////////////////////////////////////////////////////////////
// tuning

const MAX_SPEED = 60;          // only used to normalize effects
const WHEEL_STEP = 1.4;       // lanes per standard wheel notch (100px of deltaY)
const KEY_STEER = 14;         // lanes/sec with arrow keys
const METERS = 2;             // meters per world unit
const KMH = METERS*3.6;
const SEGMENTS = 24, SEG_SPACING = .95, HEAD_R = 1.7;

///////////////////////////////////////////////////////////////////////////////
// palette — sunset desert

const hex = h => rgb(parseInt(h.slice(1, 3), 16)/255, parseInt(h.slice(3, 5), 16)/255, parseInt(h.slice(5, 7), 16)/255);
const SKY = ['#1e0b3a', '#3a1256', '#651a66', '#9c2462', '#d2434e', '#f27a45', '#ffb45e', '#ffd98a'].map(hex);
const GROUND = ['#f0a35c', '#e48e4c', '#d77a40', '#c66a38', '#b25a31', '#9c4c2b'].map(hex);
const MESA_FAR = hex('#6a2c5e'), MESA_MID = hex('#8c3a4c'), DUNE_FAR = hex('#c45a3c'), DUNE_TOP = hex('#de7448');
const SUN_TOP = hex('#fff2a8'), SUN_BOT = hex('#ff6f6a');
const RIPPLE = hex('#b4582e'), FORE = hex('#6e321e'), FORE_TOP = hex('#94472a');
const TRAIL_EDGE = hex('#c8401c'), TRAIL = hex('#ff7a1c'), TRAIL_CORE = hex('#ffc04a'), TRAIL_DASH = hex('#fff0a0');
const ROCK = hex('#5e3b30'), ROCK_HI = hex('#86574a'), ROCK_DK = hex('#2e1a16');
const BONE = hex('#ecdfc2'), BONE_DK = hex('#9c8a70');
const WOOD = hex('#8a5630'), WOOD_HI = hex('#b8803e'), WOOD_DK = hex('#3a2014');
const METAL = hex('#6a6470'), METAL_HI = hex('#9a94a0'), METAL_DK = hex('#3a3640');
const WORM_A = hex('#8a5a3c'), WORM_B = hex('#a06c48'), WORM_HI = hex('#c89464'), WORM_DK = hex('#3e2418');
const MAW = hex('#2a0a08'), MAW_IN = hex('#8a1c12'), TOOTH = hex('#fff4dc');
const SAND_SPRAY = hex('#ffd9a0');
const WHITE = rgb(1, 1, 1), BLACK = rgb(0, 0, 0), WARN = hex('#ff4a3a'), GOLD = hex('#ffd34a');

///////////////////////////////////////////////////////////////////////////////
// helpers

const DT = timeDelta;
const hash = n => { const s = Math.sin(n*127.1 + 311.7)*43758.5453; return s - Math.floor(s); };
const approach = (v, target, step) => v < target ? Math.min(v + step, target) : Math.max(v - step, target);
const smooth = t => t*t*(3 - 2*t);
const wp = (sx, sy) => vec2(sx, H - sy); // screen pixel -> world

function rect(x, y, w, h, color)
{
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w > 0 && h > 0)
    drawRect(vec2(x + w/2, H - y - h/2), vec2(w, h), color);
}

function poly(points, color)
{
  drawPoly(points.map(p => wp(Math.round(p.x), Math.round(p.y))), color);
}

// circle clipped at a ground line, so worm segments and boulders look half buried
function blob(cx, cy, r, ground, color)
{
  if (cy - r >= ground || r < .5) return;
  const n = clamp(Math.round(r*1.4), 8, 22), pts = [];
  for (let i = 0; i < n; i++)
  {
    const a = i/n*2*Math.PI;
    pts.push(vec2(cx + Math.cos(a)*r, Math.min(cy + Math.sin(a)*r, ground)));
  }
  poly(pts, color);
}

function ditherRow(y, color, phase=0)
{
  for (let x = phase; x < W; x += 2)
    rect(x, y, 1, 1, color);
}

function load(key, fallback)
{
  try { const v = localStorage.getItem('sandemperor.' + key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function save(key, value)
{
  try { localStorage.setItem('sandemperor.' + key, JSON.stringify(value)); } catch {}
}

///////////////////////////////////////////////////////////////////////////////
// 3x5 pixel font

const GLYPHS = {
  A:'010101111101101', B:'110101110101110', C:'011100100100011', D:'110101101101110', E:'111100110100111',
  F:'111100110100100', G:'011100101101011', H:'101101111101101', I:'111010010010111', J:'001001001101010',
  K:'101101110101101', L:'100100100100111', M:'101111111101101', N:'110101101101101', O:'010101101101010',
  P:'110101110100100', Q:'010101101110011', R:'110101110101101', S:'011100010001110', T:'111010010010010',
  U:'101101101101111', V:'101101101101010', W:'101101111111101', X:'101101010101101', Y:'101101010010010',
  Z:'111001010100111', 0:'111101101101111', 1:'010110010010111', 2:'110001010100111', 3:'110001010001110',
  4:'101101111001001', 5:'111100110001110', 6:'011100111101111', 7:'111001010010010', 8:'111101111101111',
  9:'111101111001110', ' ':'000000000000000', ':':'000010000010000', '.':'000000000000010', '!':'010010010000010',
  '-':'000000111000000', '/':'001001010100100', '<':'001010100010001', '>':'100010001010100', '?':'110001010000010',
  ',':'000000000010100', "'":'010010000000000', '+':'000010111010000',
};

function textWidth(s, scale=1) { return s.length*4*scale - scale; }

function drawPixelText(s, x, y, scale=1, color=WHITE, align='left', shadow=BLACK)
{
  s = String(s).toUpperCase();
  if (align == 'center') x -= textWidth(s, scale)/2;
  else if (align == 'right') x -= textWidth(s, scale);
  x = Math.round(x); y = Math.round(y);
  const pass = (ox, oy, c) =>
  {
    for (let i = 0; i < s.length; i++)
    {
      const g = GLYPHS[s[i]] || GLYPHS['?'];
      for (let j = 0; j < 15; j++)
        if (g[j] == '1')
          rect(x + ox + (i*4 + j % 3)*scale, y + oy + (j/3 | 0)*scale, scale, scale, c);
    }
  };
  if (shadow) pass(scale, scale, shadow);
  pass(0, 0, color);
}

///////////////////////////////////////////////////////////////////////////////
// progression — everything scales with meters travelled
//
//   0m     open sands: slow, wide and gentle, nothing in the way. Learn to steer.
//   450m   first fence. Fences stay rare for a while.
//   800m+  each stage raises the score multiplier, so pushing deeper is where the points are.
//   1500m+ chicanes (two fences from opposite sides).  2500m+ wrecks in the middle of the trail.
//   The world speed never stops rising.

const STAGES = [
  { m: 0,    name: 'THE OPEN SANDS',  mult: 1 },
  { m: 800,  name: 'THE FENCELANDS',  mult: 2 },
  { m: 2000, name: 'THE DEEP DESERT', mult: 3 },
  { m: 3500, name: 'WORM TERRITORY',  mult: 4 },
  { m: 5500, name: 'THE ENDLESS',     mult: 5 },
];
const stageAt = m => { let i = 0; while (i + 1 < STAGES.length && m >= STAGES[i + 1].m) i++; return i; };
const ramp = (m, start, end) => smooth(clamp((m - start)/(end - start)));

const baseSpeed = m => 10 + 34*(1 - Math.exp(-m/3500)) + m/1500;  // world scroll speed, keeps climbing forever
// the worm has its own speed: space accelerates it, letting go it sags behind the world
// space accelerates well past the world speed, letting go slows toward a stop:
// staying on screen means pulsing space to match the road. Gentler early on while you learn.
const topSpeed = m => baseSpeed(m)*1.7 + 6;
const surgeAccel = m => (5 + baseSpeed(m)*.45)*lerp(.6, 1, ramp(m, 0, 1500));
const coastDecel = m => (3 + baseSpeed(m)*.35)*lerp(.45, 1, ramp(m, 0, 1500));
const trailWidthAt = m => 3.4 + 4.6*Math.exp(-m/1800);            // lanes
const offTrailGrace = m => lerp(1, .4, ramp(m, 0, 3000));         // seconds off the trail before the run ends
const turnDemand = m => lerp(1.5, 11, ramp(m, 150, 6000));        // lanes/sec of steering the curves ask for
const straightChance = m => lerp(.45, .15, ramp(m, 0, 4000));
const FIRST_FENCE = 450;
// playtesting aid: open with ?start=2500 to begin a run that far in
const START_METERS = Math.max(0, +new URLSearchParams(location.search).get('start') || 0);
const hazardGap = m => lerp(320, 70, ramp(m, FIRST_FENCE, 6000)); // meters between hazards
const chicaneChance = m => m < 1500 ? 0 : lerp(.1, .45, ramp(m, 1500, 5000));
const wreckChance = m => m < 2500 ? 0 : lerp(.1, .3, ramp(m, 2500, 6000));
const fenceCover = m => lerp(.35, .6, ramp(m, FIRST_FENCE, 5000)); // fraction of the trail a fence blocks

///////////////////////////////////////////////////////////////////////////////
// the spice trail — the "fast path" the worm chases
// built from control points every TRAIL_SEG units and joined with a Catmull-Rom spline,
// so how hard the curves are can follow the progression exactly

const TRAIL_SEG = 12;
const TRAIL_START = -10*TRAIL_SEG;
let trailPts = [], trailDir = 1;

const trailWidth = x => trailWidthAt(Math.max(0, x*METERS));

function extendTrail(toX)
{
  while (TRAIL_START + (trailPts.length - 3)*TRAIL_SEG < toX)
  {
    const x = TRAIL_START + trailPts.length*TRAIL_SEG, m = Math.max(0, x*METERS);
    const prev = trailPts[trailPts.length - 1] ?? LANES/2;
    let L = LANES/2;
    if (m > 150)
    {
      const w = trailWidthAt(m), lo = w/2 + .8, hi = LANES - w/2 - .8;
      const maxDelta = turnDemand(m)*TRAIL_SEG/(baseSpeed(m)*1.5);
      if (rand() < .35) trailDir = -trailDir;
      const straight = rand() < straightChance(m);
      L = prev + (straight ? rand(-.2, .2) : trailDir*rand(.5, 1))*maxDelta;
      if (L < lo || L > hi)
      {
        trailDir = -trailDir;
        L = clamp(L, lo, hi);
      }
    }
    trailPts.push(L);
  }
}

function trailLane(x)
{
  const f = (x - TRAIL_START)/TRAIL_SEG, i = Math.floor(f), t = f - i;
  const p = k => trailPts[clamp(k, 0, trailPts.length - 1)];
  const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
  return .5*(2*p1 + (p2 - p0)*t + (2*p0 - 5*p1 + 4*p2 - p3)*t*t + (3*p1 - p0 - 3*p2 + p3)*t*t*t);
}

///////////////////////////////////////////////////////////////////////////////
// state

let state = 'title'; // title | settings | play | pause | over
let stateTime = 0, clock = 0;
let worm, obstacles, particles, popups, nextHazardX, nextSceneryX, score, shake, deathReason;
let best = load('best', 0);
let invert = load('invert', true);
let sensitivity = load('sensitivity', 1);
let wheelAccum = 0, menuWheel = 0;
let throttle = false;
let rumbleTime = 0, warnTime = 0;
let sfx = {};
let menu = null;

// raw wheel deltas so a trackpad's many small events and a mouse's notches both feel right
addEventListener('wheel', e =>
{
  let d = e.deltaY;
  if (e.deltaMode == 1) d *= 33;
  else if (e.deltaMode == 2) d *= 400;
  wheelAccum += d;
}, { passive: true });

function newGame()
{
  trailPts = [];
  trailDir = rand() < .5 ? 1 : -1;
  const x0 = state == 'play' ? START_METERS/METERS : 0;
  extendTrail(x0 + 200);
  const L = trailLane(x0);
  worm = { x: x0, L, targetL: L, speed: baseSpeed(x0*METERS), history: [], offTime: 0, headH: 1.9, dead: false,
    nextMilestone: Math.floor(x0*METERS/1000 + 1)*1000, stage: stageAt(x0*METERS) };
  for (let i = 60; i > 0; i--)
    worm.history.push({ x: x0 - i*.5, L: trailLane(x0 - i*.5) });
  obstacles = [];
  particles = [];
  popups = [];
  nextHazardX = Math.max(FIRST_FENCE/METERS, x0 + 40);
  nextSceneryX = x0 + 10;
  score = 0;
  shake = 0;
  camX = worm.x - START_POS;
  camSpeed = worm.speed;
}

function setState(s)
{
  state = s;
  stateTime = 0;
  menuWheel = 0;
  menu = s == 'title' ? titleMenu : s == 'settings' ? settingsMenu : s == 'pause' ? pauseMenu : null;
  if (menu) menu.sel = 0;
}

function popup(text, color=GOLD, size=2, life=1.4)
{
  popups.push({ text, color, size, life, maxLife: life });
}

///////////////////////////////////////////////////////////////////////////////
// menus — navigated with the same two inputs: wheel to move, space to choose

const SENSITIVITIES = [.5, .75, 1, 1.25, 1.5, 2, 2.5, 3];
const invertItem = { label: () => 'INVERT SCROLL: ' + (invert ? 'ON' : 'OFF'), act: () => { invert = !invert; save('invert', invert); } };
const sensItem = {
  label: () => 'SENSITIVITY: < ' + sensitivity.toFixed(2).replace(/0$/, '') + ' >',
  act: (dir=1) =>
  {
    const i = SENSITIVITIES.indexOf(sensitivity);
    sensitivity = SENSITIVITIES[(Math.max(0, i) + dir + SENSITIVITIES.length) % SENSITIVITIES.length];
    save('sensitivity', sensitivity);
  },
};
const titleMenu = { sel: 0, items: [
  { label: () => 'RIDE', act: () => { setState('play'); newGame(); } },
  { label: () => 'SETTINGS', act: () => setState('settings') },
]};
const settingsMenu = { sel: 0, items: [invertItem, sensItem, { label: () => 'BACK', act: () => setState('title') }] };
const pauseMenu = { sel: 0, items: [
  { label: () => 'RESUME', act: () => setState('play') },
  invertItem, sensItem,
  { label: () => 'QUIT TO TITLE', act: () => { newGame(); setState('title'); } },
]};

function updateMenu()
{
  menuWheel += wheelAccum;
  let move = 0;
  while (menuWheel >= 80) { move++; menuWheel -= 80; }
  while (menuWheel <= -80) { move--; menuWheel += 80; }
  if (keyWasPressed('ArrowDown') || keyWasPressed('KeyS')) move++;
  if (keyWasPressed('ArrowUp') || keyWasPressed('KeyW')) move--;
  if (move)
  {
    menu.sel = clamp(menu.sel + Math.sign(move), 0, menu.items.length - 1);
    sfx.blip.play(undefined, .5);
  }
  const item = menu.items[menu.sel];
  if (item == sensItem && (keyWasPressed('ArrowLeft') || keyWasPressed('ArrowRight')))
  {
    item.act(keyWasPressed('ArrowLeft') ? -1 : 1);
    sfx.blip.play(undefined, .5, 1.3);
  }
  else if (stateTime > .1 && (keyWasPressed('Space') || keyWasPressed('Enter') || mouseWasPressed(0)))
  {
    sfx.select.play();
    item.act();
  }
}

function drawMenu(m, y)
{
  m.items.forEach((item, i) =>
  {
    const s = item.label(), sel = i == m.sel;
    const pulse = sel && clock % .5 < .25;
    drawPixelText(s, W/2, y + i*12, 1, sel ? GOLD : WHITE.scale(.8, 1), 'center');
    if (sel)
    {
      const w = textWidth(s)/2 + 6 + (pulse ? 1 : 0);
      drawPixelText('>', W/2 - w - 3, y + i*12, 1, GOLD, 'left');
      drawPixelText('<', W/2 + w, y + i*12, 1, GOLD, 'left');
    }
  });
}

///////////////////////////////////////////////////////////////////////////////
// obstacles

// a sand fence reaching in from one edge of the trail, leaving a gap on the other side
function addFence(x, side, cover)
{
  const c = trailLane(x), w = trailWidth(x);
  cover = Math.min(cover, 1 - 1.9/w); // always leave room to slip through
  const edge = c + side*(w/2 + .5), inner = c + side*(w/2 - cover*w);
  obstacles.push({ kind: 'fence', x, L0: Math.min(edge, inner), L1: Math.max(edge, inner), side, halfX: .6 });
}

function spawnHazard(x)
{
  const m = x*METERS, c = trailLane(x), w = trailWidth(x);
  if (rand() < wreckChance(m))
  {
    // a wrecked harvester in the middle: pass on either side
    const half = Math.min(w*lerp(.15, .22, ramp(m, 2500, 6000)), w/2 - 1.5);
    obstacles.push({ kind: 'wreck', x, L0: c - half, L1: c + half, halfX: 1.1, seed: rand(99) });
    return;
  }
  const side = rand() < .5 ? 1 : -1;
  addFence(x, side, fenceCover(m));
  if (rand() < chicaneChance(m))
    addFence(x + Math.max(9, baseSpeed(m)*.75), -side, fenceCover(m));
}

function spawnAhead()
{
  extendTrail(camX + 160);
  while (nextHazardX < camX + 75)
  {
    spawnHazard(nextHazardX);
    nextHazardX += hazardGap(nextHazardX*METERS)/METERS*rand(.75, 1.3);
  }
  // harmless roadside scenery for depth
  while (nextSceneryX < camX + 75)
  {
    const x = nextSceneryX, c = trailLane(x), w = trailWidth(x);
    const kind = rand() < .5 ? 'boulder' : rand() < .5 ? 'ribs' : 'spire';
    const L = c + (rand() < .5 ? -1 : 1)*(w/2 + rand(2.5, 8));
    obstacles.push({ kind, x, L: clamp(L, -2, LANES + 4), r: kind == 'boulder' ? 1.2 : kind == 'ribs' ? .9 : .8, seed: rand(99) });
    nextSceneryX += rand(6, 20);
  }
}

///////////////////////////////////////////////////////////////////////////////
// particles live in world space: x, lane, height

function emit(x, L, h, vx, vL, vh, life, size, color, gravity=18)
{
  particles.push({ x, L, h, vx, vL, vh, life, maxLife: life, size, color, gravity });
}

function sandBurst(x, L, count, power)
{
  for (let i = 0; i < count; i++)
    emit(x, L, 0, rand(-power, power), rand(-power, power)*.3, rand(power*.5, power*1.4),
      rand(.5, 1.1), rand() < .5 ? 2 : 1, rand() < .7 ? SAND_SPRAY : GROUND[2]);
}

///////////////////////////////////////////////////////////////////////////////
// worm

function laneAt(x)
{
  const h = worm.history;
  if (x <= h[0].x) return h[0].L;
  let lo = 0, hi = h.length - 1;
  while (hi - lo > 1)
  {
    const mid = (lo + hi) >> 1;
    if (h[mid].x < x) lo = mid; else hi = mid;
  }
  const a = h[lo], b = h[hi];
  return lerp(a.L, b.L, (x - a.x)/(b.x - a.x || 1));
}

function die(reason)
{
  if (worm.dead) return;
  worm.dead = true;
  deathReason = reason;
  shake = 1;
  sandBurst(worm.x, worm.L, 60, 14);
  sfx.crash.play();
  if (score > best)
  {
    best = Math.floor(score);
    save('best', best);
    worm.newBest = true;
  }
  setState('over');
}

function updateWorm()
{
  const playing = state == 'play';
  const c = trailLane(worm.x), w = trailWidth(worm.x);

  // steering: wheel slides the worm nearer / farther
  if (playing)
  {
    let steer = clamp(wheelAccum/100*WHEEL_STEP*sensitivity*(invert ? 1 : -1), -5, 5);
    if (keyIsDown('ArrowUp') || keyIsDown('KeyW')) steer += KEY_STEER*DT;
    if (keyIsDown('ArrowDown') || keyIsDown('KeyS')) steer -= KEY_STEER*DT;
    worm.targetL = clamp(worm.targetL + steer, -.5, LANES + .5);
  }
  else if (state == 'title' || state == 'settings')
    worm.targetL = trailLane(worm.x + 4); // attract-mode autopilot
  worm.L += (worm.targetL - worm.L)*(1 - Math.exp(-12*DT));

  // speed: the world keeps getting faster, space surges on top of it
  const meters = worm.x*METERS;
  const base = baseSpeed(meters);
  throttle = playing && (keyIsDown('Space') || mouseIsDown(0));
  const offTrail = Math.abs(worm.L - c) > w/2 + .25;
  if (worm.dead)
    worm.speed = approach(worm.speed, 0, 30*DT);
  else if (!playing)
    worm.speed = base; // attract mode just rides along
  else if (offTrail)
    worm.speed = approach(worm.speed, base*.5, 30*DT);
  else if (throttle)
    worm.speed = approach(worm.speed, topSpeed(meters), surgeAccel(meters)*DT);
  else
    worm.speed = approach(worm.speed, 0, coastDecel(meters)*DT);

  const dx = worm.speed*DT;
  worm.x += dx;
  worm.history.push({ x: worm.x, L: worm.L });
  while (worm.history.length > 2 && worm.history[1].x < worm.x - SEGMENTS*SEG_SPACING - 4)
    worm.history.shift();

  // head rises out of the sand while alive, dives when the run ends
  worm.headH = worm.dead ? approach(worm.headH, -4, 5*DT) : 1.9 + .25*Math.sin(clock*5);

  if (!playing) return;

  // score: deeper stages multiply it
  const stage = stageAt(meters);
  // riding further ahead of center is riskier, so it scores up to double
  const ahead = clamp((worm.x - camX - START_POS)/(FRONT_LIMIT - START_POS));
  score += camSpeed*DT*METERS*STAGES[stage].mult*(1 + ahead);
  if (stage > worm.stage)
  {
    worm.stage = stage;
    popup(STAGES[stage].name, GOLD, 2, 2.2);
    popup('SCORE X' + STAGES[stage].mult, WHITE, 1, 2.2);
    sfx.milestone.play(undefined, 1, 1.2);
  }
  else if (meters >= worm.nextMilestone)
  {
    popup(worm.nextMilestone + 'M!');
    sfx.milestone.play();
  }
  if (meters >= worm.nextMilestone) worm.nextMilestone += 1000;

  // leaving the trail ends the run after a grace period that shrinks as you go
  if (offTrail)
  {
    worm.offTime += DT;
    warnTime -= DT;
    if (warnTime <= 0) { sfx.warn.play(); warnTime = .15; }
    if (worm.offTime > offTrailGrace(meters)) die('LOST THE SPICE TRAIL');
  }
  else
    worm.offTime = Math.max(0, worm.offTime - DT*2);

  // fall too far behind the scrolling world and you're gone
  const rel = worm.x - camX;
  if (rel < BACK_LIMIT) die('LEFT BEHIND');
  else if (rel > FRONT_LIMIT) die('OVERSHOT THE ROAD');

  // fences and wrecks block a span of lanes at one spot on the trail
  const HIT = .55;
  for (const o of obstacles)
  {
    if (o.kind != 'fence' && o.kind != 'wreck') continue;
    if (Math.abs(o.x - worm.x) < o.halfX && worm.L > o.L0 - HIT && worm.L < o.L1 + HIT)
    {
      die(o.kind == 'fence' ? 'CRASHED THROUGH A FENCE' : 'HIT A WRECKED HARVESTER');
      break;
    }
    if (!o.passed && o.x < worm.x - o.halfX)
    {
      o.passed = true;
      const miss = worm.L < o.L0 ? o.L0 - HIT - worm.L : worm.L - o.L1 - HIT;
      if (miss < .8)
      {
        const pts = 50*STAGES[stage].mult;
        score += pts;
        popup('CLOSE! +' + pts, SAND_SPRAY, 1, .9);
        sfx.near.play();
      }
    }
  }

  // engine-like rumble that speeds up with the worm
  rumbleTime -= DT;
  if (rumbleTime <= 0)
  {
    sfx.rumble.play(undefined, .18 + throttle*.12, .7 + worm.speed/60);
    rumbleTime = Math.max(.07, .22 - worm.speed*.003);
  }
}

function updateWorld()
{
  // the world scrolls on its own; a fast worm can push it along, a slow one slides off the left
  camSpeed = worm.dead ? approach(camSpeed, 0, 25*DT) : baseSpeed(camX*METERS);
  camX += camSpeed*DT;
  spawnAhead();
  obstacles = obstacles.filter(o => o.x > camX - 80);

  // sand spray where the head and body break the surface
  if (!worm.dead || worm.headH > -2)
  {
    const s = worm.speed/MAX_SPEED;
    for (let i = 0; i < 1 + s*3; i++)
      emit(worm.x + rand(-.5, .5), worm.L + rand(-.8, .8), 0, rand(-4, 2) - s*6, rand(-1, 1), rand(3, 9)*(.5 + s),
        rand(.3, .7), rand() < .3 ? 2 : 1, SAND_SPRAY);
    for (let i = 3; i < SEGMENTS; i += 2)
    {
      const x = worm.x - i*SEG_SPACING, h = bodyHeight(i, x);
      if (Math.abs(h) < .4 && rand() < .5)
        emit(x, laneAt(x), 0, rand(-2, 2), rand(-.5, .5), rand(2, 6), rand(.3, .6), 1, SAND_SPRAY);
    }
  }
  // spice sparkles when surging on the trail
  if (throttle && rand() < .7)
    emit(worm.x - rand(2), worm.L + rand(-1, 1), rand(.5, 2), -worm.speed*.3, 0, rand(1, 3), .5, 1, TRAIL_DASH, 4);

  for (const p of particles)
  {
    p.x += p.vx*DT; p.L += p.vL*DT; p.h += p.vh*DT;
    p.vh -= p.gravity*DT;
    p.life -= DT;
  }
  particles = particles.filter(p => p.life > 0 && p.h > -.5);

  for (const p of popups) p.life -= DT;
  popups = popups.filter(p => p.life > 0);
}

///////////////////////////////////////////////////////////////////////////////
// rendering

const parallaxShift = factor => camX*PPU*factor;

function drawSky()
{
  const bandH = HORIZON/SKY.length;
  SKY.forEach((c, i) => rect(0, i*bandH, W, bandH + 1, c));
  for (let i = 1; i < SKY.length; i++)
  {
    const y = Math.round(i*bandH);
    ditherRow(y - 1, SKY[i], 0);
    ditherRow(y, SKY[i - 1], 1);
  }

  // striped synthwave sun sinking behind the mesas
  const cx = 228, cy = 58, r = 32;
  for (let y = cy - r; y < HORIZON; y++)
  {
    const dy = y - cy;
    if (Math.abs(dy) > r) continue;
    if (dy > 2 && dy % 6 < 1 + dy/9) continue; // horizontal gaps
    const hw = Math.sqrt(r*r - dy*dy);
    rect(cx - hw, y, hw*2, 1, SUN_TOP.lerp(SUN_BOT, (dy + r)/(2*r)));
  }

  // wispy clouds drifting slowly
  for (let i = 0; i < 6; i++)
  {
    const span = W + 120;
    const x = ((hash(i)*span - parallaxShift(.015) - clock*2) % span + span) % span - 60;
    const y = 10 + hash(i + 7)*40, w = 30 + hash(i + 3)*50;
    rect(x, y, w, 1, SKY[5].scale(1.1, 1));
    rect(x + 8, y + 2, w*.6, 1, SKY[4].scale(1.2, 1));
  }
}

// a scrolling silhouette layer drawn in 2px columns
function drawRidge(factor, heightAt, color, topColor)
{
  const shift = parallaxShift(factor);
  for (let x = 0; x < W; x += 2)
  {
    const u = Math.floor((x + shift)/2)*2;
    const h = Math.round(heightAt(u));
    if (h <= 0) continue;
    rect(x, HORIZON - h, 2, h, color);
    if (topColor) rect(x, HORIZON - h, 2, 1, topColor);
  }
}

function mesaHeight(u, size, scale, chance)
{
  const s = Math.floor(u/size), t = (u - s*size)/size;
  const hs = hash(s*1.37 + scale);
  if (hs > chance) return 2 + 2*Math.sin(u*.05);
  const top = scale*(.45 + hash(s*2.1 + scale)*.55);
  const edge = Math.min(t, 1 - t)/.12;
  const notch = hash(Math.floor(u/6) + s) < .2 ? 2 : 0;
  return edge >= 1 ? top - notch : Math.max(2, top*smooth(clamp(edge)));
}

function drawGround()
{
  // banded sand fading darker toward the camera
  const span = H - HORIZON, bandH = span/GROUND.length;
  GROUND.forEach((c, i) => rect(0, HORIZON + i*bandH, W, bandH + 1, c));
  for (let i = 1; i < GROUND.length; i++)
    ditherRow(Math.round(HORIZON + i*bandH) - 1, GROUND[i], i % 2);
  rect(0, HORIZON, W, 1, SKY[7]); // horizon glow

  // ripple marks scrolling with depth-correct parallax
  for (let L = -2; L <= 26; L += 1.5)
  {
    const y = groundY(L), s = depthScale(L);
    if (y < HORIZON + 2) continue;
    const reach = (W/2 + 20)/(PPU*s);
    for (let gx = Math.floor((camX - reach)/4); gx <= (camX + reach)/4; gx++)
    {
      const x = gx*4 + hash(gx + L*13)*3;
      const tc = trailLane(x);
      if (Math.abs(L - tc) < trailWidth(x)/2 + .5) continue;
      rect(screenX(x, L), y, Math.max(1, 3*s), 1, RIPPLE);
    }
  }
}

function drawTrail()
{
  const step = 1.5;
  const start = Math.floor((camX - 70)/step)*step;
  for (let x = start; x < camX + 70; x += step)
  {
    const quad = (fraction, color, x0=x, x1=x + step) =>
    {
      const c0 = trailLane(x0), c1 = trailLane(x1);
      const w0 = trailWidth(x0)*fraction/2, w1 = trailWidth(x1)*fraction/2;
      poly([
        vec2(screenX(x0, c0 + w0), groundY(c0 + w0)),
        vec2(screenX(x1, c1 + w1), groundY(c1 + w1)),
        vec2(screenX(x1, c1 - w1), groundY(c1 - w1)),
        vec2(screenX(x0, c0 - w0), groundY(c0 - w0)),
      ], color);
    };
    quad(1.08, TRAIL_EDGE);
    quad(.92, TRAIL);
    quad(.4, TRAIL_CORE);
    if (Math.floor(x/step) % 3 == 0) // center dashes sell the speed
      quad(.12, TRAIL_DASH, x, x + step*1.4);
  }
}

const project = (x, L, h=0) => vec2(screenX(x, L), groundY(L) - h*PPU*depthScale(L));
const FENCE_STEP = .7, FENCE_H = 2.6;

// one post of a sand fence, plus the slats running to the next nearer post
function drawFencePost(o, L, nextL, isInner)
{
  const u = PPU*depthScale(L), base = project(o.x, L), top = project(o.x, L, FENCE_H);
  if (base.x < -20 || base.x > W + 20) return;
  if (nextL != undefined)
    for (const [h, color] of [[FENCE_H*.82, WOOD_HI], [FENCE_H*.45, WOOD]])
    {
      const a = project(o.x, L, h), b = project(o.x, nextL, h), t = Math.max(2, u*.32);
      poly([vec2(a.x, a.y - 1), vec2(b.x, b.y - 1), vec2(b.x, b.y + t), vec2(a.x, a.y + t)], WOOD_DK);
      poly([vec2(a.x, a.y), vec2(b.x, b.y), vec2(b.x, b.y + t - 1), vec2(a.x, a.y + t - 1)], color);
    }
  const pw = Math.max(2, Math.round(u*.5));
  rect(base.x - pw/2 - 1, top.y - 1, pw + 2, base.y - top.y + 1, WOOD_DK);
  rect(base.x - pw/2, top.y, pw, base.y - top.y, WOOD);
  rect(base.x - pw/2, top.y, 1, base.y - top.y, WOOD_HI);
  if (isInner) // red flag marks the end you steer around
  {
    const flap = Math.sin(clock*12 + o.x)*u*.15;
    poly([vec2(top.x, top.y - u*.6), vec2(top.x + u*.9, top.y - u*.35 + flap), vec2(top.x, top.y - u*.05)], WARN);
    rect(top.x - .5, top.y - u*.7, 1, u*.7, WOOD_DK);
  }
}

function fenceItems(o)
{
  const items = [], n = Math.max(1, Math.round((o.L1 - o.L0)/FENCE_STEP));
  const inner = o.side > 0 ? 0 : n;
  // dark band on the ground across the blocked lanes, so the gap reads at a glance
  items.push({ L: o.L1 + .01, draw: () => poly([
    project(o.x - .7, o.L1), project(o.x + .7, o.L1), project(o.x + .7, o.L0), project(o.x - .7, o.L0)], BLACK.scale(0, .35)) });
  for (let k = 0; k <= n; k++)
  {
    const L = lerp(o.L0, o.L1, k/n), nextL = k ? lerp(o.L0, o.L1, (k - 1)/n) : undefined;
    items.push({ L, draw: () => drawFencePost(o, L, nextL, k == inner) });
  }
  return items;
}

// a wrecked spice harvester lying across the middle of the trail
function drawWreck(o)
{
  const x0 = o.x - o.halfX, x1 = o.x + o.halfX, h = 1.5;
  if (screenX(x1, o.L0) < -30 || screenX(x0, o.L1) > W + 30) return;
  const P = project;
  rect(P(x0, o.L0).x - 2, P(x0, o.L0).y - 1, P(x1, o.L0).x - P(x0, o.L0).x + 4, 3, BLACK.scale(0, .3));
  poly([P(x0, o.L1, h), P(x1, o.L1, h), P(x1, o.L0, h), P(x0, o.L0, h)], METAL_HI);          // top
  poly([P(x1, o.L1, 0), P(x1, o.L1, h), P(x1, o.L0, h), P(x1, o.L0, 0)], METAL_DK);          // end
  poly([P(x0, o.L0, 0), P(x1, o.L0, 0), P(x1, o.L0, h), P(x0, o.L0, h)], METAL);             // side
  poly([P(x0, o.L0, .1), P(x1, o.L0, .1), P(x1, o.L0, .45), P(x0, o.L0, .45)], METAL_DK);    // treads
  poly([P(x0, o.L0, .9), P(x1, o.L0, .9), P(x1, o.L0, 1.05), P(x0, o.L0, 1.05)], TRAIL_EDGE); // rust stripe
  const cl = lerp(o.L0, o.L1, .3), ch = lerp(o.L0, o.L1, .7);
  poly([P(o.x - .3, ch, h), P(o.x + .5, ch, h), P(o.x + .5, cl, h), P(o.x - .3, cl, h)], MAW); // smashed cockpit
  if (state != 'pause' && rand() < .15) // smouldering
    emit(o.x + rand(-.5, .5), lerp(o.L0, o.L1, rand()), h, rand(-1, 1), 0, rand(2, 4), .8, 1, METAL_DK, -2);
}

function drawObstacle(o)
{
  const s = depthScale(o.L), gy = groundY(o.L), sx = screenX(o.x, o.L), u = PPU*s;
  if (sx < -40 || sx > W + 40) return;
  rect(sx - o.r*u*1.2, gy - 1, o.r*u*2.4, 2, BLACK.scale(0, .25)); // contact shadow
  if (o.kind == 'boulder')
  {
    const R = o.r*u;
    blob(sx + R*.5, gy - R*.3, R*.75 + 1, gy, ROCK_DK);
    blob(sx + R*.5, gy - R*.3, R*.75, gy, ROCK);
    blob(sx - R*.2, gy - R*.55, R + 1, gy, ROCK_DK);
    blob(sx - R*.2, gy - R*.55, R, gy, ROCK);
    blob(sx - R*.5, gy - R*.9, R*.45, gy, ROCK_HI);
  }
  else if (o.kind == 'spire')
  {
    const w = o.r*u, h = (3.5 + hash(o.seed)*2)*u;
    const pts = [vec2(sx - w*1.1, gy), vec2(sx - w*.7, gy - h*.6), vec2(sx - w*.45, gy - h), vec2(sx + w*.2, gy - h*.92),
      vec2(sx + w*.6, gy - h*.5), vec2(sx + w*1.1, gy)];
    poly(pts.map(p => vec2(p.x + (p.x < sx ? -1 : 1), p.y - (p.y < gy ? 1 : 0))), ROCK_DK);
    poly(pts, ROCK);
    poly([vec2(sx - w*.7, gy - h*.6), vec2(sx - w*.45, gy - h), vec2(sx - w*.15, gy - h*.95), vec2(sx - w*.3, gy - h*.3)], ROCK_HI);
  }
  else // giant ribcage poking out of the sand
  {
    const h = 3.2*u;
    for (let k = 0; k < 3; k++)
    {
      const bx = sx + (k - 1)*o.r*u*1.1;
      const pts = [];
      for (let t = 0; t <= 1.001; t += .2)
        pts.push(vec2(bx + Math.sin(t*2.6)*u*1.3, gy - Math.sin(t*1.4)*h));
      for (let i = 0; i < pts.length - 1; i++)
      {
        const a = pts[i], b = pts[i + 1], th = Math.max(1, u*.45*(1 - i*.12));
        poly([vec2(a.x - th - 1, a.y), vec2(a.x + th + 1, a.y), vec2(b.x + th, b.y - 1), vec2(b.x - th, b.y - 1)], BONE_DK);
        poly([vec2(a.x - th, a.y), vec2(a.x + th, a.y), vec2(b.x + th - 1, b.y), vec2(b.x - th + 1, b.y)], BONE);
      }
    }
  }
}

// body undulates in humps fixed to the ground, blending into the raised head
function bodyHeight(i, x)
{
  const wave = 2*Math.sin(x*.32) - .5;
  return lerp(worm.headH, wave, smooth(clamp(i/6)));
}

function drawWormPart(x, L, h, r, color, i)
{
  const s = depthScale(L), gy = groundY(L), u = PPU*s;
  const sx = screenX(x, L), sy = gy - h*u, R = r*u;
  if (h + r < 0) return;
  blob(sx, sy, R + 1, gy, WORM_DK);
  blob(sx, sy, R, gy, color);
  blob(sx - R*.15, sy - R*.45, R*.45, gy, WORM_HI);
  if (Math.abs(h) < r) // sand piled where the body breaks the surface
    rect(sx - R*1.2, gy - 1, R*2.4, 2, SAND_SPRAY);
  if (i == 0) drawMaw(sx, sy, R, gy);
}

function drawMaw(sx, sy, R, gy)
{
  const open = .75 + (throttle ? .2 : 0) + Math.sin(clock*8)*.05;
  const mx = sx + R*.62, rx = Math.max(2, R*.32*open), ry = R*.78*open;
  const ell = (k, color) =>
  {
    const pts = [];
    for (let i = 0; i < 14; i++)
    {
      const a = i/14*2*Math.PI;
      pts.push(vec2(mx + Math.cos(a)*rx*k, Math.min(sy + Math.sin(a)*ry*k, gy)));
    }
    poly(pts, color);
  };
  ell(1.15, WORM_DK);
  ell(1, MAW);
  ell(.5, MAW_IN);
  for (let k = 0; k < 9; k++) // ring of teeth pointing inward
  {
    const a = k/9*2*Math.PI;
    const ex = mx + Math.cos(a)*rx, ey = sy + Math.sin(a)*ry;
    if (ey > gy) continue;
    const tx = mx + Math.cos(a)*rx*.45, ty = sy + Math.sin(a)*ry*.55;
    const px = -Math.sin(a)*1.6, py = Math.cos(a)*1.6;
    poly([vec2(ex - px, ey - py), vec2(ex + px, ey + py), vec2(tx, ty)], TOOTH);
  }
}

function drawScene()
{
  drawSky();
  drawRidge(.03, u => mesaHeight(u, 70, 30, .6), MESA_FAR);
  drawRidge(.08, u => mesaHeight(u + 999, 44, 17, .45), MESA_MID);
  drawRidge(.18, u => 4 + 2.5*Math.sin(u*.031) + 1.5*Math.sin(u*.083), DUNE_FAR, DUNE_TOP);
  drawGround();
  drawTrail();

  // painter's order: far lanes first
  const items = [];
  for (const o of obstacles)
  {
    if (o.kind == 'fence') items.push(...fenceItems(o));
    else if (o.kind == 'wreck') items.push({ L: (o.L0 + o.L1)/2, draw: () => drawWreck(o) });
    else items.push({ L: o.L, draw: () => drawObstacle(o) });
  }
  for (let i = SEGMENTS; i >= 0; i--)
  {
    const x = worm.x - i*SEG_SPACING, L = laneAt(x);
    const r = i ? lerp(1.5, .5, Math.pow(i/SEGMENTS, 1.2)) : HEAD_R;
    const color = i % 2 ? WORM_A : WORM_B;
    const h = i ? bodyHeight(i, x) : worm.headH;
    items.push({ L: L + i*1e-4, draw: () => drawWormPart(x, L, h, r, color, i) });
  }
  // head shadow
  const hs = depthScale(worm.L);
  rect(screenX(worm.x, worm.L) - HEAD_R*PPU*hs, groundY(worm.L) - 1, HEAD_R*PPU*hs*2, 2, BLACK.scale(0, .3));
  items.sort((a, b) => b.L - a.L);
  for (const it of items) it.draw();

  for (const p of particles)
    rect(screenX(p.x, p.L), groundY(p.L) - p.h*PPU*depthScale(p.L), p.size, p.size, p.color);

  // fast foreground dune lip
  const shift = parallaxShift(1.5);
  for (let x = 0; x < W; x += 2)
  {
    const u = Math.floor((x + shift)/2)*2;
    const h = Math.round(4 + 2.5*Math.sin(u*.045) + 1.5*Math.sin(u*.11));
    rect(x, H - h, 2, h, FORE);
    rect(x, H - h, 2, 1, FORE_TOP);
  }
}

function drawHud()
{
  drawPixelText('SCORE', 6, 5, 1, SKY[6]);
  drawPixelText(Math.floor(score), 6, 12, 2, WHITE);
  drawPixelText(Math.floor(worm.x*METERS) + 'M', W/2, 5, 2, WHITE, 'center');
  const st = STAGES[worm.stage];
  drawPixelText(st.name + '  X' + st.mult, W/2, 19, 1, st.mult > 1 ? GOLD : SKY[6], 'center');
  const kmh = Math.round(worm.speed*KMH);
  drawPixelText('KM/H', W - 6, 5, 1, SKY[6], 'right');
  drawPixelText(kmh, W - 6, 12, 2, throttle ? GOLD : WHITE, 'right');

  // pace gauge: the white tick is the road's speed, match it to hold your place
  const t = clamp(worm.speed/(2*camSpeed || 1));
  const matched = Math.abs(t - .5) < .06;
  rect(W - 56, 24, 50, 3, BLACK.scale(0, .5));
  rect(W - 56, 24, 50*t, 3, matched ? GOLD : t > .5 ? WARN : TRAIL);
  rect(W - 31, 22, 1, 7, WHITE);

  if (worm.offTime > 0 && !worm.dead && clock % .2 < .12)
    drawPixelText('STAY ON THE TRAIL!', W/2, 52, 2, WARN, 'center');
  // edge warnings as the worm drifts toward either side of the screen
  const rel = worm.x - camX;
  const back = (BACK_WARN - rel)/(BACK_WARN - BACK_LIMIT), front = (rel - FRONT_WARN)/(FRONT_LIMIT - FRONT_WARN);
  if (!worm.dead && state == 'play' && (back > 0 || front > 0))
  {
    const left = back > 0, a = Math.min(1, left ? back : front)*(clock % .25 < .15 ? 1 : .5);
    for (let y = 30; y < H - 12; y += 12)
      drawPixelText(left ? '<' : '>', left ? 3 : W - 3, y, 2, WARN.scale(1, a), left ? 'left' : 'right');
    if (clock % .3 < .18)
      drawPixelText(left ? 'KEEP UP! HOLD SPACE' : 'TOO FAST! EASE OFF', W/2, 66, 2, WARN, 'center');
  }


  let py = 34;
  for (const p of popups)
  {
    drawPixelText(p.text, W/2, py - (p.maxLife - p.life)*6, p.size, p.color.scale(1, Math.min(1, p.life*2)), 'center');
    py += p.size*6 + 2;
  }

  // first-run coaching, gone once you're past the basics
  const m = worm.x*METERS;
  const hint = m < 260 ? 'PULSE SPACE TO MATCH THE ROAD - STAY ON SCREEN'
    : m < 380 ? 'RIDING FURTHER AHEAD SCORES MORE'
    : m < FIRST_FENCE + 20 ? 'FENCE AHEAD - STEER AROUND THE RED FLAG' : '';
  if (hint && state == 'play' && best < 1500)
  {
    drawPixelText(hint, W/2, H - 26, 1, WHITE, 'center');
    if (m < 260) drawPixelText('SCROLL TO FOLLOW THE GLOWING TRAIL', W/2, H - 18, 1, WHITE, 'center');
  }
}

function drawTitle()
{
  rect(0, 0, W, H, BLACK.scale(0, .35));
  const bob = Math.round(Math.sin(clock*2)*2);
  drawPixelText(GAME_TITLE, W/2, 30 + bob, 4, GOLD, 'center', hex('#5a1a2a'));
  drawPixelText('RIDE THE SPICE TRAIL. NEVER STOP.', W/2, 58, 1, SKY[7], 'center');
}

function drawOverlay()
{
  if (state == 'title')
  {
    drawTitle();
    drawMenu(titleMenu, 84);
    drawPixelText('WHEEL - STEER     SPACE - SURGE', W/2, 128, 1, WHITE.scale(.85, 1), 'center');
    if (best) drawPixelText('BEST ' + best, W/2, 140, 1, GOLD, 'center');
  }
  else if (state == 'settings')
  {
    drawTitle();
    drawPixelText('SETTINGS', W/2, 76, 2, WHITE, 'center');
    drawMenu(settingsMenu, 96);
    drawPixelText('WHEEL - MOVE   SPACE - CHANGE', W/2, 140, 1, WHITE.scale(.7, 1), 'center');
  }
  else if (state == 'pause')
  {
    rect(0, 0, W, H, BLACK.scale(0, .5));
    drawPixelText('PAUSED', W/2, 40, 3, GOLD, 'center');
    drawMenu(pauseMenu, 74);
  }
  else if (state == 'over' && stateTime > .6)
  {
    const a = Math.min(1, (stateTime - .6)*3);
    rect(0, 0, W, H, BLACK.scale(0, .5*a));
    drawPixelText(deathReason, W/2, 40, 2, WARN, 'center');
    drawPixelText(Math.floor(worm.x*METERS) + ' M', W/2, 62, 3, WHITE, 'center');
    drawPixelText('SCORE ' + Math.floor(score), W/2, 88, 2, WHITE, 'center');
    if (worm.newBest)
      drawPixelText('NEW BEST!', W/2, 106, 2, clock % .5 < .3 ? GOLD : TRAIL, 'center');
    else
      drawPixelText('BEST ' + best, W/2, 106, 1, GOLD, 'center');
    if (stateTime > 1.2 && clock % 1 < .7)
      drawPixelText('SPACE - RIDE AGAIN', W/2, 132, 1, WHITE, 'center');
    drawPixelText('ESC - MENU', W/2, 146, 1, WHITE.scale(.7, 1), 'center');
  }
}

///////////////////////////////////////////////////////////////////////////////
// engine callbacks

function gameInit()
{
  setCanvasClearColor(SKY[0]);
  sfx = {
    crash:     new Sound([2, .1, 70, .01, .25, .7, 4, 2.2, , , , , , 1.6, , .3, , .4, .2]),
    warn:      new Sound([.4, , 880, , .02, .04, 1, 1.5]),
    rumble:    new Sound([.5, .2, 55, .01, .03, .08, 4, 2, , , , , , 3]),
    milestone: new Sound([.8, , 520, .02, .1, .3, 1, 1.5, , , 260, .08]),
    blip:      new Sound([.4, , 660, , .01, .04, 1, 1.5]),
    select:    new Sound([.6, , 440, .01, .05, .15, 1, 1.5, , , 440, .04]),
    near:      new Sound([.5, .05, 900, .01, .02, .08, 1, 1.5, 30]),
  };
  newGame();
  setState('title');
}

function gameUpdate()
{
  clock += DT;
  stateTime += DT;

  if (menu)
    updateMenu();
  else if (state == 'play' && (keyWasPressed('Escape') || keyWasPressed('KeyP')))
    setState('pause');
  else if (state == 'over')
  {
    if (stateTime > 1.2 && keyWasPressed('Space')) { setState('play'); newGame(); }
    else if (keyWasPressed('Escape')) { newGame(); setState('title'); }
  }

  if (state != 'pause')
  {
    updateWorm();
    updateWorld();
  }
  wheelAccum = 0;
  shake = Math.max(0, shake - DT*2);
}

function gameUpdatePost()
{
  setCameraScale(1);
  setCameraPos(vec2(W/2 + Math.round(rand(-1, 1)*shake*3), H/2 + Math.round(rand(-1, 1)*shake*3)));
}

function gameRender()
{
  drawScene();
  if (state == 'play' || state == 'pause' || state == 'over')
    drawHud();
  drawOverlay();
}

setCanvasFixedSize(vec2(W, H));
setCanvasPixelated(true);
glSetAntialias(false);
setDebugWatermark(false);
engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender);
