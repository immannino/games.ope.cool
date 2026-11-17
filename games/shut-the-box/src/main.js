// SHUT THE BOX: the classic dice-and-tiles game, in a walnut box with green felt.
// sim.js decides how a match goes. The dice are real physics (packages/dice-physics, cannon-es) drawn with
// three.js; the table decides what they show and the physics makes it look like chance. The walnut and felt
// are painted once in 2D (scene.js); dice and the hinged tiles are 3D meshes laid over them (stage.js).
// LittleJS provides the frame loop and the 2D canvas.

import { engineInit, setGLEnable, setShowSplashScreen, setDebugWatermark, mainContext, mainCanvasSize, mainCanvas } from 'littlejsengine';
import * as CANNON from 'cannon-es';
import { DiceTable, DiceView, Motion } from '@dice';
import {
  TILES, ROUNDS, createMatch, roll, shut, nextRound, isMove, oneDie, pipsLeft, moves, SUMS,
} from './sim.js';
import { computeLayout, buildMaterials, renderStatic, drawButton, feltText } from './scene.js';
import { Stage, THREE, RoundedBoxGeometry } from './stage.js';
import { TileBoard } from './tiles3d.js';
import { sfx, isMuted, setMuted } from './audio.js';
import { installTheme } from './theme.js';
import { titlePanel, howToPanel, roundPanel, resultsPanel, menuPanel, closePanel, panelOpen } from './panels.js';

setShowSplashScreen(false);
setDebugWatermark(false);
setGLEnable(false); // the painted table is plain 2D; three.js has its own canvas on top

const now = () => performance.now()/1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

///////////////////////////////////////////////////////////////////////////////
// state and settings

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('shut-the-box.' + k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('shut-the-box.' + k, JSON.stringify(v)); } catch {} },
};
const settings = { hints: true, shake: false, ...store.get('settings', {}) };
const saveSettings = () => store.set('settings', settings);

const G = {
  screen: 'title',          // 'title' | 'play'
  match: null,
  sel: 0,                   // tiles picked up but not yet shut (bitmask)
  busy: false,              // something is animating: no input
  hover: -1, hoverBtn: false, pressBtn: false,
  hold: null,               // the dice are in the player's hand
  tileDown: null,           // a finger or mouse is on a tile
  pending: null,            // { check(), then() }: wait for something, then continue
  best: store.get('best', null),
};

///////////////////////////////////////////////////////////////////////////////
// the 3D world, rebuilt when the window changes

let L, staticLayer, mats, stage, table, view, board, dprUsed = 0;
let lastValues = [4, 2];

function relayout()
{
  const W = mainCanvasSize.x, H = mainCanvasSize.y, dpr = devicePixelRatio || 1;
  if (L && L.W === W && L.H === H && dprUsed === dpr) return;
  if (table?.phase === 'cast' || G.hold) return;       // wait for the dice to land
  dprUsed = dpr;
  L = computeLayout(W, H);
  staticLayer = renderStatic(L, dpr);
  placeKnobs();

  const ppu = L.dieSize*.72;                            // one die is one world unit
  stage.resize(W, H, ppu);

  // the tray is the felt inside the gilt rule
  const z = L.zone, inset = Math.min(z.w, z.h)*.045*2 + 6;
  const a = stage.toWorld(z.x + inset, z.y + inset*.7), b = stage.toWorld(z.x + z.w - inset, z.y + z.h - inset*.7);
  if (view) stage.scene.remove(view.group);
  table = new DiceTable(CANNON, { bounds: { x0: a.x, x1: b.x, z0: a.z, z1: b.z }, count: 2, size: 1, gravity: 70 });
  table.setActive(1, !G.match || !oneDie(G.match.open) || !G.match.dice[0]);
  table.on('impact', onImpact).on('rest', onRest);
  table.showValues(lastValues);
  view = new DiceView({ THREE, RoundedBoxGeometry, table, radius: .13 });
  view.meshes[1].visible = table.dice[1].active;
  view.sync();
  stage.scene.add(view.group);

  if (board) stage.scene.remove(board.group);
  board = new TileBoard(stage, L.slots, mats.maple, strength => sfx.clack(strength));
  if (G.match) board.tiles.forEach((t, i) => { if (!tileOpen(i)) { t.mode = 'shut'; t.angle = Math.PI/2*.985; } });
}

