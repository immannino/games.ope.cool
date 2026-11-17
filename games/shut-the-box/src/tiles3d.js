// The nine tiles as real hinged slabs of maple. Each tile swings on a hinge along its far edge: lifted a little
// when picked, and when it scores it's flicked up and falls into the well, bouncing off the bottom with a clack.

import { THREE, RoundedBoxGeometry } from './stage.js';
import { SERIF } from './scene.js';

const HALF_PI = Math.PI/2;

// the numbered face: maple grain, a chamfer catching the light, and the numeral cut in
function faceTexture(n, w, h, maple)
{
  const S = 2.5, c = document.createElement('canvas');
  c.width = Math.round(w*S); c.height = Math.round(h*S);
  const g = c.getContext('2d');
  g.scale(S, S);
  const ox = (n*131) % 380, oy = (n*57) % 150;
  g.drawImage(maple, ox, oy, 500, 200, 0, 0, w, h);
  // a deeper, richer maple at rest, so a lit tile has somewhere to pop from
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgb(196,160,118)'; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  const fg = g.createLinearGradient(0, 0, w*.9, h);
  fg.addColorStop(0, 'rgba(255,248,225,.25)'); fg.addColorStop(.5, 'rgba(255,240,200,0)'); fg.addColorStop(1, 'rgba(70,35,5,.18)');
  g.fillStyle = fg; g.fillRect(0, 0, w, h);
  g.lineWidth = 1; g.strokeStyle = 'rgba(80,45,10,.3)';
  g.strokeRect(w*.08, w*.08, w*.84, h - w*.16);
  const fs = w*.66;
  g.font = `700 ${fs}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const cy = h*.53;
  g.fillStyle = 'rgba(255,245,220,.75)'; g.fillText(n, w/2 + .8, cy + 1.3);
  const tg = g.createLinearGradient(0, cy - fs/2, 0, cy + fs/2);
  tg.addColorStop(0, '#0f0501'); tg.addColorStop(1, '#2a1305');
  g.fillStyle = tg; g.fillText(n, w/2, cy);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export class TileBoard
{
  // slots: layout slots in px; toWorld converts px to world units. onClack(strength) fires when a tile hits bottom.
  constructor(stage, slots, maple, onClack)
  {
    this.stage = stage; this.onClack = onClack;
    this.group = new THREE.Group();
    stage.scene.add(this.group);
    this.tiles = [];
    this.build(slots, maple);
  }

  build(slots, maple)
  {
    for (const t of this.tiles) { this.group.remove(t.pivot); t.mesh.material.forEach(m => m.map?.dispose()); }
    this.tiles = [];
    const { stage } = this, ppu = stage.ppu;
    const side = new THREE.MeshStandardMaterial({ color: 0xa97c47, roughness: .6 });
    for (const s of slots)
    {
      const w = s.w/ppu, h = s.h/ppu, tt = w*.15;
      const top = new THREE.MeshStandardMaterial({ map: faceTexture(s.n, s.w, s.h, maple), roughness: .55, metalness: 0, emissive: 0xffb040, emissiveIntensity: 0 });
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, tt, h, 3, tt*.42), [side, side, top, side, side, side]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.set(0, -tt/2, h/2);
      const pivot = new THREE.Group();
      const p = stage.toWorld(s.x + s.w/2, s.y);
      pivot.position.set(p.x, tt*1.05, p.z);   // hinge: the tile's far edge, at its top surface
      pivot.add(mesh);
      this.group.add(pivot);
      this.tiles.push({
        n: s.n, slot: s, mesh, pivot, top, w, h, tt,
        angle: 0, vel: 0, mode: 'open', delay: 0, hint: 0, dim: 0, pressed: false, drag: 0,
      });
    }
  }

  // 'open' (flat), 'shut' (hanging in the well). Set delay (s) for staggering.
  setShut(i, shut, delay=0)
  {
    const t = this.tiles[i];
    if (shut === (t.mode === 'shut') && delay === 0 && t.mode !== 'resetting') return;
    t.delay = delay;
    t.mode = shut ? 'shutting' : 'resetting';
    t.shutKick = shut;
  }
  isShut(i) { const t = this.tiles[i]; return t.mode === 'shut' || t.mode === 'shutting'; }
  allSettled() { return this.tiles.every(t => t.mode === 'open' || t.mode === 'shut'); }

  // visual state for a tile that's still open
  setPose(i, { lifted=false, pressed=false, hint=0, dim=0, drag=0 })
  {
    const t = this.tiles[i];
    t.lifted = lifted; t.pressed = pressed; t.hintTarget = hint; t.dimTarget = dim; t.drag = drag;
  }

  // a flick or pop: kick the tile's hinge so it springs up
  pop(i, speed=-5) { const t = this.tiles[i]; if (t.mode === 'open') t.vel += speed; }

  update(dt, time)
  {
    dt = Math.min(dt, 1/30);
    for (const t of this.tiles)
    {
      if (t.delay > 0) { t.delay -= dt; if (t.delay > 0) continue; if (t.shutKick) t.vel = -7; else t.vel = -1; t.shutKick = false; }
      if (t.mode === 'shutting')
      {
        // gravity swings the tile down about its hinge; it bounces off the bottom of the well
        t.vel += (86*Math.cos(Math.max(0, Math.min(HALF_PI, t.angle))) + 6)*dt - 2.2*t.vel*dt;
        t.angle += t.vel*dt;
        if (t.angle >= HALF_PI*.985)
        {
          t.angle = HALF_PI*.985;
          if (t.vel > 1.4) this.onClack?.(Math.min(1, t.vel/7));
          t.vel *= -.3;
          if (Math.abs(t.vel) < .7) { t.vel = 0; t.angle = HALF_PI*.985; t.mode = 'shut'; }
        }
      }
      else if (t.mode === 'shut') { t.angle = HALF_PI*.985; }
      else
      {
        // open tiles ride a spring to wherever they should sit: flat, tilted up when picked, pressed when touched
        const target = t.mode === 'resetting' ? 0 : t.drag ? -t.drag : t.lifted ? -.34 : t.pressed ? .07 : 0;
        const k = 300, c = 20;
        t.vel += (-k*(t.angle - target) - c*t.vel)*dt;
        t.angle += t.vel*dt;
        if (t.mode === 'resetting' && Math.abs(t.angle) < .02 && Math.abs(t.vel) < .5) t.mode = 'open';
      }
      t.pivot.rotation.x = t.angle;
      // picked tiles stand proud of the rail
      const rise = t.mode === 'open' ? Math.max(0, -t.angle)*.35 : 0;
      t.pivot.position.y = t.tt*1.05 + rise;

      // hint lighting: lit tiles glow a little, unlit ones sink into shade
      t.hint += ((t.hintTarget || 0) - t.hint)*Math.min(1, dt*10);
      t.dim += ((t.dimTarget || 0) - t.dim)*Math.min(1, dt*10);
      t.top.emissiveIntensity = 0; // emissive washes out the engraving (a little linear light is a lot after sRGB), so light is brightness only
      const shade = (1 - t.dim*.5 + t.hint*.05*Math.sin(time*4 + t.n))*(1 - .62*Math.min(1, Math.max(0, t.angle)/HALF_PI)); // a hanging tile is in shadow
      t.top.color.setRGB(shade, shade*.97, shade*.94);
    }
  }

  // which tile (0-8) is under a screen point, using the slot rectangles
  pick(px, py)
  {
    for (const t of this.tiles)
    {
      const s = t.slot, pad = s.w*.08;
      if (px >= s.x - pad && px <= s.x + s.w + pad && py >= s.y - pad && py <= s.y + s.h + pad) return t.n - 1;
    }
    return -1;
  }
}
