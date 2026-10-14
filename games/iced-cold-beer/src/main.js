import * as L from 'littlejsengine';
import { BOARDS, metersPerPixel } from './boards.js';
import { Sim, PHYS } from './physics.js';
import { BoardView, loadImage } from './render.js';
import { makeSfx, Loops } from './audio.js';
import './style.css';

const SUBSTEPS = 12; // physics steps per 60 Hz engine update
const BALLS_PER_GAME = 3;
const HUD_WIDTH = 300;

const images = {};
let view, sim, sfx;
const loops = new Loops();
let showHoles = new URLSearchParams(location.search).has('holes');
let muted = false;

const game = {
  boardId: 'icb',
  state: 'attract', // attract | lowering | feeding | play | sinking | tally | over
  stateTime: 0,
  score: 0,
  ballNum: 0,
  level: 1,
  round: 1,
  bonus: 0,
  bonusClock: 0,
  sink: null,
  message: '',
  messageTime: 0,
  high: {},
};

// ---------------------------------------------------------------------------
// setup

function setBoard(id) {
  const board = BOARDS[id];
  const mpp = metersPerPixel(board);
  game.boardId = id;
  view = new BoardView(board, images[id], mpp);
  const toM = ([x, y]) => ({ x: x * mpp, y: -y * mpp });
  const holes = board.holes.map((h) => ({ ...toM(h), r: board.holeRadiusPx * mpp }));
  // tag targets by matching the nearest hole
  const targets = board.targets.map((t, i) => {
    const tm = toM(t);
    let best = holes[0];
    for (const h of holes) if ((h.x - tm.x) ** 2 + (h.y - tm.y) ** 2 < (best.x - tm.x) ** 2 + (best.y - tm.y) ** 2) best = h;
    best.target = i + 1;
    return best;
  });
  sim = new Sim({
    holes,
    holeR: board.holeRadiusPx * mpp,
    poleXL: board.poleX[0] * mpp,
    poleXR: board.poleX[1] * mpp,
    barMinY: -board.barRangeY[0] * mpp,
    barMaxY: -board.barRangeY[1] * mpp,
  });
  sim.targets = targets;
  sim.feedHole = board.feedHole ? { ...toM(board.feedHole), r: board.holeRadiusPx * mpp } : null;
  sim.feedX = sim.feedHole ? sim.feedHole.x : board.feedX * mpp;
  document.querySelectorAll('[data-board]').forEach((b) => b.classList.toggle('active', b.dataset.board === id));
  document.title = `${board.name} — Arcade`;
  setState('attract');
  game.ballNum = 0;
  game.score = 0;
  game.bonus = 0;
}

function loadHigh() {
  try { game.high = JSON.parse(localStorage.getItem('icb-high') || '{}'); } catch { game.high = {}; }
}
function saveHigh() {
  try { localStorage.setItem('icb-high', JSON.stringify(game.high)); } catch { /* storage unavailable */ }
}

function setState(s) {
  game.state = s;
  game.stateTime = 0;
}

function flash(msg, seconds = 1.6) {
  game.message = msg;
  game.messageTime = seconds;
}

function bonusFor(level) { return Math.min(990, level * 100); }

function newGame() {
  game.score = 0;
  game.ballNum = 1;
  game.level = 1;
  game.round = 1;
  sim.speedScale = 1;
  sfx.start.play();
  startBall();
}

function startBall() {
  sim.ball = null;
  game.sink = null;
  game.bonus = bonusFor(game.level);
  setState('lowering');
}

function endBall(won) {
  if (won) {
    sfx.win.play();
    flash(game.level === 10 ? 'ICE COLD!  ROUND CLEARED' : `HOLE ${game.level} — NICE!`, 2);
    setState('tally');
  } else {
    sfx.lose.play();
    game.ballNum++;
    if (game.ballNum > BALLS_PER_GAME) {
      game.ballNum = BALLS_PER_GAME;
      const best = game.high[game.boardId] || 0;
      if (game.score > best) { game.high[game.boardId] = game.score; saveHigh(); flash('NEW HIGH SCORE!', 3); }
      else flash('GAME OVER', 3);
      setState('over');
    } else {
      flash('BALL LOST', 1.8);
      startBall();
    }
  }
}