const tileOpen = i => !!((G.match.open >> i) & 1);

///////////////////////////////////////////////////////////////////////////////
// round buttons on the table

const ICONS = {
  menu: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  hints: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg>',
  hintsOff: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/><path d="M4 4l16 16"/></svg>',
};
const knobs = {};
function makeKnobs()
{
  const mk = (id, label, fn) =>
  {
    const b = Object.assign(document.createElement('button'), { className: 'stb-knob', title: label });
    b.setAttribute('aria-label', label);
    b.onclick = () => { b.blur(); fn(); };
    document.body.append(b);
    knobs[id] = b;
  };
  mk('menu', 'Menu', () => { if (!panelOpen() && G.screen === 'play') openMenu(); });
  mk('hints', 'Hints', toggleHints);
  mk('sound', 'Sound', () => { setMuted(!isMuted()); drawKnobs(); });
  drawKnobs();
}
function drawKnobs()
{
  knobs.menu.innerHTML = ICONS.menu;
  knobs.sound.innerHTML = isMuted() ? ICONS.mute : ICONS.sound;
  knobs.hints.innerHTML = settings.hints ? ICONS.hints : ICONS.hintsOff;
  knobs.hints.setAttribute('aria-pressed', settings.hints);
}
function placeKnobs()
{
  const top = 6, right = L.box.x + L.box.w;
  Object.assign(knobs.menu.style, { left: Math.max(10, L.box.x) + 'px', top: top + 'px' });
  Object.assign(knobs.sound.style, { left: Math.min(L.W - 52, right - 42) + 'px', top: top + 'px' });
  Object.assign(knobs.hints.style, { left: Math.min(L.W - 100, right - 94) + 'px', top: top + 'px' });
}

function toggleHints() { settings.hints = !settings.hints; saveSettings(); drawKnobs(); return settings.hints; }

///////////////////////////////////////////////////////////////////////////////
// shaking and tilting a phone

const motion = new Motion({
  onShake(strength, dx, dz)
  {
    if (!canRoll() || G.hold) return;
    activateDice();
    table.kick(strength, dx, dz);
    sfx.rattleBurst(strength);
  },
  onShakeEnd() { if (canRoll() && !G.hold) doRoll(0, 0); },
  onTilt(x, z) { if (canRoll() && !G.hold && table) table.setTilt(x, z); },
});
const shakeSupported = () => Motion.supported && matchMedia('(pointer: coarse)').matches;
async function toggleShake()
{
  if (settings.shake) { settings.shake = false; motion.disable(); }
  else settings.shake = await motion.enable();
  saveSettings();
  return settings.shake;
}

///////////////////////////////////////////////////////////////////////////////
// hints: tiles that can still help make the roll

function hintMask()
{
  const m = G.match;
  if (!settings.hints || m.phase !== 'move' || G.busy) return null;
  let mask = 0;
  for (const s of moves(m.open, m.total)) if ((s & G.sel) === G.sel) mask |= s; // plays that still contain what's picked
  return mask;
}

///////////////////////////////////////////////////////////////////////////////
// playing

const canRoll = () => G.screen === 'play' && !G.busy && !panelOpen() && G.match?.phase === 'roll' && table?.phase !== 'cast';

function startMatch()
{
  closePanel();
  G.match = createMatch((Math.random()*2**32) >>> 0);
  G.sel = 0; G.busy = false; G.pending = null; G.screen = 'play';
  resetBoard();
  activateDice();
}

function resetBoard()
{
  board.tiles.forEach((t, i) => { if (t.mode === 'shut' || t.mode === 'shutting') board.setShut(i, false, i*.06); });
  G.sel = 0;
}

// the second die sits out once the 7, 8 and 9 are shut
function activateDice()
{
  const two = !oneDie(G.match.open);
  const was = table.dice[1].active;
  table.setActive(1, two);
  view.meshes[1].visible = two;
  if (two && !was) table.placeAtRest();
}

