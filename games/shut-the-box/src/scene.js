// Everything painted on the table: the layout, the box (walnut frame, felt, tile rail) painted once into a
// cached layer, and the moving parts (tiles, dice, labels) drawn each frame on top of it.
// Light comes from the top left, so highlights sit on top/left edges and shadows fall down and right.

import { makeWood, makeFelt, makeCanvas } from './textures.js';

export const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const TOP_BAR = 54;       // room above the box for the round buttons and the wordmark

const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
const lerp = (a, b, t) => a + (b - a)*t;
const clamp01 = v => Math.max(0, Math.min(1, v));

///////////////////////////////////////////////////////////////////////////////
// layout

export function computeLayout(W, H)
{
  const portrait = W/H < .9;
  const margin = Math.max(10, Math.min(W, H)*.03);
  const availW = W - margin*2, availH = H - TOP_BAR - margin;
  const aspect = portrait ? Math.max(.5, Math.min(.78, availW/availH)) : 1.62;
  let bw = Math.min(availW, availH*aspect), bh = bw/aspect;
  if (bh > availH) { bh = availH; bw = bh*aspect; }
  const bx = (W - bw)/2, by = TOP_BAR + (availH - bh)/2;
  const f = Math.min(bw, bh)*(portrait ? .06 : .075);         // frame width
  const felt = { x: bx + f, y: by + f, w: bw - 2*f, h: bh - 2*f };

  // tiles live on a walnut rail across the top of the felt: one row, or two on a narrow screen
  const rows = portrait ? [[1, 2, 3, 4, 5], [6, 7, 8, 9]] : [[1, 2, 3, 4, 5, 6, 7, 8, 9]];
  const perRow = rows[0].length;
  const railPad = felt.w*(portrait ? .035 : .026);
  const gap = (felt.w - railPad*2)*(portrait ? .035 : .018);
  const slotW = (felt.w - railPad*2 - gap*(perRow - 1))/perRow;
  const slotH = slotW*(portrait ? 1.28 : 1.55);
  const rowGap = slotW*.2;
  const railH = railPad*2 + slotH*rows.length + rowGap*(rows.length - 1);
  const rail = { x: felt.x, y: felt.y, w: felt.w, h: railH };
  const slots = [];
  rows.forEach((row, ri) =>
  {
    const rowW = row.length*slotW + (row.length - 1)*gap;
    const x0 = felt.x + (felt.w - rowW)/2;
    row.forEach((n, ci) => slots[n - 1] = { n, x: x0 + ci*(slotW + gap), y: rail.y + railPad + ri*(slotH + rowGap), w: slotW, h: slotH });
  });

  // the dice and the roll button share the felt below the rail
  const zone = { x: felt.x, y: rail.y + rail.h, w: felt.w, h: felt.h - rail.h };
  const dieSize = Math.min(zone.w*(portrait ? .22 : .15), zone.h*.31);
  const dcy = zone.y + zone.h*.4;
  const two = [{ x: zone.x + zone.w/2 - dieSize*.95, y: dcy + dieSize*.08 }, { x: zone.x + zone.w/2 + dieSize*.95, y: dcy - dieSize*.1 }];
  const one = [{ x: zone.x + zone.w/2, y: dcy }];
  const btnW = Math.min(zone.w*.4, 230), btnH = Math.min(zone.h*.17, 50);
  const button = { x: zone.x + zone.w/2 - btnW/2, y: zone.y + zone.h*(portrait ? .62 : .74) - btnH/2, w: btnW, h: btnH };
  const promptY = zone.y + zone.h*(portrait ? .62 : .74);
  return { W, H, portrait, box: { x: bx, y: by, w: bw, h: bh }, f, felt, rail, slots, zone, dieSize, spots: { two, one }, button, railPad, promptY };
}

///////////////////////////////////////////////////////////////////////////////
// materials, built once

let mats = null;
export function buildMaterials()
{
  if (mats) return mats;
  mats = {
    walnut: makeWood(1100, 700, 'walnut'),
    deep: makeWood(900, 600, 'deepWalnut'),
    maple: makeWood(900, 360, 'maple'),
    inlay: makeWood(500, 80, 'inlay'),
    felt: makeFelt(300, 300),
  };
  mats.feltPattern = mats.felt.getContext('2d').createPattern(mats.felt, 'repeat');
  return mats;
}

///////////////////////////////////////////////////////////////////////////////
// the static layer: table, box, felt, rail

