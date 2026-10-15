// SPICE DREAMER — an endless sandworm racer across the deep desert, in the style of Black Emperor.
// Side view: the camera scrolls along at the road's pace; the worm moves freely inside the view.
// Two inputs only: the mouse wheel slides the worm up / down the road, Space is the throttle.
// Slower than the road and it drifts left, faster and it drifts right. Leave the screen, leave the trail
// or hit a fence and the run is over. A new course every week.

import {
  engineInit, vec2, rgb, Sound,
  drawRect, drawPoly,
  setCameraPos, setCameraScale, setCanvasClearColor, setCanvasFixedSize, setCanvasPixelated, glSetAntialias, setDebugWatermark,
  keyIsDown, keyWasPressed, mouseIsDown, mouseWasPressed, mousePos, setInputPreventDefault,
  clamp, lerp, rand,
} from 'littlejsengine';
import {
  DT, LANES, METERS, START_REL, BACK_LIMIT, FRONT_LIMIT, STEER_UNITS, MAX_STEER, FIRST_FENCE, STAGES,
  approach, weekNumber, seededRandom, createCourse, createRun, stepRun, trailLane, trailWidth, breakAt,
  createRecorder, record, encodeReplay, decodeReplay,
} from './sim.js';
import { getAccount, cachedAccount, submitRun, getBoards, getRun, shareUrl } from './arcade.js';
import { openAccountPanel } from './account-ui.js';
import { openCredits } from './credits.js';
import { skyAt, sunAt, moonAt, localTimeOfDay, moonPhase } from './sky.js';

const GAME_TITLE = 'SPICE DREAMER';

///////////////////////////////////////////////////////////////////////////////
// screen & projection — everything is drawn in 320x180 pixel space, y down

const W = 320, H = 180;
const HORIZON = 78;           // screen y of the horizon
const NEAR_Y = 170, FAR_Y = 100;
const PPU = 5;                // pixels per world unit at lane 0
const BACK_WARN = -23, FRONT_WARN = 23;  // the worm's screen limits themselves live in sim.js

const groundY = L => NEAR_Y - L*(NEAR_Y - FAR_Y)/LANES;
const depthScale = L => 1 - L*.01;
let camX = 0;
const screenX = (x, L) => W/2 + (x - camX)*PPU*depthScale(L);

///////////////////////////////////////////////////////////////////////////////
// tuning

const MAX_SPEED = 60;          // only used to normalize effects
const WHEEL_STEP = 2;         // lanes per standard wheel notch (100px of deltaY)
const KEY_STEER = 14;         // lanes/sec with arrow keys
const KMH = METERS*3.6;
const SEGMENTS = 24, SEG_SPACING = .95, HEAD_R = 1.7;

///////////////////////////////////////////////////////////////////////////////
// palette — sunset desert

const hex = h => rgb(parseInt(h.slice(1, 3), 16)/255, parseInt(h.slice(3, 5), 16)/255, parseInt(h.slice(5, 7), 16)/255);
const SKY = ['#1e0b3a', '#3a1256', '#651a66', '#9c2462', '#d2434e', '#f27a45', '#ffb45e', '#ffd98a'].map(hex);
const GROUND = ['#f0a35c', '#e48e4c', '#d77a40', '#c66a38', '#b25a31', '#9c4c2b'].map(hex);
const SUN_TOP = hex('#fff2a8'), SUN_BOT = hex('#ff6f6a');
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