// ---------------------------------------------------------------------------
// input

const touches = new Map(); // pointerId -> { side, y0, y }
function touchInput(side) {
  let v = 0;
  for (const t of touches.values()) if (t.side === side) v += Math.max(-1, Math.min(1, (t.y0 - t.y) / 40));
  return Math.abs(v) < 0.15 ? 0 : Math.max(-1, Math.min(1, v));
}
function setupTouch() {
  const boardCenterX = () => view.ox + (view.w * view.scale) / 2;
  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target.closest?.('#hud')) return;
    touches.set(e.pointerId, { side: e.clientX < boardCenterX() ? 'L' : 'R', y0: e.clientY, y: e.clientY });
    if (game.state === 'attract' || game.state === 'over') { loops.init(); newGame(); }
  });
  addEventListener('pointermove', (e) => { const t = touches.get(e.pointerId); if (t) t.y = e.clientY; });
  const end = (e) => touches.delete(e.pointerId);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
}

function readInput() {
  const key = (k) => (L.keyIsDown(k) ? 1 : 0);
  let inL = key('KeyW') - key('KeyS');
  let inR = key('ArrowUp') - key('ArrowDown');
  // gamepad: left stick / right stick vertical (browser axes are +down)
  const ls = L.gamepadStick(0), rs = L.gamepadStick(1);
  if (Math.abs(ls.y) > 0.2) inL = -ls.y;
  if (Math.abs(rs.y) > 0.2) inR = -rs.y;
  inL += touchInput('L');
  inR += touchInput('R');
  return [Math.max(-1, Math.min(1, inL)), Math.max(-1, Math.min(1, inR))];
}

// ---------------------------------------------------------------------------
// engine callbacks

function gameInit() {
  sfx = makeSfx();
  loadHigh();
  setBoard(new URLSearchParams(location.search).get('board') === 'zeke' ? 'zeke' : 'icb');
  setupTouch();
  document.querySelectorAll('[data-board]').forEach((b) =>
    b.addEventListener('click', () => { if (b.dataset.board !== game.boardId) setBoard(b.dataset.board); b.blur(); }));
  document.getElementById('startBtn').addEventListener('click', (e) => { loops.init(); newGame(); e.target.blur(); });
}