export function renderStatic(L, dpr)
{
  const m = buildMaterials();
  const canvas = makeCanvas(Math.ceil(L.W*dpr), Math.ceil(L.H*dpr));
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const { W, H, box: b, f, felt, rail } = L;

  // the table: dark walnut under a lamp
  ctx.drawImage(m.deep, 0, 0, W, H);
  let g = ctx.createRadialGradient(W/2, H*.42, 0, W/2, H*.42, Math.max(W, H)*.78);
  g.addColorStop(0, 'rgba(60,32,14,.18)'); g.addColorStop(.55, 'rgba(14,8,4,.62)'); g.addColorStop(1, 'rgba(6,3,2,.9)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // the box's shadow on the table
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = b.h*.09; ctx.shadowOffsetY = b.h*.035; ctx.shadowOffsetX = b.h*.012;
  rr(ctx, b.x, b.y, b.w, b.h, b.h*.014); ctx.fillStyle = '#2a1608'; ctx.fill();
  ctx.restore();

  drawFrame(ctx, L, m);
  drawFelt(ctx, L, m);
  drawRail(ctx, L, m);
  return canvas;
}

// the walnut frame: four mitred boards, grain running along each, with a bevel and a thin maple inlay line
function drawFrame(ctx, L, m)
{
  const { box: b, f } = L;
  const corners = { tl: [b.x, b.y], tr: [b.x + b.w, b.y], br: [b.x + b.w, b.y + b.h], bl: [b.x, b.y + b.h] };
  const inner = { tl: [b.x + f, b.y + f], tr: [b.x + b.w - f, b.y + f], br: [b.x + b.w - f, b.y + b.h - f], bl: [b.x + f, b.y + b.h - f] };
  const sides = [
    { a: 'tl', b: 'tr', shade: 'rgba(255,225,170,.14)', vertical: false, lum: 'top' },
    { a: 'tr', b: 'br', shade: 'rgba(0,0,0,.22)', vertical: true, lum: 'right' },
    { a: 'br', b: 'bl', shade: 'rgba(0,0,0,.34)', vertical: false, lum: 'bottom' },
    { a: 'bl', b: 'tl', shade: 'rgba(255,225,170,.06)', vertical: true, lum: 'left' },
  ];
  sides.forEach((s, i) =>
  {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(...corners[s.a]); ctx.lineTo(...corners[s.b]); ctx.lineTo(...inner[s.b]); ctx.lineTo(...inner[s.a]); ctx.closePath();
    ctx.clip();
    // each board takes a different slice of the grain texture, rotated so it runs along the board
    ctx.save();
    if (s.vertical)
    {
      ctx.translate(b.x + b.w/2, b.y + b.h/2); ctx.rotate(Math.PI/2);
      ctx.drawImage(m.walnut, 200 + i*150, 100 + i*80, 700, 420, -b.h/2, -b.w/2, b.h, b.w);
    }
    else ctx.drawImage(m.walnut, 80 + i*120, 60 + i*130, 800, 280, b.x, b.y, b.w, b.h);
    ctx.restore();
    ctx.fillStyle = s.shade; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  });
  // mitre lines where the boards meet
  ctx.save();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.5)';
  for (const k of ['tl', 'tr', 'br', 'bl']) { ctx.beginPath(); ctx.moveTo(...corners[k]); ctx.lineTo(...inner[k]); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,225,170,.12)';
  for (const k of ['tl', 'tr', 'br', 'bl']) { ctx.beginPath(); ctx.moveTo(corners[k][0] + .8, corners[k][1] + .8); ctx.lineTo(inner[k][0] + .8, inner[k][1] + .8); ctx.stroke(); }
  ctx.restore();

  // rounded outer edge: a soft highlight along top/left, dark along bottom/right
  ctx.save();
  rr(ctx, b.x + .5, b.y + .5, b.w - 1, b.h - 1, b.h*.014);
  ctx.lineWidth = 1.5;
  let g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
  g.addColorStop(0, 'rgba(255,230,185,.55)'); g.addColorStop(.5, 'rgba(255,230,185,.12)'); g.addColorStop(1, 'rgba(0,0,0,.65)');
  ctx.strokeStyle = g; ctx.stroke();
  // and a rounded-over edge: a wider soft band inside the outline
  ctx.lineWidth = f*.2;
  g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
  g.addColorStop(0, 'rgba(255,225,170,.2)'); g.addColorStop(.45, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.3)');
  rr(ctx, b.x + f*.1, b.y + f*.1, b.w - f*.2, b.h - f*.2, b.h*.01); ctx.strokeStyle = g; ctx.stroke();
  ctx.restore();

  // the inlay: a thin maple stringing line set into the frame
  ctx.save();
  const il = f*.42, lw = Math.max(1.6, f*.075);
  rr(ctx, b.x + il, b.y + il, b.w - il*2, b.h - il*2, 2);
  ctx.lineWidth = lw + 2; ctx.strokeStyle = 'rgba(15,7,2,.7)'; ctx.stroke();
  ctx.lineWidth = lw; ctx.strokeStyle = ctx.createPattern(m.inlay, 'repeat'); ctx.stroke();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,240,205,.35)';
  rr(ctx, b.x + il - lw/2 + .5, b.y + il - lw/2 + .5, b.w - il*2 + lw - 1, b.h - il*2 + lw - 1, 2); ctx.stroke();
  ctx.restore();

  // the lip the felt sits behind: a dark inner edge with a thin bright arris catching the light
  ctx.save();
  const x = b.x + f, y = b.y + f, w = b.w - 2*f, h = b.h - 2*f;
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,225,170,.22)'; ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
  ctx.restore();
}