// throw the dice with a flick (world units/s), or with nothing for a lob across the tray
function doRoll(vx=0, vz=0)
{
  const m = G.match;
  if (!canRoll()) return;
  activateDice();
  roll(m);                                            // the sim decides...
  table.cast(vx, vz, [m.dice[0], m.dice[1] || null]); // ...and the physics acts it out
  lastValues = m.dice[1] ? [m.dice[0], m.dice[1]] : [m.dice[0], lastValues[1]];
  G.busy = true;
  sfx.rattle(.5);
}

function onImpact({ kind, strength })
{
  if (kind === 'dice') sfx.diceClick(strength);
  else if (kind === 'wall') sfx.knock(strength);
  else sfx.thud(strength);
}

function onRest()
{
  const m = G.match;
  G.busy = false;
  if (m.phase === 'roundEnd') { G.busy = true; sfx.bust(); setTimeout(showRoundCard, 900); }
}

function toggleTile(i)
{
  const m = G.match;
  if (G.screen !== 'play' || G.busy || m.phase !== 'move' || !tileOpen(i)) return;
  G.sel ^= 1 << i;
  const sum = SUMS[G.sel];
  if (G.sel >> i & 1) sfx.tick(); else sfx.untick();
  if (sum === m.total) commit(G.sel);
  else if (sum > m.total)
  {
    // too many pips: the picked tiles rattle and drop back
    sfx.nope();
    G.busy = true;
    for (let k = 0; k < TILES; k++) if (G.sel >> k & 1) board.pop(k, 7);
    setTimeout(() => { G.sel = 0; G.busy = false; }, 360);
  }
}

function commit(mask)
{
  const m = G.match;
  if (!isMove(m, mask)) return;
  G.busy = true;
  setTimeout(() =>
  {
    shut(m, mask);
    let k = 0;
    for (let i = 0; i < TILES; i++) if (mask >> i & 1) board.setShut(i, true, k++*.13);
    G.sel = 0;
    G.pending = { check: () => board.allSettled(), then: () =>
    {
      if (m.phase === 'roundEnd') { sfx.fanfare(); setTimeout(showRoundCard, 1000); }
      else G.busy = false;
    } };
  }, 260);
}

function showRoundCard()
{
  const m = G.match, round = m.round, result = m.rounds[round], last = round === ROUNDS - 1;
  roundPanel({ round, result, score: m.score, last, onNext: () =>
  {
    closePanel();
    nextRound(m);
    if (m.phase === 'over') return finishMatch();
    resetBoard();
    G.pending = { check: () => board.allSettled(), then: () => { G.busy = false; } };
  } });
}

function finishMatch()
{
  const m = G.match;
  sfx.done();
  const newBest = G.best == null || m.score > G.best, prev = G.best;
  if (newBest) { G.best = m.score; store.set('best', G.best); }
  resultsPanel({
    rounds: m.rounds, score: m.score, best: newBest ? null : prev, newBest,
    onAgain: startMatch, onMenu: toTitle,
  });
}

///////////////////////////////////////////////////////////////////////////////
// menus

function toTitle()
{
  G.screen = 'title'; G.sel = 0; G.busy = false; G.pending = null;
  G.match = createMatch(1);
  resetBoard();
  activateDice();
  openTitle();
}

function openTitle()
{
  closePanel();
  titlePanel({
    best: G.best, hints: settings.hints, shake: shakeSupported() ? settings.shake : null,
    onPlay: startMatch, onHow: () => howToPanel({ onClose: openTitle, touch: shakeSupported() }),
    onHints: toggleHints, onShake: toggleShake,
  });
}

function openMenu()
{
  menuPanel({
    hints: settings.hints, shake: shakeSupported() ? settings.shake : null,
    onResume: closePanel, onRestart: startMatch, onHints: toggleHints, onShake: toggleShake,
    onHow: () => howToPanel({ onClose: openMenu, touch: shakeSupported() }), onQuit: toTitle,
  });
}

///////////////////////////////////////////////////////////////////////////////
// input

