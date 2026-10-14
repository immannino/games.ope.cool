// Rebuilds a playfield image: erases glass art (the instruction card, START
// sign) that hides part of the board, fills the gap with matching background,
// and stamps in the holes and target rings that were underneath.
//
// Background fill is a membrane (Laplace) interpolation solved on an image
// pyramid, plus high-frequency texture (the beer bubbles) borrowed from a clean
// donor strip. Holes are stamped as *ratio* sprites cut from real holes in the
// art (pixel / local background), so their lips and shading carry over onto
// whatever background color they land on.

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Fill unknown pixels (mask=1) of an RGB float image so they blend smoothly
// into the known ones.
function membraneFill(val, known, w, h) {
  if (w * h <= 64) {
    let s = [0, 0, 0], n = 0;
    for (let i = 0; i < w * h; i++) if (known[i]) { s[0] += val[i * 3]; s[1] += val[i * 3 + 1]; s[2] += val[i * 3 + 2]; n++; }
    for (let i = 0; i < w * h; i++) if (!known[i]) for (let c = 0; c < 3; c++) val[i * 3 + c] = n ? s[c] / n : 128;
    return relax(val, known, w, h, 50);
  }
  // coarse level
  const cw = Math.ceil(w / 2), ch = Math.ceil(h / 2);
  const cval = new Float32Array(cw * ch * 3), cknown = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    let s0 = 0, s1 = 0, s2 = 0, n = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const fx = 2 * x + dx, fy = 2 * y + dy;
      if (fx >= w || fy >= h) continue;
      const i = fy * w + fx;
      if (!known[i]) continue;
      s0 += val[i * 3]; s1 += val[i * 3 + 1]; s2 += val[i * 3 + 2]; n++;
    }
    const j = y * cw + x;
    if (n) { cknown[j] = 1; cval[j * 3] = s0 / n; cval[j * 3 + 1] = s1 / n; cval[j * 3 + 2] = s2 / n; }
  }
  membraneFill(cval, cknown, cw, ch);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (known[i]) continue;
    const j = (y >> 1) * cw + (x >> 1);
    val[i * 3] = cval[j * 3]; val[i * 3 + 1] = cval[j * 3 + 1]; val[i * 3 + 2] = cval[j * 3 + 2];
  }
  relax(val, known, w, h, 40);
}

function relax(val, known, w, h, iters) {
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      let s0 = 0, s1 = 0, s2 = 0, n = 0;
      if (x > 0) { const k = (i - 1) * 3; s0 += val[k]; s1 += val[k + 1]; s2 += val[k + 2]; n++; }
      if (x < w - 1) { const k = (i + 1) * 3; s0 += val[k]; s1 += val[k + 1]; s2 += val[k + 2]; n++; }
      if (y > 0) { const k = (i - w) * 3; s0 += val[k]; s1 += val[k + 1]; s2 += val[k + 2]; n++; }
      if (y < h - 1) { const k = (i + w) * 3; s0 += val[k]; s1 += val[k + 1]; s2 += val[k + 2]; n++; }
      val[i * 3] = s0 / n; val[i * 3 + 1] = s1 / n; val[i * 3 + 2] = s2 / n;
    }
  }
}

// RGB float copy of a rectangle of ImageData
function readRect(img, x0, y0, w, h) {
  const out = new Float32Array(w * h * 3), d = img.data, W = img.width;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y0 + y) * W + x0 + x) * 4, o = (y * w + x) * 3;
    out[o] = d[s]; out[o + 1] = d[s + 1]; out[o + 2] = d[s + 2];
  }
  return out;
}

// background of a disk around (cx,cy): the image with that disk membrane-filled
function localBackground(img, cx, cy, rFill, rWin) {
  const x0 = Math.floor(cx - rWin), y0 = Math.floor(cy - rWin), n = Math.ceil(rWin * 2) + 1;
  const val = readRect(img, x0, y0, n, n), known = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    known[y * n + x] = Math.hypot(x0 + x - cx, y0 + y - cy) > rFill ? 1 : 0;
  const orig = val.slice();
  membraneFill(val, known, n, n);
  return { x0, y0, n, orig, bg: val };
}

// Sprite of a feature centered at (cx,cy): the original pixels (used as-is for
// the dark hole core) and their difference from the local background (added to
// the new background for the rim, lip shading and ring).
function cutSprite(img, cx, cy, rFill, rWin, coreR, eraseFn) {
  const { x0, y0, n, orig, bg } = localBackground(img, cx, cy, rFill, rWin);
  const delta = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 3, dx = x0 + x - cx, dy = y0 + y - cy;
    for (let c = 0; c < 3; c++) delta[i + c] = eraseFn?.(dx, dy) ? 0 : orig[i + c] - bg[i + c];
  }
  return { orig, delta, n, ox: cx - x0, oy: cy - y0, rFill, coreR };
}

function sample(arr, n, x, y, out, outside) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  if (x0 < 0 || y0 < 0 || x0 + 1 >= n || y0 + 1 >= n) { out[0] = out[1] = out[2] = outside; return; }
  for (let c = 0; c < 3; c++) {
    const a = arr[(y0 * n + x0) * 3 + c], b = arr[(y0 * n + x0 + 1) * 3 + c];
    const d = arr[((y0 + 1) * n + x0) * 3 + c], e = arr[((y0 + 1) * n + x0 + 1) * 3 + c];
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
}

