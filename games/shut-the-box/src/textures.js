// Procedural materials: wood and felt are generated once into canvases, so the game ships no image files.

// seeded hash noise: smooth value noise from a lattice of random values
function hash(ix, iy, seed)
{
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y, seed)
{
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx*fx*(3 - 2*fx), sy = fy*fy*(3 - 2*fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a)*sx + (c - a)*sy + (a - b - c + d)*sx*sy;
}
const fbm = (x, y, seed, oct=4) =>
{
  let v = 0, amp = .5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { v += amp*noise(x*f, y*f, seed + i*17); norm += amp; amp *= .5; f *= 2; }
  return v/norm;
};
const mix = (a, b, t) => a + (b - a)*t;
const smooth = t => t*t*(3 - 2*t);

export function makeCanvas(w, h)
{
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Wood with the grain running left to right. `light`/`dark` are the earlywood and latewood colours,
// `rings` how many growth bands show across the height, `figure` how wavy the grain is.
export const WOODS = {
  walnut: { dark: [48, 26, 14], light: [140, 84, 46], rings: 7, figure: 1.0, seed: 11 },
  deepWalnut: { dark: [26, 13, 7], light: [74, 41, 22], rings: 9, figure: 1.2, seed: 23 },
  maple: { dark: [186, 140, 84], light: [238, 205, 150], rings: 5, figure: .6, seed: 5 },
  inlay: { dark: [150, 108, 60], light: [212, 170, 110], rings: 4, figure: .5, seed: 41 },
};

export function makeWood(w, h, kind='walnut', seedShift=0)
{
  const { dark, light, rings, figure, seed } = WOODS[kind], s = seed + seedShift;
  const canvas = makeCanvas(w, h), ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++)
  {
    for (let x = 0; x < w; x++)
    {
      const u = x/w, v = y/h;
      // the grain wanders: a slow warp bends the growth bands, a second one adds cathedral arches
      const warp = fbm(u*2.2, v*1.4, s, 3)*figure;
      const arch = fbm(u*.9 + 3, v*.7, s + 3, 2)*figure;
      const band = (v*rings + warp*2.6 + arch*1.5)%1;
      // late wood is a hard dark line that fades into the early wood
      const ring = Math.pow(1 - Math.abs(band*2 - 1), 3.2);
      const streak = fbm(u*5, v*90, s + 7, 3);       // long fibres along the grain
      const pore = noise(u*w*.35, v*h*1.4, s + 9);   // tiny dark flecks across it
      const mottle = fbm(u*3, v*2.5, s + 13, 3);
      let t = .46*ring + .3*streak + .24*mottle;
      t = smooth(Math.min(1, Math.max(0, t*1.15 - .06)));
      const shade = 1 - (pore > .78 ? (pore - .78)*1.1 : 0); // pores darken the surface slightly
      const i = (y*w + x)*4;
      d[i] = mix(dark[0], light[0], t)*shade;
      d[i + 1] = mix(dark[1], light[1], t)*shade;
      d[i + 2] = mix(dark[2], light[2], t)*shade;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Billiard-cloth felt: a dense short nap. Fine noise at the pixel level plus soft mottling.
export function makeFelt(w, h, base=[24, 96, 60])
{
  const canvas = makeCanvas(w, h), ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++)
  {
    for (let x = 0; x < w; x++)
    {
      const fine = hash(x, y, 77) - .5, mid = noise(x*.5, y*.5, 78) - .5, slow = fbm(x/w*4, y/h*4, 79, 3) - .5;
      const k = 1 + fine*.17 + mid*.13 + slow*.2;
      const i = (y*w + x)*4;
      d[i] = base[0]*k; d[i + 1] = base[1]*k; d[i + 2] = base[2]*k; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// a tileable wood swatch for CSS panels and buttons
export const woodDataUrl = (kind='walnut', w=640, h=420) => makeWood(w, h, kind, 3).toDataURL('image/jpeg', .85);