// the felt well: cloth, a lamp-lit pool of light, and shadow where the frame's walls shade it
function drawFelt(ctx, L, m)
{
  const { felt: ft, f } = L;
  ctx.save();
  ctx.beginPath(); ctx.rect(ft.x, ft.y, ft.w, ft.h); ctx.clip();
  ctx.fillStyle = m.feltPattern; ctx.fillRect(ft.x, ft.y, ft.w, ft.h);
  // light pooling in the middle
  let g = ctx.createRadialGradient(ft.x + ft.w*.5, ft.y + ft.h*.55, 0, ft.x + ft.w*.5, ft.y + ft.h*.55, Math.max(ft.w, ft.h)*.7);
  g.addColorStop(0, 'rgba(210,255,200,.13)'); g.addColorStop(.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,12,4,.5)');
  ctx.fillStyle = g; ctx.fillRect(ft.x, ft.y, ft.w, ft.h);
  // the walls shade the felt: strongest under the top and left walls (the light is from the top left)
  const wall = (x0, y0, x1, y1, a) =>
  {
    const gr = ctx.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(0,10,4,${a})`); gr.addColorStop(1, 'rgba(0,10,4,0)');
    ctx.fillStyle = gr; ctx.fillRect(ft.x, ft.y, ft.w, ft.h);
  };
  const d = f*.9;
  wall(ft.x, ft.y, ft.x, ft.y + d, .62);
  wall(ft.x, ft.y, ft.x + d, ft.y, .5);
  wall(ft.x, ft.y + ft.h, ft.x, ft.y + ft.h - d*.7, .3);
  wall(ft.x + ft.w, ft.y, ft.x + ft.w - d*.7, ft.y, .3);

  // a dice tray printed on the cloth: a fine gilt rule
  const z = L.zone, pad = Math.min(z.w, z.h)*.045;
  rr(ctx, z.x + pad*2, z.y + pad*.7, z.w - pad*4, z.h - pad*1.7, 10);
  ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(236,208,128,.3)'; ctx.stroke();
  rr(ctx, z.x + pad*2 + 4, z.y + pad*.7 + 4, z.w - pad*4 - 8, z.h - pad*1.7 - 8, 7);
  ctx.lineWidth = .8; ctx.strokeStyle = 'rgba(236,208,128,.16)'; ctx.stroke();
  ctx.restore();
}

// the tile rail: a raised walnut board with a recessed slot behind every tile, and brass hinges
function drawRail(ctx, L, m)
{
  const { rail: r, felt, slots } = L;
  // the rail stands proud of the felt and casts a shadow down onto it
  ctx.save();
  ctx.beginPath(); ctx.rect(felt.x, felt.y, felt.w, felt.h); ctx.clip();
  ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#2a1608'; ctx.fillRect(r.x - 20, r.y - 20, r.w + 40, r.h + 20);
  ctx.restore();

  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  ctx.drawImage(m.deep, 120, 80, 760, 120, r.x, r.y, r.w, r.h);
  ctx.fillStyle = 'rgba(255,215,160,.07)'; ctx.fillRect(r.x, r.y, r.w, r.h);
  let g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, 'rgba(0,0,0,.35)'); g.addColorStop(.12, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.28)');
  ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
  // the front edge of the rail: a bevel catching the light, then a dark undercut
  ctx.fillStyle = 'rgba(255,225,170,.35)'; ctx.fillRect(r.x, r.y + r.h - 3, r.w, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(r.x, r.y + r.h - 1.5, r.w, 1.5);

  for (const s of slots)
  {
    const gx = s.w*.07;
    ctx.save();
    // the recess
    rr(ctx, s.x - gx, s.y - gx, s.w + gx*2, s.h + gx*2, s.w*.12);
    ctx.fillStyle = '#150b05'; ctx.fill();
    rr(ctx, s.x - gx*.6, s.y - gx*.6, s.w + gx*1.2, s.h + gx*1.2, s.w*.1);
    const sg = ctx.createLinearGradient(0, s.y, 0, s.y + s.h);
    sg.addColorStop(0, '#0d0603'); sg.addColorStop(.5, '#1f1109'); sg.addColorStop(1, '#2c180c');
    ctx.fillStyle = sg; ctx.fill();
    // light catches the lower lip of the recess
    ctx.beginPath(); ctx.moveTo(s.x - gx + 3, s.y + s.h + gx + .5); ctx.lineTo(s.x + s.w + gx - 3, s.y + s.h + gx + .5);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,225,170,.28)'; ctx.stroke();
    ctx.restore();
    // brass hinge on the rail above the slot
    const hw = s.w*.5, hh = Math.min(L.railPad*.34, s.w*.12), hx = s.x + (s.w - hw)/2, hy = s.y - gx - hh*1.1;
    brassPlate(ctx, hx, hy, hw, hh);
  }
}

function brassPlate(ctx, x, y, w, h)
{
  ctx.save();
  rr(ctx, x, y, w, h, h*.3);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#f2dc91'); g.addColorStop(.45, '#c99d3f'); g.addColorStop(1, '#7c5818');
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = .7; ctx.strokeStyle = 'rgba(50,30,0,.7)'; ctx.stroke();
  // two screws
  for (const sx of [x + h*.7, x + w - h*.7])
  {
    ctx.beginPath(); ctx.arc(sx, y + h/2, h*.22, 0, Math.PI*2); ctx.fillStyle = '#8a6420'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx - h*.17, y + h/2 + h*.05); ctx.lineTo(sx + h*.17, y + h/2 - h*.05);
    ctx.lineWidth = .8; ctx.strokeStyle = 'rgba(40,24,0,.8)'; ctx.stroke();
  }
  ctx.restore();
}

///////////////////////////////////////////////////////////////////////////////
// roll button and labels

export function drawButton(ctx, b, label, { hover=false, press=false, enabled=true, hint='' }={})
{
  const dy = press ? 3 : 0;
  ctx.save();
  ctx.globalAlpha = enabled ? 1 : .55;
  // base lip
  rr(ctx, b.x, b.y + 4, b.w, b.h, b.h*.3); ctx.fillStyle = '#3a2008';
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = press ? 3 : 10; ctx.shadowOffsetY = press ? 1 : 6; ctx.fill();
  ctx.shadowColor = 'transparent';
  // brass face
  const y = b.y + dy;
  rr(ctx, b.x, y, b.w, b.h, b.h*.3);
  let g = ctx.createLinearGradient(0, y, 0, y + b.h);
  g.addColorStop(0, hover ? '#f8e6a4' : '#efd88c'); g.addColorStop(.5, hover ? '#d9ae4c' : '#cfa341'); g.addColorStop(1, '#a37b26');
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = '#5a3d0b'; ctx.stroke();
  rr(ctx, b.x + 1.5, y + 1.5, b.w - 3, b.h - 3, b.h*.27); ctx.strokeStyle = 'rgba(255,250,215,.55)'; ctx.stroke();
  // engraved label
  ctx.font = `700 ${b.h*.42}px ${SERIF}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${b.h*.07}px`;
  ctx.fillStyle = 'rgba(255,245,200,.7)'; ctx.fillText(label, b.x + b.w/2, y + b.h/2 + 1.3);
  ctx.fillStyle = '#4b3207'; ctx.fillText(label, b.x + b.w/2, y + b.h/2 + .3);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
}

// text printed on the felt: cream, with a hair of shadow
export function feltText(ctx, text, x, y, size, { align='center', color='#efe5c4', weight=600, spacing=0, alpha=1, shadow=true }={})
{
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${weight} ${size}px ${SERIF}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  if (shadow) { ctx.fillStyle = 'rgba(0,18,6,.75)'; ctx.fillText(text, x, y + 1.2); }
  ctx.fillStyle = color; ctx.fillText(text, x, y);
  ctx.restore();
}
