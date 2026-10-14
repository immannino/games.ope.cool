// Rendering: backdrop art, lamps, LED displays and the 3D chrome hardware.
// Everything is drawn with the 2D canvas the LittleJS engine hands us
// (mainContext, already scaled to CSS pixels). The ball is ray traced per pixel:
// each pixel gets a sphere normal, the view ray is reflected, and the reflection
// is looked up in the real backdrop (where it hits the board plane), the bar, or
// a dim arcade-room environment with the cabinet's fluorescent tube.

import { PHYS, toLocal } from './physics.js';
import { rebuildBoard } from './cleanboard.js';

const LIGHT = norm3([-0.25, 0.75, 0.6]); // cabinet light: above, slightly left, in front

function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export class BoardView {
  constructor(board, image, mpp) {
    this.board = board;
    this.mpp = mpp;
    this.w = image.width;
    this.h = image.height;
    this.art = this.buildArt(image);
    this.buildEnvironment();
    this.ballCanvas = document.createElement('canvas');
    this.ballCtx = this.ballCanvas.getContext('2d');
    this.makeSmudges();
  }

  // copy of the backdrop with the printed bar painted out
  buildArt(image) {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const b = this.board;
    const img = ctx.getImageData(0, 0, this.w, this.h), d = img.data, W = this.w;
    const lerpColumn = (x, ya, yb) => {
      ya = Math.round(ya); yb = Math.round(yb);
      const ia = ((ya - 1) * W + x) * 4, ib = ((yb + 1) * W + x) * 4;
      for (let y = ya; y <= yb; y++) {
        const t = (y - ya + 1) / (yb - ya + 2), i = (y * W + x) * 4;
        for (let k = 0; k < 3; k++) d[i + k] = d[ia + k] * (1 - t) + d[ib + k] * t;
      }
    };
    const rects = [];
    for (const p of b.patches || []) {
      for (let x = p.x0; x <= p.x1; x++) lerpColumn(x, p.y0, p.y1);
      rects.push([p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0]);
    }
    for (const p of b.linePatches || []) {
      for (let x = p.x0; x <= p.x1; x++) {
        const yc = p.y0 + (p.y1 - p.y0) * (x - p.x0) / (p.x1 - p.x0);
        lerpColumn(x, yc - p.half, yc + p.half);
      }
      rects.push([p.x0, Math.min(p.y0, p.y1) - p.half, p.x1 - p.x0, Math.abs(p.y1 - p.y0) + 2 * p.half]);
    }
    ctx.putImageData(img, 0, 0);
    // repaint any hole the patch smeared over
    ctx.fillStyle = b.holeColor;
    for (const [x, y, w, h] of rects) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      for (const [hx, hy] of b.holes) {
        ctx.beginPath(); ctx.arc(hx, hy, b.holeRadiusPx * 0.94, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (b.rebuild) rebuildBoard(ctx, b);
    return c;
  }

  // blurred half-res copy used for the reflections in the ball
  buildEnvironment() {
    const s = 0.5, w = Math.ceil(this.w * s), h = Math.ceil(this.h * s);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.filter = 'blur(1.5px)';
    ctx.drawImage(this.art, 0, 0, w, h);
    this.env = { data: ctx.getImageData(0, 0, w, h).data, w, h, s };
    // average board tint (used for glass reflection and the bar's lower edge)
    let r = 0, g = 0, bl = 0, n = 0;
    const d = this.env.data;
    for (const [hx, hy] of this.board.holes) {
      const x = Math.round((hx + this.board.holeRadiusPx * 1.6) * s), y = Math.round(hy * s);
      const i = (y * w + clamp(x, 0, w - 1)) * 4;
      r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++;
    }
    this.tint = [r / n, g / n, bl / n];
  }

  makeSmudges() {
    // a few faint marks on the ball surface so rolling is visible
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.smudges = [];
    for (let i = 0; i < 16; i++) {
      const v = norm3([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
      this.smudges.push({ v, c: Math.cos(0.12 + rnd() * 0.3), k: 0.05 + rnd() * 0.09 });
    }
  }

  // ---- layout ----
  layout(canvasW, canvasH, leftReserve) {
    const availW = canvasW - leftReserve;
    const scale = Math.min(availW / this.w, canvasH / this.h);
    this.scale = scale;
    this.ox = leftReserve + (availW - this.w * scale) / 2;
    this.oy = (canvasH - this.h * scale) / 2;
  }
  // image px -> css px
  sx(px) { return this.ox + px * this.scale; }
  sy(py) { return this.oy + py * this.scale; }
  // meters -> css px
  mx(x) { return this.ox + (x / this.mpp) * this.scale; }
  my(y) { return this.oy + (-y / this.mpp) * this.scale; }
  m2s(len) { return (len / this.mpp) * this.scale; }

  // board color seen at physics point (x,y) on the board plane
  sampleBoard(x, y, out) {
    const e = this.env;
    const px = clamp(((x / this.mpp) * e.s) | 0, 0, e.w - 1);
    const py = clamp(((-y / this.mpp) * e.s) | 0, 0, e.h - 1);
    const i = (py * e.w + px) * 4;
    out[0] = e.data[i]; out[1] = e.data[i + 1]; out[2] = e.data[i + 2];
  }

  // ---- drawing ----
  drawBackdrop(ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.art, this.ox, this.oy, this.w * this.scale, this.h * this.scale);
  }

  drawTargetLamp(ctx, hole, intensity, t) {
    if (!hole || intensity <= 0) return;
    const x = this.mx(hole.x), y = this.my(hole.y), r = this.m2s(hole.r);
    ctx.save();
    // lamp behind the hole
    ctx.beginPath(); ctx.arc(x, y, r * 0.98, 0, Math.PI * 2); ctx.clip();
    const g = ctx.createRadialGradient(x - r * 0.15, y - r * 0.2, r * 0.05, x, y, r);
    g.addColorStop(0, `rgba(255,${200 + 40 * intensity | 0},170,${intensity})`);
    g.addColorStop(0.35, `rgba(255,40,20,${intensity})`);
    g.addColorStop(1, `rgba(110,0,0,${intensity})`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
    // halo spilling onto the art
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const h = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2.6);
    h.addColorStop(0, `rgba(255,60,30,${0.45 * intensity})`);
    h.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = h;
    ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawHoleDebug(ctx, holes, targets) {
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const h of holes) {
      ctx.strokeStyle = h.target ? '#0f0' : 'rgba(0,255,255,.8)';
      ctx.beginPath(); ctx.arc(this.mx(h.x), this.my(h.y), this.m2s(h.r), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#0f0';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    targets.forEach((h, i) => ctx.fillText(i + 1, this.mx(h.x), this.my(h.y) + 4));
    ctx.restore();
  }

  // vertical chrome guide rods
  drawPoles(ctx, sim) {
    const r = Math.max(2, this.m2s(PHYS.poleR));
    const top = this.sy(this.board.playfieldTop) - r * 2;
    const bottom = this.board.poleBottomY ? this.sy(this.board.poleBottomY) : this.my(sim.cfg.barMinY) + r * 4;
    for (const xm of [sim.cfg.poleXL, sim.cfg.poleXR]) {
      const x = this.mx(xm);
      // soft shadow on the board
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.filter = `blur(${Math.max(1, r * 0.8)}px)`;
      ctx.fillRect(x + r * 0.6, top + r * 2, r * 1.8, bottom - top);
      ctx.restore();
      ctx.fillStyle = chromeGradient(ctx, x - r, 0, x + r, 0, this.tint, 'pole');
      ctx.fillRect(x - r, top, 2 * r, bottom - top);
      // end caps
      ctx.fillStyle = '#2a2c30';
      ctx.fillRect(x - r * 1.4, top - r * 0.6, r * 2.8, r * 1.2);
      ctx.fillRect(x - r * 1.4, bottom - r * 0.6, r * 2.8, r * 1.2);
    }
  }

  drawBarShadow(ctx, sim) {
    const b = sim.bar, r = Math.max(1.5, this.m2s(PHYS.barR));
    const off = shadowOffset(PHYS.barZ);
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.33)';
    ctx.lineWidth = r * 2.4;
    ctx.lineCap = 'round';
    ctx.filter = `blur(${Math.max(1, r * 0.9)}px)`;
    ctx.beginPath();
    ctx.moveTo(this.mx(sim.cfg.poleXL + off[0]), this.my(b.yl + off[1]));
    ctx.lineTo(this.mx(sim.cfg.poleXR + off[0]), this.my(b.yr + off[1]));
    ctx.stroke();
    ctx.restore();
  }

  drawBar(ctx, sim) {
    const b = sim.bar, r = Math.max(1.5, this.m2s(PHYS.barR));
    const x1 = this.mx(sim.cfg.poleXL), y1 = this.my(b.yl), x2 = this.mx(sim.cfg.poleXR), y2 = this.my(b.yr);
    const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(ang);
    ctx.fillStyle = chromeGradient(ctx, 0, -r, 0, r, this.tint, 'bar');
    ctx.fillRect(-r, -r, len + 2 * r, 2 * r);
    ctx.restore();
    // carriages riding on the poles
    const cw = Math.max(4, this.m2s(PHYS.poleR * 2.8)), ch = Math.max(6, this.m2s(0.026));
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      const g = ctx.createLinearGradient(x - cw / 2, 0, x + cw / 2, 0);
      g.addColorStop(0, '#1b1c1f'); g.addColorStop(0.3, '#6c7077'); g.addColorStop(0.45, '#b9bdc4');
      g.addColorStop(0.6, '#55595f'); g.addColorStop(1, '#141517');
      ctx.fillStyle = g;
      roundRect(ctx, x - cw / 2, y - ch / 2, cw, ch, cw * 0.18);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, cw * 0.12), 0, Math.PI * 2); ctx.fill();
    }
  }

  drawBallShadow(ctx, ball, nearHole) {
    const R = PHYS.ballR, p = ball.p;
    if (p[2] < R * 0.5) return; // sinking into a hole: shadow falls inside it
    const off = shadowOffset(p[2]);
    const x = this.mx(p[0] + off[0]), y = this.my(p[1] + off[1]), r = this.m2s(R);
    ctx.save();
    if (nearHole) { // no shadow drawn across the open hole
      ctx.beginPath();
      ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.arc(this.mx(nearHole.x), this.my(nearHole.y), this.m2s(nearHole.r), 0, Math.PI * 2, true);
      ctx.clip();
    }
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.25);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 1.25, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // per-pixel ray traced chrome ball
  drawBall(ctx, ball, sim, dpr, litTarget, lampLevel, holeOverride) {
    const R = PHYS.ballR, p = ball.p;
    const Rpx = this.m2s(R) * dpr; // device pixels
    const size = Math.ceil(Rpx * 2 + 4);
    const cxs = this.mx(p[0]) * dpr, cys = this.my(p[1]) * dpr;
    const left = Math.floor(cxs - size / 2), top = Math.floor(cys - size / 2);
    const lcx = cxs - left, lcy = cys - top;
    const bc = this.ballCanvas;
    if (bc.width !== size) { bc.width = bc.height = size; this.ballImg = this.ballCtx.createImageData(size, size); }
    const img = this.ballImg, d = img.data;

    const nh = sim.nearestHole(p[0], p[1]);
    const hole = holeOverride || (nh.d < sim.holeR + R ? nh.hole : null);
    const holeR = sim.holeR;
    const barY = (x) => sim.barYAt(x);
    const tint = this.tint;
    const col = [0, 0, 0];
    const q = ball.q;
    const smudges = this.smudges;
    const lit = litTarget && lampLevel > 0 ? litTarget : null;
    const shadeHole = p[2] < R * 0.98 && hole;

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const o = (j * size + i) * 4;
        const dx = (i + 0.5 - lcx) / Rpx, dy = (j + 0.5 - lcy) / Rpx;
        const rr = dx * dx + dy * dy;
        if (rr >= 1 + 2 / Rpx) { d[o + 3] = 0; continue; }
        const rl = Math.sqrt(rr);
        let alpha = clamp((1 - rl) * Rpx + 0.5, 0, 1);
        const nx = rl > 1 ? dx / rl : dx, ny = rl > 1 ? -dy / rl : -dy;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        // surface point in world space
        const Px = p[0] + nx * R, Py = p[1] + ny * R, Pz = p[2] + nz * R;
        // the part of the ball behind the board is only visible through the hole
        if (Pz < 0) {
          if (!hole || (Px - hole.x) ** 2 + (Py - hole.y) ** 2 > holeR * holeR) { d[o + 3] = 0; continue; }
        }
        // reflected view ray (view dir = +z)
        const rx = 2 * nz * nx, ry = 2 * nz * ny, rz = 2 * nz * nz - 1;

        // --- environment lookup ---
        // room / cabinet (ray heading back toward the player)
        let er = 38 + 70 * (ry * 0.5 + 0.5), eg = er, eb = er + 8;
        // fluorescent tube above the glass
        const tube = smooth(0.25, 0.45, ry) * (1 - smooth(0.85, 0.98, ry)) * (1 - smooth(0.55, 0.85, Math.abs(rx)));
        er += 255 * tube; eg += 252 * tube; eb += 240 * tube;
        // glass glare carrying the board color
        const glare = 0.3 + 0.25 * (1 - Math.abs(ry)); er += tint[0] * glare; eg += tint[1] * glare; eb += tint[2] * glare;
        let wRoom = smooth(-0.12, 0.12, rz);
        let br = er, bg = eg, bb = eb;
        if (wRoom < 1) {
          // ray hits the board plane (or the bar in front of it)
          const rzc = Math.min(rz, -0.12);
          let hitBar = false;
          if (Pz > PHYS.barZ) {
            const tb = (Pz - PHYS.barZ) / -rzc;
            const qx = Px + rx * tb, qy = Py + ry * tb;
            if (Math.abs(qy - barY(qx)) < PHYS.barR) {
              hitBar = true;
              const k = 0.6 + 0.4 * Math.abs((qy - barY(qx)) / PHYS.barR);
              br = 200 * k; bg = 203 * k; bb = 210 * k;
            }
          }
          if (!hitBar) {
            if (Pz <= 0) { br = 8; bg = 7; bb = 5; }
            else {
              const t = Pz / -rzc;
              const hx = Px + rx * t, hy = Py + ry * t;
              this.sampleBoard(hx, hy, col);
              br = col[0]; bg = col[1]; bb = col[2];
              if (lit) {
                const dd = (hx - lit.x) ** 2 + (hy - lit.y) ** 2;
                if (dd < holeR * holeR * 2.2) { const k = lampLevel * (1 - dd / (holeR * holeR * 2.2)); br += 255 * k; bg += 40 * k; bb += 20 * k; }
              }
            }
          }
        }
        er = br + (er - br) * wRoom; eg = bg + (eg - bg) * wRoom; eb = bb + (eb - bb) * wRoom;

        // steel: high reflectance, slightly cool, Fresnel brightening at the rim
        const fres = 0.78 + 0.22 * (1 - nz) ** 3;
        // grazing rim loses light (micro roughness), giving the crisp dark silhouette real steel balls have
        const edge = 0.35 + 0.65 * smooth(0.0, 0.4, nz);
        let cr = er * fres * 0.94 * edge, cg = eg * fres * 0.96 * edge, cb = eb * fres * edge;
        // direct specular from the cabinet light
        const sp = Math.max(0, rx * LIGHT[0] + ry * LIGHT[1] + rz * LIGHT[2]);
        const spec = sp ** 180 * 330 + sp ** 18 * 25;
        cr += spec; cg += spec; cb += spec;

        // surface marks that roll with the ball
        const nl = toLocal(q, [nx, ny, nz]);
        let mark = 1;
        for (let s = 0; s < smudges.length; s++) {
          const sm = smudges[s];
          const c = nl[0] * sm.v[0] + nl[1] * sm.v[1] + nl[2] * sm.v[2];
          if (c > sm.c) mark -= sm.k * smooth(sm.c, sm.c + (1 - sm.c) * 0.5, c);
        }
        cr *= mark; cg *= mark; cb *= mark;

        // light falls off inside the hole
        if (shadeHole) {
          const k = clamp((Pz / R + 0.55) / 1.25, 0.06, 1);
          cr *= k; cg *= k; cb *= k;
        }

        d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = alpha * 255;
      }
    }
    this.ballCtx.putImageData(img, 0, 0);
    ctx.drawImage(bc, left / dpr, top / dpr, size / dpr, size / dpr);
  }

  // ---- cabinet displays ----
  drawDisplays(ctx, state, t) {
    const D = this.board.display, s = this.scale;
    // dark plates behind the digits so printed placeholder digits don't show through
    for (const key of ['bonus', 'score']) {
      const [x, y, w, h] = D[key].plate;
      ctx.fillStyle = 'rgba(18,6,6,0.93)';
      roundRect(ctx, this.sx(x), this.sy(y), w * s, h * s, 3 * s);
      ctx.fill();
    }
    {
      const b = D.ball;
      ctx.fillStyle = 'rgba(18,6,6,0.93)';
      roundRect(ctx, this.sx(b.x - b.w * 0.3), this.sy(b.y - b.h * 0.12), b.w * 1.6 * s, b.h * 1.24 * s, 3 * s);
      ctx.fill();
      drawDigits(ctx, this, String(state.ballNum ?? ' '), b.x, b.y, b.w, b.h, 0, 1);
    }
    drawDigits(ctx, this, state.bonus, D.bonus.x, D.bonus.y, D.bonus.w, D.bonus.h, D.bonus.pitch, D.bonus.digits);
    drawDigits(ctx, this, state.score, D.score.x, D.score.y, D.score.w, D.score.h, D.score.pitch, D.score.digits);

    // BALL ON BAR lamp
    const bob = D.ballOnBar;
    lamp(ctx, this.sx(bob.x), this.sy(bob.y), bob.r * s, state.ballOnBar ? 1 : 0, [255, 245, 200]);

    // GAME OVER lamp: art shows it lit, cover it when it should be off
    const go = D.gameOver;
    if (!state.gameOver) {
      ctx.fillStyle = D.panelColor;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(this.sx(go.x), this.sy(go.y), go.w * s, go.h * s);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(170,60,110,0.35)';
      ctx.font = `bold ${go.h * 0.36 * s}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GAME', this.sx(go.x + go.w / 2), this.sy(go.y + go.h * 0.28));
      ctx.fillText('OVER', this.sx(go.x + go.w / 2), this.sy(go.y + go.h * 0.74));
    } else {
      const pulse = 0.55 + 0.45 * Math.sin(t * 3);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const cx = this.sx(go.x + go.w / 2), cy = this.sy(go.y + go.h / 2), rr = go.w * s * 0.75;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, `rgba(255,200,240,${0.35 * pulse})`);
      g.addColorStop(1, 'rgba(255,120,200,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
      ctx.restore();
    }

    // TILT lamp
    if (state.tilt) {
      const tl = D.tilt;
      lamp(ctx, this.sx(tl.x + tl.w / 2), this.sy(tl.y + tl.h / 2), tl.w * s * 0.6, 1, [255, 90, 60]);
    }
    // player-up lamps (green)
    D.lamps.forEach(([x, y, r], i) => {
      if (i === 0 && state.playing) lamp(ctx, this.sx(x), this.sy(y), r * s * 1.8, 0.7 + 0.3 * Math.sin(t * 6), [80, 255, 90]);
    });
  }
}

function shadowOffset(z) {
  return [-LIGHT[0] / LIGHT[2] * z, -LIGHT[1] / LIGHT[2] * z];
}

function chromeGradient(ctx, x0, y0, x1, y1, tint, kind) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const tr = tint[0] * 0.45 | 0, tg = tint[1] * 0.45 | 0, tb = tint[2] * 0.45 | 0;
  if (kind === 'bar') {
    // lit from above: hot highlight near the top, board reflected along the bottom
    g.addColorStop(0, '#4a4d53');
    g.addColorStop(0.12, '#c4c8ce');
    g.addColorStop(0.26, '#ffffff');
    g.addColorStop(0.38, '#d9dce1');
    g.addColorStop(0.58, '#7c8189');
    g.addColorStop(0.76, '#34373c');
    g.addColorStop(0.9, `rgb(${tr},${tg},${tb})`);
    g.addColorStop(1, '#1e1f22');
  } else {
    // vertical rod lit from the upper left
    g.addColorStop(0, '#2c2e33');
    g.addColorStop(0.18, '#9da2a9');
    g.addColorStop(0.32, '#ffffff');
    g.addColorStop(0.44, '#cfd3d8');
    g.addColorStop(0.66, '#6a6f77');
    g.addColorStop(0.86, `rgb(${tr},${tg},${tb})`);
    g.addColorStop(1, '#1a1b1e');
  }
  return g;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lamp(ctx, x, y, r, level, [cr, cg, cb]) {
  if (level <= 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6);
  g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.75 * level})`);
  g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${0.35 * level})`);
  g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// 7-segment LEDs, digits right aligned, in image pixel coordinates
const SEGS = { // a b c d e f g
  0: 0b1111110, 1: 0b0110000, 2: 0b1101101, 3: 0b1111001, 4: 0b0110011,
  5: 0b1011011, 6: 0b1011111, 7: 0b1110000, 8: 0b1111111, 9: 0b1111011,
};
function drawDigits(ctx, view, value, x, y, w, h, pitch, count) {
  const str = String(value ?? '').padStart(count, ' ').slice(-count);
  const s = view.scale;
  for (let k = 0; k < count; k++) {
    const ch = str[k];
    const bits = ch in SEGS ? SEGS[ch] : 0;
    seg7(ctx, view.sx(x + k * pitch), view.sy(y), w * s, h * s, bits);
  }
}
function seg7(ctx, x, y, w, h, bits) {
  const t = Math.max(1, w * 0.2), sk = w * 0.12; // thickness, italic skew
  const hh = h / 2;
  // segment rectangles: [x0,y0,x1,y1] in a unit digit box before skew
  const segs = [
    [t * 0.5, 0, w - t * 0.5, t], // a
    [w - t, t * 0.5, w, hh - t * 0.2], // b
    [w - t, hh + t * 0.2, w, h - t * 0.5], // c
    [t * 0.5, h - t, w - t * 0.5, h], // d
    [0, hh + t * 0.2, t, h - t * 0.5], // e
    [0, t * 0.5, t, hh - t * 0.2], // f
    [t * 0.5, hh - t / 2, w - t * 0.5, hh + t / 2], // g
  ];
  const skew = (px, py) => [x + px + sk * (1 - py / h), y + py];
  const draw = (on) => {
    for (let i = 0; i < 7; i++) {
      const lit = (bits >> (6 - i)) & 1;
      if (!!lit !== on) continue;
      const [x0, y0, x1, y1] = segs[i];
      ctx.beginPath();
      const p = [skew(x0, y0), skew(x1, y0), skew(x1, y1), skew(x0, y1)];
      ctx.moveTo(...p[0]); ctx.lineTo(...p[1]); ctx.lineTo(...p[2]); ctx.lineTo(...p[3]);
      ctx.closePath();
      ctx.fill();
    }
  };
  ctx.fillStyle = 'rgba(120,20,20,0.35)';
  draw(false);
  ctx.save();
  ctx.fillStyle = '#ff3b2a';
  ctx.shadowColor = 'rgba(255,40,20,0.9)';
  ctx.shadowBlur = Math.max(2, w * 0.5);
  draw(true);
  ctx.restore();
}