const hash = n => { const s = Math.sin(n*127.1 + 311.7)*43758.5453; return s - Math.floor(s); };
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
  try { const v = localStorage.getItem('spicedreamer.' + key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function save(key, value)
{
  try { localStorage.setItem('spicedreamer.' + key, JSON.stringify(value)); } catch {}
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
  ',':'000000000010100', "'":'010010000000000', '+':'000010111010000', '_':'000000000000111',
  '(':'010100100100010', ')':'010001001001010', '&':'010101010101011', '@':'010101111100011', '=':'000111000111000',
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

// the rules, the course and the scoring live in sim.js, which the leaderboard API shares
const WEEK = weekNumber();
// playtesting aid: open with ?start=2500 to begin a run that far in (those runs can't be submitted)
const START_METERS = Math.max(0, +new URLSearchParams(location.search).get('start') || 0);

///////////////////////////////////////////////////////////////////////////////
// state

let state = 'title'; // title | settings | play | pause | over | newhigh | scores | watch | watchover
let stateTime = 0, clock = 0;
let course, run, rec;          // the simulated run and its recorded inputs
let lastRun = null;            // the finished run, ready to submit: { week, replay, score, ranked }
let worm;                      // presentation only: body history and head bob
let scenery, sceneryRand, nextSceneryX, particles, popups, score, shake, deathReason;
let best = load('best', 0);   // lifetime best, only used to retire the beginner hints

// leaderboards and accounts (see arcade.js). Everything here degrades to "offline" if the API is down.
const TABS = ['weekly', 'daily', 'alltime', 'you'];
const TAB_NAMES = { weekly: 'THIS WEEK', daily: 'TODAY', alltime: 'ALL TIME', you: 'YOU' };
let boards = {}, myStats = null, boardTab = 'weekly', boardsError = false;
let trackHi = 0;               // the week's top score, shown on the title and HUD
let post = null;               // posting the last run: { status: posting|posted|signin|error|practice, result, error }
let scoresFrom = 'title';      // whether the boards were opened from the title or after a run
let toast = '', toastTime = 0;
let uiOpen = false;            // the account panel is up; the game ignores input meanwhile
let watching = null;           // a shared run being replayed: { run (from the API), inputs, seg, left }

// screensaver: the worm rides forever under a turning sky. Open with ?kiosk to start (and stay) in it,
// pick it in settings, or leave the title screen alone for a while. Any key, click or scroll wakes it.
const params = new URLSearchParams(location.search);
const POSTER = params.has('poster');   // the screensaver with just the logo, used to render the share image
const KIOSK = params.has('kiosk') || POSTER;
const IDLE_TO_SCREENSAVER = 45;   // seconds on the title screen
const IDLE_TO_TITLE = 90;         // seconds on the score screen before giving up and heading back
let lastInput = performance.now(), kioskTicker = 0, kioskBoardsAt = 0;
for (const type of ['keydown', 'wheel', 'pointerdown'])
  addEventListener(type, () => lastInput = performance.now(), { capture: true, passive: true });
const idleSeconds = () => (performance.now() - lastInput)/1000;
let invert = load('invert', true);
let musicOn = load('music', true);
let sensitivity = load('sensitivity', 1);
let wheelAccum = 0, menuWheel = 0;
let throttle = false, steerCarry = 0;
let rumbleTime = 0, warnTime = 0;
let sfx = {};
let menu = null;

// background music: one looping track under the whole game, loudest while you ride.
// An <audio> element streams it, so the page doesn't wait on decoding a few megabytes up front.
const music = Object.assign(new Audio(import.meta.env.BASE_URL + 'spice-dream.mp3'), { loop: true, preload: 'auto', volume: 0 });
if (import.meta.env.DEV) { window.__music = music; window.__state = () => state; }
// Most browsers block sound until the player clicks or presses something. Try anyway (a kiosk browser
// launched with autoplay allowed will just start), and if it's blocked, try again after the first input.
let musicBlocked = false, musicStarting = false;
for (const type of ['pointerdown', 'keydown'])
  addEventListener(type, () => musicBlocked = false, { capture: true, passive: true });

function updateMusic()
{
  const target = !musicOn ? 0
    : state == 'play' ? .7
    : state == 'pause' || state == 'over' ? .2
    : .4; // title, screensaver, boards, watching a replay
  // fade over a couple of seconds, starting from silence rather than jumping in
  music.volume = music.paused ? 0 : clamp(approach(music.volume, target, DT*.5));
  if (target > 0 && music.paused && !musicBlocked && !musicStarting)
  {
    musicStarting = true;
    music.play().catch(() => musicBlocked = true).finally(() => musicStarting = false);
  }
  else if (target == 0 && music.volume == 0 && !music.paused)
    music.pause();
}

// raw wheel deltas so a trackpad's many small events and a mouse's notches both feel right
addEventListener('wheel', e =>
{
  let d = e.deltaY;
  if (e.deltaMode == 1) d *= 33;
  else if (e.deltaMode == 2) d *= 400;
  wheelAccum += d;
}, { passive: true });

// mode: 'attract' (the title-screen worm rides the trail by itself), 'play', or 'watch' (a shared replay)
function newGame(mode='play')
{
  const attract = mode == 'attract';
  course = createCourse(mode == 'watch' ? watching.run.week : WEEK);
  run = createRun(course, { startMeters: mode == 'play' ? START_METERS : 0, attract });
  rec = createRecorder();
  steerCarry = 0;
  if (mode == 'watch')
  {
    watching.inputs = decodeReplay(watching.run.replay);
    watching.seg = 0;
    watching.left = watching.inputs[0]?.[0] || 0;
  }
  worm = { history: [], headH: 1.9 };
  for (let i = 60; i > 0; i--)
    worm.history.push({ x: run.x - i*.5, L: trailLane(course, run.x - i*.5) });
  sceneryRand = seededRandom(course.week*3 + 3);
  scenery = [];
  nextSceneryX = run.x + 10;
  particles = [];
  popups = [];
  score = 0;
  shake = 0;
  camX = run.camX;
}

function setState(s)
{
  state = s;
  stateTime = 0;
  menuWheel = 0;
  menu = { title: titleMenu, settings: settingsMenu, pause: pauseMenu, scores: scoresMenu, watchover: watchMenu }[s] || null;
  if (s == 'kiosk') { lastInput = 0; kioskTicker = 0; }
  if (menu) menu.sel = 0;
}

function popup(text, color=GOLD, size=2, life=1.4)
{
  popups.push({ text, color, size, life, maxLife: life });
}

function showToast(text)
{
  toast = text;
  toastTime = 2;
}

///////////////////////////////////////////////////////////////////////////////
// menus — navigated with the same two inputs: wheel to move, space to choose

const SENSITIVITIES = [.5, .75, 1, 1.25, 1.5, 2, 2.5, 3];
const invertItem = { label: () => 'INVERT SCROLL: ' + (invert ? 'ON' : 'OFF'), act: () => { invert = !invert; save('invert', invert); } };
const sensItem = {
  cycle: true, // left / right arrows change it too
  label: () => 'SENSITIVITY: < ' + sensitivity.toFixed(2).replace(/0$/, '') + ' >',
  act: (dir=1) =>
  {
    const i = SENSITIVITIES.indexOf(sensitivity);
    sensitivity = SENSITIVITIES[(Math.max(0, i) + dir + SENSITIVITIES.length) % SENSITIVITIES.length];
    save('sensitivity', sensitivity);
  },
};
const titleMenu = { sel: 0, get items() { return [
  { label: () => 'RIDE', act: () => { setState('play'); newGame(); } },
  { label: () => 'LEADERBOARDS', act: () => openBoards('title') },
  { label: () => cachedAccount()?.profile ? 'ACCOUNT: ' + cachedAccount().profile.handle : 'SIGN IN', act: () => openAccount() },
  { label: () => 'SETTINGS', act: () => setState('settings') },
  { label: () => 'CREDITS', act: showCredits },
]; } };
const musicItem = { label: () => 'MUSIC: ' + (musicOn ? 'ON' : 'OFF'), act: () => { musicOn = !musicOn; save('music', musicOn); } };
const settingsMenu = { sel: 0, items: [invertItem, sensItem, musicItem,
  { label: () => 'SCREENSAVER', act: () => setState('kiosk') },
  { label: () => 'BACK', act: () => setState('title') }] };
const pauseMenu = { sel: 0, items: [
  { label: () => 'RESUME', act: () => setState('play') },
  invertItem, sensItem, musicItem,
  { label: () => 'QUIT TO TITLE', act: () => { newGame('attract'); setState('title'); } },
]};
const tabItem = {
  cycle: true,
  label: () => '< ' + TAB_NAMES[boardTab] + ' >',
  act: (dir=1) => { boardTab = TABS[(TABS.indexOf(boardTab) + dir + TABS.length) % TABS.length]; },
};
const scoresMenu = { sel: 0, get items()
{
  const items = [tabItem];
  if (scoresFrom == 'run')
  {
    items.push({ label: () => 'RIDE AGAIN', act: () => { setState('play'); newGame(); } });
    if (post?.status == 'signin') items.push({ label: () => 'SIGN IN TO POST IT', act: () => openAccount('Sign in to post your ' + score.toLocaleString() + '.') });
    if (post?.status == 'error') items.push({ label: () => 'TRY POSTING AGAIN', act: postRun });
    if (post?.status == 'posted') items.push({ label: () => 'SHARE THIS RUN', act: () => shareRun(post.result.run.id) });
  }
  else if (!cachedAccount()?.profile)
    items.push({ label: () => 'SIGN IN', act: () => openAccount() });
  items.push({ label: () => scoresFrom == 'run' ? 'MENU' : 'BACK', act: () => { newGame('attract'); setState('title'); } });
  return items;
} };
const watchMenu = { sel: 0, get items() { return [
  { label: () => 'RIDE THIS COURSE', act: () => { setState('play'); newGame(); } },
  { label: () => 'WATCH AGAIN', act: () => { newGame('watch'); setState('watch'); } },
  { label: () => 'MENU', act: () => { newGame('attract'); setState('title'); } },
]; } };

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
  menu.sel = clamp(menu.sel, 0, menu.items.length - 1); // items can come and go
  const item = menu.items[menu.sel];
  if (item.cycle && (keyWasPressed('ArrowLeft') || keyWasPressed('ArrowRight')))
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

function drawMenu(m, y, spacing=12)
{
  m.items.forEach((item, i) =>
  {
    const s = item.label(), sel = i == m.sel;
    const pulse = sel && clock % .5 < .25;
    drawPixelText(s, W/2, y + i*spacing, 1, sel ? GOLD : WHITE.scale(.8, 1), 'center');
    if (sel && !item.cycle)
    {
      const w = textWidth(s)/2 + 6 + (pulse ? 1 : 0);
      drawPixelText('>', W/2 - w - 3, y + i*spacing, 1, GOLD, 'left');
      drawPixelText('<', W/2 + w, y + i*spacing, 1, GOLD, 'left');
    }
  });
}

///////////////////////////////////////////////////////////////////////////////
// obstacles

// harmless roadside scenery for depth (fences and wrecks are part of the run, in sim.js)
function spawnScenery()
{
  while (nextSceneryX < camX + 75)
  {
    const x = nextSceneryX, c = trailLane(course, x), w = trailWidth(course, x);
    const r = sceneryRand(), kind = r < .5 ? 'boulder' : r < .75 ? 'ribs' : 'spire';
    const L = c + (sceneryRand() < .5 ? -1 : 1)*(w/2 + sceneryRand(2.5, 8));
    scenery.push({ kind, x, L: clamp(L, -2, LANES + 4), r: kind == 'boulder' ? 1.2 : kind == 'ribs' ? .9 : .8, seed: sceneryRand(99) });
    nextSceneryX += sceneryRand(6, 20);
  }
  scenery = scenery.filter(o => o.x > camX - 80);
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

function onDie(reason)
{
  deathReason = reason;
  score = run.score;
  if (state == 'watch')
  {
    shake = 1;
    sandBurst(run.x, run.L, 60, 14);
    sfx.crash.play();
    return setState('watchover');
  }
  // runs started part way in with ?start= can't be verified from the start, so they never count
  lastRun = { week: WEEK, replay: encodeReplay(rec), score, ranked: !START_METERS };
  if (import.meta.env.DEV) window.__lastRun = lastRun;
  shake = 1;
  sandBurst(run.x, run.L, 60, 14);
  sfx.crash.play();
  if (score > best) save('best', best = score);
  setState('over');
}

function updateRun()
{
  // turn this frame's input into the sim's quantized steering, keeping sub-step trackpad motion for later
  let throttleIn = false, steer = 0;
  const recording = state == 'play' && !run.dead && !run.attract;
  if (state == 'watch' && !run.dead)
  {
    while (watching.left <= 0 && watching.seg < watching.inputs.length - 1)
      watching.left = watching.inputs[++watching.seg][0];
    const input = watching.inputs[watching.seg];
    if (input && watching.left > 0) { throttleIn = !!input[1]; steer = input[2]; watching.left--; }
  }
  else if (recording && !uiOpen)
  {
    let lanes = clamp(wheelAccum/100*WHEEL_STEP*sensitivity*(invert ? 1 : -1), -5, 5);
    if (keyIsDown('ArrowUp') || keyIsDown('KeyW')) lanes += KEY_STEER*DT;
    if (keyIsDown('ArrowDown') || keyIsDown('KeyS')) lanes -= KEY_STEER*DT;
    const units = lanes*STEER_UNITS + steerCarry;
    steer = clamp(Math.round(units), -MAX_STEER, MAX_STEER);
    steerCarry = clamp(units - steer, -1, 1);
    throttleIn = keyIsDown('Space') || mouseIsDown(0);
    record(rec, throttleIn, steer);
  }

  const events = stepRun(run, throttleIn, steer);
  throttle = run.throttle;
  camX = run.camX;
  if (state == 'play' || state == 'watch') score = run.score;

  worm.history.push({ x: run.x, L: run.L });
  while (worm.history.length > 2 && worm.history[1].x < run.x - SEGMENTS*SEG_SPACING - 4)
    worm.history.shift();
  // head rises out of the sand while alive, dives when the run ends
  worm.headH = run.dead ? Math.max(-4, worm.headH - 5*DT) : 1.9 + .25*Math.sin(clock*5);

  for (const e of events)
  {
    if (e.type == 'stage')
    {
      popup(STAGES[e.stage].name, GOLD, 2, 2.2);
      popup('SCORE X' + STAGES[e.stage].mult, WHITE, 1, 2.2);
      sfx.milestone.play(undefined, 1, 1.2);
    }
    else if (e.type == 'milestone')
    {
      popup(e.meters + 'M!');
      sfx.milestone.play();
    }
    else if (e.type == 'near')
    {
      popup('CLOSE! +' + e.pts, SAND_SPRAY, 1, .9);
      sfx.near.play();
    }
    else if (e.type == 'die')
      onDie(e.reason);
  }

  if (!(recording || state == 'watch') || run.dead) return;
  if (run.offTrail)
  {
    warnTime -= DT;
    if (warnTime <= 0) { sfx.warn.play(); warnTime = .15; }
  }
  if (run.inBreak && rand() < .8) sandBurst(run.x, run.L, 2, 6);

  // engine-like rumble that speeds up with the worm
  rumbleTime -= DT;
  if (rumbleTime <= 0)
  {
    sfx.rumble.play(undefined, .18 + throttle*.12, .7 + run.speed/60);
    rumbleTime = Math.max(.07, .22 - run.speed*.003);
  }
}

function updateWorld()
{
  spawnScenery();

  // sand spray where the head and body break the surface
  if (!run.dead || worm.headH > -2)
  {
    const s = run.speed/MAX_SPEED;
    for (let i = 0; i < 1 + s*3; i++)
      emit(run.x + rand(-.5, .5), run.L + rand(-.8, .8), 0, rand(-4, 2) - s*6, rand(-1, 1), rand(3, 9)*(.5 + s),
        rand(.3, .7), rand() < .3 ? 2 : 1, SAND_SPRAY);
    for (let i = 3; i < SEGMENTS; i += 2)
    {
      const x = run.x - i*SEG_SPACING, h = bodyHeight(i, x);
      if (Math.abs(h) < .4 && rand() < .5)
        emit(x, laneAt(x), 0, rand(-2, 2), rand(-.5, .5), rand(2, 6), rand(.3, .6), 1, SAND_SPRAY);
    }
  }
  // spice sparkles when surging on the trail
  if (throttle && rand() < .7)
    emit(run.x - rand(2), run.L + rand(-1, 1), rand(.5, 2), -run.speed*.3, 0, rand(1, 3), .5, 1, TRAIL_DASH, 4);

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

// time of day, 0..1 from midnight (see sky.js). Menus follow the real clock; a run races through a day.
const PLAY_DAY = 60;           // seconds of play for a full day and night
const KIOSK_DAY = 180;         // the screensaver takes its time
const MOON_PHASE = moonPhase();
// ?time=<hour> pins the menus' clock, handy for seeing night or noon without waiting for it
const TIME_PARAM = new URLSearchParams(location.search).get('time');
const realTimeOfDay = () => TIME_PARAM != null ? ((+TIME_PARAM % 24) + 24) % 24/24 : localTimeOfDay();
let skyT = realTimeOfDay();
let pal = skyAt(skyT);

function updateSky()
{
  if (state == 'play' || state == 'watch')
    skyT += DT/PLAY_DAY;
  else if (state == 'kiosk')
    skyT += DT/KIOSK_DAY;
  else if (state != 'pause' && state != 'over')
  {
    // ease back to the real time of day, the short way around the clock
    const diff = ((realTimeOfDay() - skyT + 1.5) % 1) - .5;
    skyT += diff*Math.min(1, DT*1.2);
  }
  skyT = ((skyT % 1) + 1) % 1;
  pal = skyAt(skyT);
}

function drawSky()
{
  const sky = pal.sky, bandH = HORIZON/sky.length;
  sky.forEach((c, i) => rect(0, i*bandH, W, bandH + 1, c));
  for (let i = 1; i < sky.length; i++)
  {
    const y = Math.round(i*bandH);
    ditherRow(y - 1, sky[i], 0);
    ditherRow(y, sky[i - 1], 1);
  }

  // stars come out as the light goes
  const starAlpha = clamp((.62 - pal.light)/.3);
  if (starAlpha > 0)
    for (let i = 0; i < 70; i++)
    {
      const twinkle = .5 + .5*Math.sin(clock*(1 + hash(i + 5)*3) + i);
      const x = hash(i*3.7)*W, y = hash(i*9.1)*(HORIZON - 12);
      rect(x, y, 1, 1, WHITE.scale(1, starAlpha*(.35 + .65*twinkle)*(1 - y/HORIZON*.5)));
    }

  // the moon, lit to tonight's real phase
  const moon = moonAt(skyT);
  if (moon)
  {
    const r = 9, cx = moon.x, cy = HORIZON + 6 - moon.height*62;
    blob(cx, cy, r + 2, HORIZON, rgb(1, 1, .9, .12));
    blob(cx, cy, r, HORIZON, rgb(.96, .94, .84));
    // shadow: a dark disc slid across by the phase (full moon slides it all the way off)
    const lit = MOON_PHASE < .5 ? MOON_PHASE*2 : (1 - MOON_PHASE)*2; // 0 new .. 1 full
    const side = MOON_PHASE < .5 ? -1 : 1;
    if (lit < .97) blob(cx + side*lit*r*2.1, cy, r + .5, HORIZON, sky[Math.min(7, Math.max(0, Math.floor(cy/bandH)))]);
    if (lit > .4) { rect(cx - 3, cy - 2, 2, 2, rgb(.82, .8, .72)); rect(cx + 2, cy + 3, 3, 2, rgb(.82, .8, .72)); }
  }

  // the sun: big and striped near the horizon, smaller and white-hot overhead
  const sun = sunAt(skyT);
  if (sun)
  {
    const low = 1 - sun.height;
    const r = 18 + low*14, cx = sun.x, cy = HORIZON + 4 - sun.height*66;
    const top = SUN_TOP.lerp(WHITE, sun.height*.6), bot = SUN_BOT.lerp(rgb(1, .95, .7), sun.height);
    for (let y = Math.floor(cy - r); y < HORIZON; y++)
    {
      const dy = y - cy;
      if (Math.abs(dy) > r) continue;
      if (low > .5 && dy > 2 && dy % 6 < 1 + dy/9) continue; // horizontal gaps when it's low
      const hw = Math.sqrt(r*r - dy*dy);
      rect(cx - hw, y, hw*2, 1, top.lerp(bot, (dy + r)/(2*r)));
    }
  }

  // wispy clouds drifting slowly, catching the light of the hour
  for (let i = 0; i < 6; i++)
  {
    const span = W + 120;
    const x = ((hash(i)*span - parallaxShift(.015) - clock*2) % span + span) % span - 60;
    const y = 10 + hash(i + 7)*40, w = 30 + hash(i + 3)*50;
    rect(x, y, w, 1, sky[5].scale(1.1, 1));
    rect(x + 8, y + 2, w*.6, 1, sky[4].scale(1.2, 1));
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
  const ground = pal.ground, span = H - HORIZON, bandH = span/ground.length;
  ground.forEach((c, i) => rect(0, HORIZON + i*bandH, W, bandH + 1, c));
  for (let i = 1; i < ground.length; i++)
    ditherRow(Math.round(HORIZON + i*bandH) - 1, ground[i], i % 2);
  rect(0, HORIZON, W, 1, pal.sky[7]); // horizon glow

  // ripple marks scrolling with depth-correct parallax
  for (let L = -2; L <= 26; L += 1.5)
  {
    const y = groundY(L), s = depthScale(L);
    if (y < HORIZON + 2) continue;
    const reach = (W/2 + 20)/(PPU*s);
    for (let gx = Math.floor((camX - reach)/4); gx <= (camX + reach)/4; gx++)
    {
      const x = gx*4 + hash(gx + L*13)*3;
      const tc = trailLane(course, x);
      if (Math.abs(L - tc) < trailWidth(course, x)/2 + .5) continue;
      rect(screenX(x, L), y, Math.max(1, 3*s), 1, pal.ripple);
    }
  }
}

// glow > 0 draws just the bright core again on top of the night shade, so the spice glows in the dark
function drawTrail(glow=0)
{
  const step = 1.5;
  const start = Math.floor((camX - 70)/step)*step;
  for (let x = start; x < camX + 70; x += step)
  {
    const quad = (fraction, color, x0=x, x1=x + step) =>
    {
      const c0 = trailLane(course, x0), c1 = trailLane(course, x1);
      const w0 = trailWidth(course, x0)*fraction/2, w1 = trailWidth(course, x1)*fraction/2;
      poly([
        vec2(screenX(x0, c0 + w0), groundY(c0 + w0)),
        vec2(screenX(x1, c1 + w1), groundY(c1 + w1)),
        vec2(screenX(x1, c1 - w1), groundY(c1 - w1)),
        vec2(screenX(x0, c0 - w0), groundY(c0 - w0)),
      ], color);
    };
    const b = course.breaks.find(b => x + step > b.x0 - 3 && x < b.x1 + 3);
    if (b)
    {
      // the trail crumbles into scattered spice where it gives out and picks back up
      if (x + step > b.x0 && x < b.x1) continue;
      if (hash(Math.floor(x/step)*7.3) < .5) quad(.7, TRAIL);
      continue;
    }
    if (glow)
    {
      quad(.7, TRAIL.scale(1, glow*.35));
      quad(.4, TRAIL_CORE.scale(1, glow*.8));
      continue;
    }
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
  drawRidge(.03, u => mesaHeight(u, 70, 30, .6), pal.mesaFar);
  drawRidge(.08, u => mesaHeight(u + 999, 44, 17, .45), pal.mesaMid);
  drawRidge(.18, u => 4 + 2.5*Math.sin(u*.031) + 1.5*Math.sin(u*.083), pal.duneFar, pal.duneTop);
  drawGround();
  drawTrail();

  // painter's order: far lanes first
  const items = [];
  for (const o of [...run.hazards, ...scenery])
  {
    if (o.kind == 'fence') items.push(...fenceItems(o));
    else if (o.kind == 'wreck') items.push({ L: (o.L0 + o.L1)/2, draw: () => drawWreck(o) });
    else items.push({ L: o.L, draw: () => drawObstacle(o) });
  }
  for (let i = SEGMENTS; i >= 0; i--)
  {
    const x = run.x - i*SEG_SPACING, L = laneAt(x);
    const r = i ? lerp(1.5, .5, Math.pow(i/SEGMENTS, 1.2)) : HEAD_R;
    const color = i % 2 ? WORM_A : WORM_B;
    const h = i ? bodyHeight(i, x) : worm.headH;
    items.push({ L: L + i*1e-4, draw: () => drawWormPart(x, L, h, r, color, i) });
  }
  // head shadow
  const hs = depthScale(run.L);
  rect(screenX(run.x, run.L) - HEAD_R*PPU*hs, groundY(run.L) - 1, HEAD_R*PPU*hs*2, 2, BLACK.scale(0, .3));
  items.sort((a, b) => b.L - a.L);
  for (const it of items) it.draw();

  // night shades everything on the ground, then the spice trail glows back through it
  const dark = 1 - pal.light;
  if (dark > .05)
  {
    rect(0, HORIZON + 1, W, H - HORIZON, rgb(.04, .03, .14, dark*.55));
    drawTrail(dark);
  }

  for (const p of particles)
    rect(screenX(p.x, p.L), groundY(p.L) - p.h*PPU*depthScale(p.L), p.size, p.size, p.color);

  // fast foreground dune lip
  const shift = parallaxShift(1.5);
  for (let x = 0; x < W; x += 2)
  {
    const u = Math.floor((x + shift)/2)*2;
    const h = Math.round(4 + 2.5*Math.sin(u*.045) + 1.5*Math.sin(u*.11));
    rect(x, H - h, 2, h, pal.fore);
    rect(x, H - h, 2, 1, pal.foreTop);
  }
}

function drawHud()
{
  // minimal, like the cabinet: track hi score up top, a huge score in the corner
  drawPixelText('TRACK HI SCORE', W/2, 4, 1, SKY[6], 'center');
  drawPixelText(Math.max(trackHi, Math.floor(score)), W/2, 11, 1, GOLD, 'center');
  if (state == 'watch' || state == 'watchover')
  {
    const r = watching.run;
    drawPixelText('WATCHING ' + r.handle + ' ' + r.initials, 6, 5, 1, GOLD, 'left');
    drawPixelText(r.week == WEEK ? "THIS WEEK'S COURSE" : 'AN OLDER COURSE', 6, 13, 1, SKY[6], 'left');
  }
  drawPixelText(Math.floor(score), W - 6, 5, 4, GOLD, 'right', hex('#5a1a2a'));
  drawPixelText(Math.round(run.speed*KMH) + ' KM/H', W - 6, 28, 1, throttle ? GOLD : WHITE.scale(.8, 1), 'right');

  if (!run.dead && state == 'play')
  {
    if (run.offTime > 0 && clock % .2 < .12)
      drawPixelText('STAY ON THE TRAIL!', W/2, 52, 2, WARN, 'center');

    // a break in the trail is coming: get your speed up now
    const nb = course.breaks.find(b => b.x1 > run.x);
    if (nb && nb.x0 - run.x < 45 && clock % .3 < .2)
      drawPixelText(nb.x0 > run.x ? 'TRAIL BREAK - BUILD SPEED!' : 'DEEP SAND!', W/2, 66, 2, GOLD, 'center');

    // edge warnings as the worm drifts toward either side of the screen
    const rel = run.x - camX;
    const back = (BACK_WARN - rel)/(BACK_WARN - BACK_LIMIT), front = (rel - FRONT_WARN)/(FRONT_LIMIT - FRONT_WARN);
    if (back > 0 || front > 0)
    {
      const left = back > 0, a = Math.min(1, left ? back : front)*(clock % .25 < .15 ? 1 : .5);
      for (let y = 40; y < H - 12; y += 12)
        drawPixelText(left ? '<' : '>', left ? 3 : W - 3, y, 2, WARN.scale(1, a), left ? 'left' : 'right');
      if (clock % .3 < .18 && run.offTime <= 0)
        drawPixelText(left ? 'TOO SLOW! HOLD SPACE' : 'TOO FAST! EASE OFF', W/2, 52, 2, WARN, 'center');
    }
  }

  let py = 34;
  for (const p of popups)
  {
    drawPixelText(p.text, W/2, py - (p.maxLife - p.life)*6, p.size, p.color.scale(1, Math.min(1, p.life*2)), 'center');
    py += p.size*6 + 2;
  }

  // first-run coaching, gone once you're past the basics
  const m = run.x*METERS;
  const hint = m < 260 ? 'PULSE SPACE TO MATCH THE ROAD - STAY ON SCREEN'
    : m < 380 ? 'FURTHER RIGHT = LESS TIME TO REACT'
    : m < FIRST_FENCE + 20 ? 'FENCE AHEAD - STEER AROUND THE RED FLAG' : '';
  if (hint && state == 'play' && best < 1500)
  {
    drawPixelText(hint, W/2, H - 26, 1, WHITE, 'center');
    if (m < 260) drawPixelText('SCROLL TO FOLLOW THE GLOWING TRAIL', W/2, H - 18, 1, WHITE, 'center');
  }
}

///////////////////////////////////////////////////////////////////////////////
// end of run, accounts and leaderboards

function updateKiosk()
{
  if (idleSeconds() < .2 && stateTime > .5)
  {
    // woken up: straight to the title, without the wake-up key also picking a menu item
    setState('title');
    stateTime = -.3;
    wheelAccum = 0;
    return;
  }
  kioskTicker += DT;
  if (performance.now() - kioskBoardsAt > 60000) { kioskBoardsAt = performance.now(); refreshBoards(); }
  // the run never ends, so start a fresh stretch of desert every so often to keep things light
  if (run.x*METERS > 60000) { newGame('attract'); popup(GAME_TITLE, GOLD, 3, 3); }
}

function drawKiosk()
{
  if (POSTER)
  {
    drawPixelText(GAME_TITLE, W/2, 28, 4, GOLD, 'center', hex('#5a1a2a'));
    drawPixelText('THE SPICE MUST FLOW.', W/2, 56, 1, WHITE, 'center');
    return;
  }
  // a slow rotation of bragging rights along the top
  const lines = ['THE SPICE MUST FLOW.'];
  for (const [period, label] of [['weekly', 'THIS WEEK'], ['daily', 'TODAY'], ['alltime', 'ALL TIME']])
  {
    const top = boards[period]?.entries?.[0];
    if (top) lines.push(label + ' 1ST  ' + top.initials + ' ' + top.handle + '  ' + fmt(top.score));
  }
  const line = lines[Math.floor(kioskTicker/6) % lines.length];
  const fade = Math.min(1, (kioskTicker % 6)*2, (6 - kioskTicker % 6)*2);
  drawPixelText(line, W/2, 8, 1, GOLD.scale(1, fade), 'center');
  drawPixelText(GAME_TITLE, 6, H - 12, 1, WHITE.scale(1, .55), 'left');
  if (clock % 2 < 1.4) drawPixelText('PRESS SPACE', W - 6, H - 12, 1, WHITE.scale(1, .55), 'right');
}

async function showCredits()
{
  uiOpen = true;
  await openCredits();
  uiOpen = false;
  wheelAccum = 0;
  stateTime = 0; // the key that closed the panel shouldn't also pick a menu item
}

async function openAccount(reason)
{
  uiOpen = true;
  setInputPreventDefault(false); // let the panel's text fields get their keys
  const account = await openAccountPanel({ reason });
  setInputPreventDefault(true);
  uiOpen = false;
  wheelAccum = 0;
  // signing in from the score screen posts the run you just finished
  if (account?.profile && state == 'scores' && scoresFrom == 'run' && post?.status == 'signin')
    postRun();
  refreshBoards();
  return account;
}

async function refreshBoards()
{
  try
  {
    await getAccount();
    boards = await getBoards();
    myStats = boards.me?.profile ? boards.me : null;
    trackHi = boards.weekly.entries[0]?.score || 0;
    boardsError = false;
  }
  catch { boardsError = true; }
}

function openBoards(from)
{
  scoresFrom = from;
  if (from == 'title') { boardTab = 'weekly'; post = null; }
  setState('scores');
  if (from == 'run') scoresMenu.sel = 1; // RIDE AGAIN
  refreshBoards();
}

async function afterRun()
{
  openBoards('run');
  if (!lastRun.ranked) return post = { status: 'practice' };
  const account = await getAccount();
  if (!account?.profile) return post = { status: 'signin' };
  postRun();
}

async function postRun()
{
  post = { status: 'posting' };
  try
  {
    const result = await submitRun(lastRun);
    post = { status: 'posted', result };
    await refreshBoards();
    // a new #1 for the week gets the big yellow card first
    if (result.boards.weekly.rank == 1 && !result.duplicate && state == 'scores')
      setState('newhigh');
  }
  catch (e)
  {
    post = e.status == 401 || e.status == 409 ? { status: 'signin' } : { status: 'error', error: e.message };
  }
}

async function shareRun(id)
{
  const url = shareUrl(id);
  const text = `I scored ${score.toLocaleString()} in ${GAME_TITLE}. Beat it:`;
  if (import.meta.env.DEV) window.__lastShare = url;
  if (navigator.share)
  {
    try { return await navigator.share({ title: GAME_TITLE, text, url }); }
    catch (e) { if (e.name == 'AbortError') return; }
  }
  showToast(await copyText(`${text} ${url}`) ? 'LINK COPIED - GO BRAG' : 'COULD NOT COPY THE LINK');
}

async function copyText(text)
{
  try
  {
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, no) => setTimeout(no, 1500))]);
    return true;
  }
  catch
  {
    // older fallback for browsers that block the clipboard API here
    const area = Object.assign(document.createElement('textarea'), { value: text });
    area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

// opened with ?run=<id>: load that run and replay it, then dare the viewer to beat it
async function watchSharedRun(id)
{
  try
  {
    const { run } = await getRun(id);
    watching = { run };
    newGame('watch');
    setState('watch');
  }
  catch { showToast('THAT RUN COULD NOT BE FOUND'); }
}

const fmt = n => n == null ? '-' : Number(n).toLocaleString();
// 1ST, 2ND, 3RD, 4TH, 11TH, 22ND... (a # sign doesn't read in a 3x5 font)
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH');

function drawBoards(y)
{
  // tab strip
  const tabW = W/TABS.length;
  TABS.forEach((t, i) =>
  {
    const on = t == boardTab;
    if (on) rect(i*tabW + 4, y - 2, tabW - 8, 10, SKY[3]);
    drawPixelText(TAB_NAMES[t], i*tabW + tabW/2, y, 1, on ? GOLD : WHITE.scale(.6, 1), 'center', on ? BLACK : null);
  });
  y += 13;
  const handle = cachedAccount()?.profile?.handle;

  if (boardTab == 'you')
  {
    if (!handle) return drawPixelText('SIGN IN TO TRACK YOUR BESTS', W/2, y + 20, 1, WHITE, 'center');
    if (!myStats) return drawPixelText(boardsError ? 'BOARDS ARE OFFLINE' : 'LOADING...', W/2, y + 20, 1, WHITE, 'center');
    const p = myStats.profile;
    drawPixelText(p.handle + '  ' + p.initials, W/2, y, 2, GOLD, 'center');
    y += 16;
    for (const period of ['weekly', 'daily', 'alltime'])
    {
      const b = myStats.boards[period];
      drawPixelText(TAB_NAMES[period], 60, y, 1, SKY[6], 'left');
      drawPixelText(b.rank ? ordinal(b.rank) + ' OF ' + b.players : '-', 180, y, 1, WHITE, 'right');
      drawPixelText(fmt(b.score), 262, y, 1, GOLD, 'right');
      y += 10;
    }
    drawPixelText(myStats.totals.runs + (myStats.totals.runs == 1 ? ' RUN  ' : ' RUNS  ') + fmt(myStats.totals.meters) + ' M RIDDEN', W/2, y + 4, 1, WHITE.scale(.8, 1), 'center');
    return;
  }

  const board = boards[boardTab];
  if (!board) return drawPixelText(boardsError ? 'BOARDS ARE OFFLINE' : 'LOADING...', W/2, y + 20, 1, WHITE, 'center');
  if (!board.entries.length) return drawPixelText('NO SCORES YET - BE THE FIRST', W/2, y + 20, 1, WHITE, 'center');
  const rows = board.entries.slice(0, 7);
  for (const e of rows)
  {
    const mine = e.handle == handle;
    const color = mine ? (clock % .5 < .3 ? GOLD : TRAIL) : e.rank == 1 ? GOLD : WHITE.scale(.85, 1);
    drawPixelText(e.rank + '.', 58, y, 1, color, 'right');
    drawPixelText(e.initials, 64, y, 1, mine ? color : TRAIL, 'left');
    drawPixelText(e.handle, 84, y, 1, color, 'left');
    drawPixelText(fmt(e.score), 262, y, 1, color, 'right');
    y += 9;
  }
  // you, when you're further down the board
  const me = board.me;
  if (me?.rank && me.rank > rows.length)
  {
    drawPixelText(me.rank + '.', 58, y, 1, GOLD, 'right');
    drawPixelText(handle, 84, y, 1, GOLD, 'left');
    drawPixelText(fmt(me.score), 262, y, 1, GOLD, 'right');
  }
}

function postStatusLine()
{
  if (!post) return '';
  if (post.status == 'posting') return 'POSTING YOUR RUN...';
  if (post.status == 'practice') return 'PRACTICE RUN - NOT POSTED';
  if (post.status == 'signin') return 'SIGN IN TO POST YOUR ' + fmt(score);
  if (post.status == 'error') return 'COULD NOT POST: ' + String(post.error).toUpperCase().slice(0, 40);
  const b = post.result.boards;
  return ordinal(b.weekly.rank) + ' THIS WEEK  ' + ordinal(b.daily.rank) + ' TODAY  ' + ordinal(b.alltime.rank) + ' ALL TIME';
}

function drawTitle()
{
  rect(0, 0, W, H, BLACK.scale(0, .35));
  const bob = Math.round(Math.sin(clock*2)*2);
  drawPixelText(GAME_TITLE, W/2, 30 + bob, 4, GOLD, 'center', hex('#5a1a2a'));
  drawPixelText('THE SPICE MUST FLOW.', W/2, 58, 1, SKY[7], 'center');
  drawPixelText('TRACK HI SCORE ' + fmt(trackHi), W/2, 6, 1, GOLD, 'center');
  const p = cachedAccount()?.profile;
  if (p) drawPixelText('PLAYER ' + p.handle + ' ' + p.initials, 6, H - 12, 1, WHITE.scale(.8, 1), 'left');
}

function drawOverlay()
{
  if (state == 'title')
  {
    drawTitle();
    drawMenu(titleMenu, 76, 11);
    drawPixelText('WHEEL - STEER     SPACE - THROTTLE', W/2, 136, 1, WHITE.scale(.85, 1), 'center');
    drawPixelText('NEW COURSE EVERY SUNDAY', W/2, 146, 1, SKY[6], 'center');
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
  else if (state == 'over' && stateTime > .4)
  {
    rect(0, 0, W, H, BLACK.scale(0, .4*Math.min(1, (stateTime - .4)*3)));
    drawPixelText(deathReason, W/2, 60, 2, WARN, 'center');
    drawPixelText(fmt(score), W/2, 80, 3, WHITE, 'center');
  }
  else if (state == 'newhigh')
  {
    rect(0, 0, W, H, hex('#dcaa1a'));
    drawPixelText('NEW HIGH SCORE', W/2, 64, 3, BLACK, 'center', null);
    drawPixelText(fmt(score), W/2, 90, 2, BLACK, 'center', null);
    drawPixelText("#1 ON THIS WEEK'S COURSE", W/2, 110, 1, BLACK, 'center', null);
  }
  else if (state == 'scores')
  {
    rect(0, 0, W, H, BLACK.scale(0, .85));
    if (scoresFrom == 'run')
    {
      drawPixelText(fmt(score), W/2, 4, 2, WHITE, 'center');
      const line = postStatusLine();
      const pb = post?.status == 'posted' && post.result.personalBest;
      drawPixelText(pb ? 'NEW PERSONAL BEST!  ' + line : line, W/2, 18, 1, pb ? GOLD : SKY[6], 'center');
    }
    else
      drawPixelText('LEADERBOARDS', W/2, 6, 2, hex('#5aff6a'), 'center');
    drawBoards(32);
    drawMenu(scoresMenu, H - 10*scoresMenu.items.length - 2, 10);
  }
  else if (state == 'watchover' && stateTime > .4)
  {
    const r = watching.run;
    rect(0, 0, W, H, BLACK.scale(0, .6));
    drawPixelText(r.handle + ' ' + r.initials, W/2, 34, 2, GOLD, 'center');
    drawPixelText('SCORED ' + fmt(r.score), W/2, 50, 3, WHITE, 'center');
    drawPixelText(r.death, W/2, 74, 1, WARN, 'center');
    drawPixelText(r.week == WEEK ? 'THINK YOU CAN BEAT IT?' : 'THIS WEEK HAS A NEW COURSE - TRY IT', W/2, 90, 1, SKY[7], 'center');
    drawMenu(watchMenu, 110);
  }

  if (state == 'kiosk')
  {
    drawKiosk();
    let py = 70;
    for (const p of popups) { drawPixelText(p.text, W/2, py, p.size, p.color.scale(1, Math.min(1, p.life*2)), 'center'); py += 22; }
  }
  if (toastTime > 0)
    drawPixelText(toast, W/2, H/2 - 4, 2, GOLD, 'center');
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
  newGame('attract');
  setState(KIOSK ? 'kiosk' : 'title');
  getAccount().then(refreshBoards);
  const shared = new URLSearchParams(location.search).get('run');
  if (shared) watchSharedRun(shared);
}

function gameUpdate()
{
  clock += DT;
  stateTime += DT;

  toastTime = Math.max(0, toastTime - DT);

  if (uiOpen)
    ; // the account panel has the keyboard
  else if (state == 'kiosk')
    updateKiosk();
  else if ((state == 'title' && idleSeconds() > IDLE_TO_SCREENSAVER) || (KIOSK && state == 'scores' && idleSeconds() > IDLE_TO_TITLE))
  {
    newGame('attract');
    setState('kiosk');
  }
  else if (menu)
    updateMenu();
  else if (state == 'play' && (keyWasPressed('Escape') || keyWasPressed('KeyP')))
    setState('pause');
  else if (state == 'over' && stateTime > 1.6)
    afterRun();
  else if (state == 'newhigh' && stateTime > 2)
  {
    setState('scores');
    scoresMenu.sel = 1;
  }
  else if (state == 'watch' && (keyWasPressed('Escape') || keyWasPressed('Space') && stateTime > .5))
    setState('watchover'); // skip to the end card

  if (state != 'pause')
  {
    updateRun();
    updateWorld();
  }
  updateSky();
  updateMusic();
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
  if (['play', 'pause', 'over', 'watch', 'watchover'].includes(state))
    drawHud();
  drawOverlay();
}

setCanvasFixedSize(vec2(W, H));
setCanvasPixelated(true);
glSetAntialias(false);
setDebugWatermark(false);
engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender);