function gameUpdate() {
  const dt = 1 / 60;
  game.stateTime += dt;
  game.messageTime = Math.max(0, game.messageTime - dt);

  // global keys
  if (L.keyWasPressed('Space') || L.keyWasPressed('Enter') || L.gamepadWasPressed(9)) {
    loops.init();
    if (game.state === 'attract' || game.state === 'over') newGame();
  }
  if (L.keyWasPressed('KeyH')) showHoles = !showHoles;
  if (L.keyWasPressed('KeyM')) { muted = !muted; L.setSoundVolume(muted ? 0 : 0.5); }
  if (game.state === 'attract' || game.state === 'over') {
    if (L.keyWasPressed('Digit1')) setBoard('icb');
    if (L.keyWasPressed('Digit2')) setBoard('zeke');
  }

  let [inL, inR] = readInput();

  switch (game.state) {
    case 'lowering': {
      inL = inR = -1;
      const atBottom = sim.bar.yl <= sim.cfg.barMinY + 1e-4 && sim.bar.yr <= sim.cfg.barMinY + 1e-4;
      if (atBottom) setState('feeding');
      break;
    }
    case 'feeding': {
      inL = inR = 0;
      // the ball pops out of the return hole, then physics drops it onto the bar
      const fh = sim.feedHole, R = PHYS.ballR;
      const rise = fh ? Math.max(0, Math.min(1, (game.stateTime - 0.35) / 0.3)) : 0;
      if (fh && rise > 0) game.feedBall = { p: [fh.x, fh.y, -1.8 * R + 2.8 * R * (1 - (1 - rise) ** 2)], q: [0, 0, 0, 1] };
      if (game.stateTime > (fh ? 0.65 : 0.45)) {
        game.feedBall = null;
        sim.spawnBall(sim.feedX, sim.feedHole?.y);
        sfx.feed.play();
        game.bonusClock = 0;
        flash(`HOLE ${game.level}`, 1.4);
        setState('play');
      }
      break;
    }
    case 'play': {
      const interval = game.round > 1 ? 0.7 : 1.0;
      game.bonusClock += dt;
      if (game.bonusClock >= interval) {
        game.bonusClock -= interval;
        game.bonus = Math.max(0, game.bonus - 10);
      }
      break;
    }
    case 'tally':
      if (game.bonus > 0 && game.stateTime > 0.6) {
        if ((game.stateTime * 60 | 0) % 2 === 0) {
          const step = Math.min(10, game.bonus);
          game.bonus -= step;
          game.score = Math.min(9999, game.score + step);
          sfx.tick.play();
        }
      } else if (game.bonus <= 0 && game.stateTime > 1.2) {
        if (game.level === 10) {
          game.level = 1;
          game.round++;
          sim.speedScale = 1 + 0.25 * (game.round - 1); // "everything speeds the second time through"
        } else game.level++;
        startBall();
      }
      break;
  }

  // physics
  const h = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) sim.step(h, inL, inR);
  game.motor = [sim.bar.vl, sim.bar.vr];

  // physics events
  let impact = 0;
  for (const e of sim.events) {
    if (e.type === 'impact') impact = Math.max(impact, e.strength);
    if (e.type === 'capture' && game.state === 'play') {
      sfx.drop.play();
      const ball = sim.ball;
      game.sink = { hole: e.hole, t: 0, from: ball.p.slice() };
      const won = e.hole && e.hole === sim.targets[game.level - 1];
      game.sinkWon = won;
      setState('sinking');
    }
  }
  sim.events.length = 0;
  if (impact > 0.06) sfx.clack.play(undefined, Math.min(1, impact * 1.6), 0.9 + Math.random() * 0.2);

  // ball disappearing down the hole
  if (game.state === 'sinking' && game.sink) {
    const s = game.sink, ball = sim.ball, R = PHYS.ballR;
    s.t += dt;
    const k = Math.min(1, s.t / 0.35);
    if (s.hole) {
      ball.p[0] = s.from[0] + (s.hole.x - s.from[0]) * k * 0.7;
      ball.p[1] = s.from[1] + (s.hole.y - s.from[1]) * k * 0.7;
    }
    ball.p[2] = s.from[2] + (-2.2 * R - s.from[2]) * k * k;
    if (s.t > 0.5) {
      sim.ball = null;
      endBall(game.sinkWon);
    }
  }

  const ball = sim.ball;
  loops.update(ball?.speed || 0, !!ball && !ball.captured && (ball.onBar || ball.onBoard), game.motor[0] / PHYS.motorSpeed, game.motor[1] / PHYS.motorSpeed);
}

function gameUpdatePost() {}