const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const inTray = (x, y) => inRect(x, y, L.zone);
const onTable = e => !e.target.closest?.('.stb-wrap, .arc-wrap, .stb-knob');
function pointer(e)
{
  const r = mainCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

addEventListener('pointerdown', e =>
{
  if (!onTable(e) || panelOpen() || !L) return;
  const { x, y } = pointer(e);
  if (settings.shake && !motion.enabled && motion.isIOS) motion.enable();   // iOS wants the permission asked from a tap
  if (G.screen !== 'play') return;

  const tile = G.match.phase === 'move' && !G.busy ? board.pick(x, y) : -1;
  if (tile >= 0 && tileOpen(tile)) { G.tileDown = { i: tile, y0: y, x0: x, cy: y, flicked: false }; return; }

  // anywhere on the felt below the rail picks up the dice
  if (canRoll() && inTray(x, y))
  {
    activateDice();
    const w = stage.toWorld(x, y, 1.9);
    if (table.grab(w.x, w.z)) G.hold = { x0: x, y0: y, t0: now(), last: now(), moved: 0 };
    G.pressBtn = inRect(x, y, L.button);
  }
});

addEventListener('pointermove', e =>
{
  if (!L) return;
  const { x, y } = pointer(e);
  if (G.tileDown)
  {
    const d = G.tileDown, dy = d.y0 - y;
    d.cy = y;
    if (!d.flicked && dy > 16) { d.flicked = true; board.pop(d.i, -6); toggleTile(d.i); }   // a flick up picks the tile
    return;
  }
  if (G.hold)
  {
    const t = now(), w = stage.toWorld(x, y, 1.9), b = table.bounds, m = .7;
    G.hold.moved = Math.max(G.hold.moved, Math.hypot(x - G.hold.x0, y - G.hold.y0));
    table.move(clamp(w.x, b.x0 + m, b.x1 - m), clamp(w.z, b.z0 + m, b.z1 - m), Math.max(.001, t - G.hold.last));
    if (t - G.hold.last > .06) sfx.rattleBurst(Math.min(1, (table.hand.vx**2 + table.hand.vz**2)/2000));
    G.hold.last = t;
    return;
  }
  if (!onTable(e)) return;
  G.hover = G.screen === 'play' && !panelOpen() && !G.busy && G.match.phase === 'move' ? board.pick(x, y) : -1;
  G.hoverBtn = canRoll() && inRect(x, y, L.button);
  const tileOk = G.hover >= 0 && tileOpen(G.hover);
  mainCanvas.style.cursor = tileOk || G.hoverBtn ? 'pointer' : canRoll() && inTray(x, y) ? 'grab' : '';
});

addEventListener('pointerup', e =>
{
  if (G.tileDown)
  {
    const d = G.tileDown;
    G.tileDown = null;
    if (!d.flicked) { const { x, y } = pointer(e); if (Math.hypot(x - d.x0, y - d.y0) < 14) toggleTile(d.i); }
    return;
  }
  if (!G.hold) return;
  const h = G.hold, tap = h.moved < 10 && now() - h.t0 < .35;
  G.hold = null; G.pressBtn = false;
  if (tap) doRoll(0, 0);
  else doRoll(table.hand.vx*1.25, table.hand.vz*1.25);
});
addEventListener('pointercancel', () =>
{
  G.tileDown = null;
  if (G.hold) { G.hold = null; table.placeAtRest(); }
});

addEventListener('keydown', e =>
{
  if (panelOpen() || e.metaKey || e.ctrlKey || e.altKey || G.screen !== 'play') return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); doRoll(0, 0); }
  else if (e.key >= '1' && e.key <= '9') toggleTile(+e.key - 1);
  else if (e.key === 'Escape') openMenu();
  else if (e.key === 'm' || e.key === 'M') knobs.sound.click();
  else if (e.key === 'h' || e.key === 'H') knobs.hints.click();
});

///////////////////////////////////////////////////////////////////////////////
// drawing