function stamp(img, sp, cx, cy, scale) {
  const d = img.data, W = img.width, R = (sp.n / 2) * scale, dl = [0, 0, 0], og = [0, 0, 0];
  const feather0 = sp.rFill * scale, feather1 = (sp.n / 2 - 1) * scale, core = sp.coreR * scale;
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
    const dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy);
    if (dist > feather1) continue;
    const sx = dx / scale + sp.ox, sy = dy / scale + sp.oy;
    sample(sp.delta, sp.n, sx, sy, dl, 0);
    sample(sp.orig, sp.n, sx, sy, og, 0);
    const k = 1 - smooth(feather0, feather1, dist);
    const kc = 1 - smooth(core - 0.75, core + 0.75, dist); // weight of the copied core
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const added = d[i + c] + dl[c] * k;
      d[i + c] = Math.max(0, Math.min(255, og[c] * kc + added * (1 - kc)));
    }
  }
}

/**
 * @param ctx 2D context holding the original art (modified in place)
 * @param board board definition with a `rebuild` section
 */
export function rebuildBoard(ctx, board) {
  const rb = board.rebuild, W = ctx.canvas.width, H = ctx.canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const hr = board.holeRadiusPx;

  // sprites come from the untouched art
  const [hx, hy, hR] = rb.holeSprite;
  const holeSp = cutSprite(img, hx, hy, hR + 6, hR + 10, hR - 1);
  const [tx, ty, tR, numberTop, numberHalfW = 13] = rb.ringSprite;
  const ringSp = cutSprite(img, tx, ty, tR, tR + 4, hR - 1,
    (dx, dy) => dy < -numberTop && Math.abs(dx) < numberHalfW); // drop the printed number

  // everything to erase: glass-art rects plus every hole that touches them
  const inRects = (x, y, m) => rb.erase.some(([rx, ry, rw, rh]) => x > rx - m && x < rx + rw + m && y > ry - m && y < ry + rh + m);
  const restamp = board.holes.concat(board.feedHole ? [board.feedHole] : []).filter(([x, y]) => inRects(x, y, hr + 8));
  const targetSet = new Set(board.targets.map(([x, y]) => `${x},${y}`));

  const pad = 30;
  const bx0 = Math.max(0, Math.floor(Math.min(...rb.erase.map((r) => r[0])) - pad - hr));
  const by0 = Math.max(0, Math.floor(Math.min(...rb.erase.map((r) => r[1])) - pad - hr));
  const bx1 = Math.min(W, Math.ceil(Math.max(...rb.erase.map((r) => r[0] + r[2])) + pad + hr));
  const by1 = Math.min(H, Math.ceil(Math.max(...rb.erase.map((r) => r[1] + r[3])) + pad + hr));
  const bw = bx1 - bx0, bh = by1 - by0;
  const val = readRect(img, bx0, by0, bw, bh), known = new Uint8Array(bw * bh).fill(1);
  const write = new Uint8Array(bw * bh); // pixels we replace (the rest only guide the fill)
  const ringR = tR + 2;
  // every hole near the area is excluded from the fill's boundary so its dark doesn't bleed in
  const allHoles = board.holes.concat(board.feedHole ? [board.feedHole] : [])
    .filter(([x, y]) => x > bx0 - 40 && x < bx1 + 40 && y > by0 - 40 && y < by1 + 40);
  const restampSet = new Set(restamp);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const X = bx0 + x, Y = by0 + y, i = y * bw + x;
    if (inRects(X, Y, 0)) { known[i] = 0; write[i] = 1; continue; }
    for (const h of allHoles) {
      const r = targetSet.has(`${h[0]},${h[1]}`) ? ringR : hr + 7;
      if ((X - h[0]) ** 2 + (Y - h[1]) ** 2 < r * r) {
        known[i] = 0;
        if (restampSet.has(h)) write[i] = 1;
        break;
      }
    }
  }
  membraneFill(val, known, bw, bh);

  // bubble texture from the donor strip: detail = image - blurred image
  const [dx0, dy0, dw, dh] = rb.donor;
  const donor = readRect(img, dx0, dy0, dw, dh), blur = new Float32Array(donor.length);
  const BR = 5;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    let s0 = 0, s1 = 0, s2 = 0, n = 0;
    for (let v = -BR; v <= BR; v++) for (let u = -BR; u <= BR; u++) {
      const xx = Math.min(dw - 1, Math.max(0, x + u)), yy = Math.min(dh - 1, Math.max(0, y + v)), k = (yy * dw + xx) * 3;
      s0 += donor[k]; s1 += donor[k + 1]; s2 += donor[k + 2]; n++;
    }
    const o = (y * dw + x) * 3;
    blur[o] = s0 / n; blur[o + 1] = s1 / n; blur[o + 2] = s2 / n;
  }
  const mirror = (v, n) => { const p = v % (2 * n); return p < n ? p : 2 * n - 1 - p; };

  const d = img.data;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x;
    if (!write[i]) continue;
    const sx = mirror(x + 17, dw), sy = mirror(y + 5, dh), k = (sy * dw + sx) * 3;
    const o = ((by0 + y) * W + bx0 + x) * 4;
    for (let c = 0; c < 3; c++) d[o + c] = Math.max(0, Math.min(255, val[i * 3 + c] + (donor[k + c] - blur[k + c])));
  }

  // stamp holes and target rings back in
  for (const [px, py] of restamp) {
    if (targetSet.has(`${px},${py}`)) stamp(img, ringSp, px, py, 1); // rings keep their art size
    else stamp(img, holeSp, px, py, hr / hR);
  }
  ctx.putImageData(img, 0, 0);

  // printed numbers for the targets we created
  ctx.save();
  ctx.font = `${Math.round(hr * 0.62)}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = rb.numberColor || 'rgba(75,60,35,0.85)';
  board.targets.forEach(([x, y], i) => {
    if (restamp.some(([px, py]) => px === x && py === y)) ctx.fillText(String(i + 1), x, y - numberTop - 2);
  });
  ctx.restore();
}