function gameRender() {
  const ctx = L.mainContext;
  const W = L.mainCanvasSize.x, H = L.mainCanvasSize.y;
  const hudVisible = W - HUD_WIDTH > H * (view.w / view.h) * 0.85;
  document.body.classList.toggle('hud-side', hudVisible);
  view.layout(W, H, hudVisible ? HUD_WIDTH : 0);
  const t = L.time;

  // cabinet surround
  ctx.fillStyle = '#0b0907';
  ctx.fillRect(0, 0, W, H);

  view.drawBackdrop(ctx);

  // lit target lamp
  const target = sim.targets[game.level - 1];
  let lampLevel = 0, lampHole = null;
  if (game.state === 'play' || game.state === 'feeding' || game.state === 'lowering') {
    lampHole = target;
    lampLevel = Math.sin(t * 7) > -0.35 ? 1 : 0.18;
  } else if (game.state === 'sinking' || game.state === 'tally') {
    lampHole = target;
    lampLevel = game.sinkWon ? (Math.sin(t * 30) > 0 ? 1 : 0.1) : 0;
  } else {
    // attract mode: chase the lamps up the board
    lampHole = sim.targets[(t * 2.2 | 0) % 10];
    lampLevel = 0.85;
  }
  view.drawTargetLamp(ctx, lampHole, lampLevel, t);
  if (showHoles) view.drawHoleDebug(ctx, sim.holes, sim.targets);

  view.drawPoles(ctx, sim);
  view.drawBarShadow(ctx, sim);
  const ball = sim.ball;
  const dpr = L.getCanvasPixelRatio();
  const nearHole = ball ? sim.nearestHole(ball.p[0], ball.p[1]) : null;
  const shadowHole = nearHole && nearHole.d < sim.holeR + PHYS.ballR * 1.5 ? nearHole.hole : null;
  if (ball) view.drawBallShadow(ctx, ball, shadowHole);
  if (game.feedBall) view.drawBall(ctx, game.feedBall, sim, dpr, null, 0, sim.feedHole);
  const ballBehindBar = ball && ball.p[2] < PHYS.barZ * 0.75;
  if (ball && ballBehindBar) view.drawBall(ctx, ball, sim, dpr, lampHole, lampLevel);
  view.drawBar(ctx, sim);
  if (ball && !ballBehindBar) view.drawBall(ctx, ball, sim, dpr, lampHole, lampLevel);

  view.drawDisplays(ctx, {
    ballNum: game.ballNum || '',
    bonus: game.bonus,
    score: game.score,
    ballOnBar: game.state === 'play' && ball && ball.onBar,
    gameOver: game.state === 'over' || game.state === 'attract',
    playing: !['attract', 'over'].includes(game.state),
  }, t);

  drawMessages(ctx);
  updateHud();
}

function drawMessages(ctx) {
  let text = '';
  if (game.messageTime > 0) text = game.message;
  else if (game.state === 'attract' || game.state === 'over') text = 'PRESS SPACE TO START';
  if (!text) return;
  const cx = view.sx(view.w / 2), cy = view.sy(view.h * 0.47);
  const size = Math.max(12, Math.min(28, view.w * view.scale * 0.04));
  ctx.save();
  ctx.font = `${size}px "Press Start 2P", "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + size * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(cx - w / 2, cy - size * 1.3, w, size * 2.6);
  const blink = game.messageTime > 0 || Math.sin(L.time * 4) > -0.4;
  if (blink) {
    ctx.fillStyle = '#ffd23a';
    ctx.shadowColor = '#ff7a00';
    ctx.shadowBlur = 12;
    ctx.fillText(text, cx, cy + 1);
  }
  ctx.restore();
}

let hudCache = '';
function updateHud() {
  const board = BOARDS[game.boardId];
  const data = {
    score: game.score,
    high: game.high[game.boardId] || 0,
    ball: game.ballNum ? `${game.ballNum} / ${BALLS_PER_GAME}` : '-',
    hole: `${game.level}${game.round > 1 ? ` (round ${game.round})` : ''}`,
    bonus: game.bonus,
    name: board.name,
  };
  const key = JSON.stringify(data);
  if (key === hudCache) return;
  hudCache = key;
  for (const [k, v] of Object.entries(data)) {
    const el = document.querySelector(`[data-hud="${k}"]`);
    if (el) el.textContent = v;
  }
}

function gameRenderPost() {}

// ---------------------------------------------------------------------------
// boot

L.setShowSplashScreen(false);
L.setGLEnable(false); // everything is drawn on the 2D canvas
L.setInputWASDEmulateDirection(false); // W/S and the arrows are separate joysticks here
L.setTouchGamepadEnable(false);
L.setCanvasClearColor(new L.Color(0.04, 0.035, 0.03));
L.setDebugWatermark?.(false);
L.setDebugKey?.('F9');
L.setSoundVolume(0.5);

Promise.all(Object.values(BOARDS).map(async (b) => { images[b.id] = await loadImage(b.image); }))
  .then(() => L.engineInit(gameInit, gameUpdate, gameUpdatePost, gameRender, gameRenderPost));

// handy for poking at the simulation from the browser console
window.icb = { game, get sim() { return sim; }, get view() { return view; } };