let lastFrame = now();
function gameRender()
{
  relayout();
  const ctx = mainContext, T = now(), dt = Math.min(.1, T - lastFrame), m = G.match;
  lastFrame = T;
  ctx.drawImage(staticLayer, 0, 0, L.W, L.H);
  const lit = G.screen === 'play';

  // wordmark on the table
  const cx = L.W/2, topY = 26;
  feltText(ctx, 'SHUT THE BOX', cx, topY, L.W < 560 ? 13 : 17, { color: '#d9c48a', spacing: L.W < 560 ? 3 : 5, weight: 700 });

  // physics, then the tiles' poses
  table.update(dt);
  view.sync();
  if (G.pending?.check()) { const p = G.pending; G.pending = null; p.then(); }
  const mask = lit ? hintMask() : null;
  board.tiles.forEach((t, i) =>
  {
    if (t.mode !== 'open') return;
    const picked = !!(G.sel >> i & 1), down = G.tileDown?.i === i;
    const drag = down && !G.tileDown.flicked ? clamp((G.tileDown.y0 - G.tileDown.cy)/t.slot.h, 0, .5) : 0;
    board.setPose(i, {
      lifted: picked, pressed: down || (G.hover === i && lit && !G.busy && m.phase === 'move'),
      hint: mask && (mask >> i & 1) && !picked ? 1 : 0,
      dim: mask && !(mask >> i & 1) && !picked ? 1 : 0,
      drag,
    });
  });
  board.update(dt, T);

  // labels printed on the felt
  const z = L.zone, small = Math.max(9.5, Math.min(12, z.h*.05)), num = Math.max(20, Math.min(34, z.h*.12));
  if (lit)
  {
    const pad = Math.min(z.w, z.h)*.1, lx = z.x + pad*1.5, rx = z.x + z.w - pad*1.5, by = z.y + z.h - pad*1.5;
    feltText(ctx, 'ROUND', lx, by - num - small*.8, small, { align: 'left', color: '#c9bb8c', spacing: 2.5, shadow: false });
    feltText(ctx, `${Math.min(m.round + 1, ROUNDS)} / ${ROUNDS}`, lx, by - num*.45, num, { align: 'left', weight: 700 });
    feltText(ctx, 'SCORE', rx, by - num - small*.8, small, { align: 'right', color: '#c9bb8c', spacing: 2.5, shadow: false });
    feltText(ctx, `${m.score}`, rx, by - num*.45, num, { align: 'right', weight: 700 });
    feltText(ctx, `${pipsLeft(m)} pips open`, lx, by + small*.9, small, { align: 'left', color: '#a9c9a0', alpha: .8, shadow: false });

    const midY = L.promptY, big = Math.max(15, Math.min(24, z.h*.085));
    if (m.phase === 'move')
    {
      feltText(ctx, `Shut tiles adding to ${m.total}`, z.x + z.w/2, midY, big, { weight: 700, alpha: G.busy && !G.sel ? .6 : 1 });
      const sum = SUMS[G.sel];
      const line = mask === 0 && G.sel ? 'No play from there: tap a tile to put it back'
        : sum ? `${sum} picked, ${m.total - sum} to go` : settings.hints ? 'Lit tiles can make it' : 'Tap or flick the tiles you want';
      feltText(ctx, line, z.x + z.w/2, midY + big*1.25, small + 1.5, { color: '#cfe0c2', alpha: .85, shadow: false });
    }
    if (m.phase === 'roll' && !G.busy && !G.hold && table.phase !== 'cast')
    {
      if (oneDie(m.open)) feltText(ctx, '7, 8 and 9 are shut: one die', z.x + z.w/2, midY - big*1.9, small + 1.5, { color: '#cfe0c2', alpha: .9, shadow: false });
      drawButton(ctx, L.button, 'ROLL', { hover: G.hoverBtn, press: G.pressBtn });
    }
    else if (G.hold) feltText(ctx, 'Flick to throw', z.x + z.w/2, midY, big*.85, { alpha: .8 });
  }
  stage.render();
}

///////////////////////////////////////////////////////////////////////////////

async function gameInit()
{
  installTheme();
  mats = buildMaterials();
  stage = new Stage();
  makeKnobs();
  G.match = createMatch(1);
  relayout();
  if (settings.shake && shakeSupported()) motion.enable().then(ok => { if (!ok) { settings.shake = false; saveSettings(); } });
  openTitle();
}

if (import.meta.env.DEV)
  window.__stb = { G, settings, startMatch, doRoll, toggleTile, commit, openTitle, motion, get table() { return table; }, get board() { return board; }, get stage() { return stage; } };
engineInit(gameInit, () => {}, () => {}, gameRender, () => {});
