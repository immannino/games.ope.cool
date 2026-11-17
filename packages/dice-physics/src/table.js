// A table of dice: cannon-es rigid bodies in a walled tray, with hand-held shaking, flick throws and
// rigged outcomes. No rendering and no globals: pass cannon-es in as `CANNON`, so the same code runs in
// the browser and in node tests.
//
// How a roll is rigged without looking rigged: a throw is simulated once, up front, in a hidden world, and
// every step is recorded. The recording says which face of each die ends up on top, so the table re-labels
// the dice (see faces.js) until that face reads the value the game decided, then plays the recording back
// in real time. The dice on screen are real physics, they just already know how it ends.
// Shaking, tilting and carrying the dice in a hand run live; only the throw itself is recorded.
//
// Units: a die is `size` (default 1) across; gravity is in dice per second squared. y is up; the felt is y = 0.

import { STANDARD_D6, FACE_DIRS, relabelForUp, upFace } from './faces.js';

export const STEP = 1/120;
const MAX_STEPS_PER_FRAME = 12;
const REST_CAP = 1100;           // steps (about 9s) before the table stops waiting and damps hard
const SETTLE_AFTER = 480;

export class DiceTable
{
  // options: bounds {x0,x1,z0,z1}, count, size, gravity, labels (per die, default a standard d6),
  // friction/restitution overrides, rigged (default true)
  constructor(CANNON, opts)
  {
    this.C = CANNON;
    this.opts = { size: 1, gravity: 70, count: 2, rigged: true, ...opts };
    const { bounds, size, gravity, count } = this.opts;
    this.bounds = bounds;
    this.size = size;
    this.G = gravity;
    this.tilt = { x: 0, z: 0 };
    this.phase = 'rest';      // 'rest' | 'hand' | 'cast'
    this.steps = 0;
    this.nudges = 0;
    this.acc = 0;
    this._clock = 0;
    this.listeners = {};
    this.lastImpact = [];
    this.hand = null;
    this.playback = null;
    this.rigTargets = null;

    const world = this.world = new CANNON.World();
    world.gravity.set(0, -gravity, 0);
    world.allowSleep = true;
    world.solver.iterations = 12;
    world.defaultContactMaterial.friction = .4;

    const mats = this.mats = { die: new CANNON.Material('die'), felt: new CANNON.Material('felt'), wall: new CANNON.Material('wall') };
    const o = this.opts;
    const link = (a, b, friction, restitution) => world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
    link(mats.die, mats.felt, o.feltFriction ?? .5, o.feltRestitution ?? .28);
    link(mats.die, mats.wall, o.wallFriction ?? .25, o.wallRestitution ?? .5);
    link(mats.die, mats.die, o.dieFriction ?? .3, o.dieRestitution ?? .42);

    const plane = (nx, ny, nz, x, y, z, material) =>
    {
      const b = new CANNON.Body({ mass: 0, material, shape: new CANNON.Plane() });
      b.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(nx, ny, nz)); // a plane's normal is +z locally
      b.position.set(x, y, z);
      world.addBody(b);
    };
    plane(0, 1, 0, 0, 0, 0, mats.felt);                       // the felt
    plane(1, 0, 0, bounds.x0, 0, 0, mats.wall);               // walls, normals pointing into the tray
    plane(-1, 0, 0, bounds.x1, 0, 0, mats.wall);
    plane(0, 0, 1, 0, 0, bounds.z0, mats.wall);
    plane(0, 0, -1, 0, 0, bounds.z1, mats.wall);
    plane(0, -1, 0, 0, 9*size, 0, mats.wall);                 // a lid, so a hard shake can't lose a die

    this.dice = [];
    for (let i = 0; i < count; i++)
    {
      const body = new CANNON.Body({
        mass: 1, material: mats.die, shape: new CANNON.Box(new CANNON.Vec3(size/2, size/2, size/2)),
        allowSleep: true, sleepSpeedLimit: .35, sleepTimeLimit: .35, linearDamping: .06, angularDamping: .12,
      });
      world.addBody(body);
      body.addEventListener('collide', e => this.onCollide(i, e));
      this.dice.push({ body, labels: (o.labels?.[i] || STANDARD_D6).slice(), active: true });
    }
    this.placeAtRest();
  }

  on(event, fn) { (this.listeners[event] ||= []).push(fn); return this; }
  emit(event, ...args) { for (const fn of this.listeners[event] || []) fn(...args); }

  onCollide(i, e)
  {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (v < 2.2) return;
    const other = this.dice.findIndex(d => d.body === e.body);
    const key = i*8 + (other < 0 ? 7 : other), last = this.lastImpact[key] ?? -9;
    if (this._clock - last < .045) return;
    this.lastImpact[key] = this._clock;
    const impact = { die: i, other, strength: Math.min(1, v/22), kind: other >= 0 ? 'dice' : e.body.material === this.mats.wall ? 'wall' : 'felt' };
    if (this.recording) this.recording.push({ step: this.steps, ...impact });
    else this.emit('impact', impact);
  }

  // lay the dice flat in a row, each turned a little, as if just set down
  placeAtRest(spots)
  {
    const { x0, x1, z0, z1 } = this.bounds, n = this.dice.length;
    this.dice.forEach((d, i) =>
    {
      const s = spots?.[i] || { x: (x0 + x1)/2 + (i - (n - 1)/2)*this.size*1.9, z: (z0 + z1)/2 };
      const b = d.body;
      b.position.set(s.x, this.size/2 + .001, s.z);
      b.quaternion.setFromEuler(0, s.yaw ?? (i*1.7 + .4), 0);
      b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
      b.sleep();
    });
    this.phase = 'rest';
    this.playback = null;
  }

  // take a die in or out of play (a game that sometimes rolls fewer dice)
  setActive(i, on)
  {
    const d = this.dice[i];
    if (d.active === on) return;
    d.active = on;
    if (on) { this.world.addBody(d.body); d.body.wakeUp(); }
    else { this.world.removeBody(d.body); d.body.velocity.set(0, 0, 0); d.body.angularVelocity.set(0, 0, 0); }
  }
  get live() { return this.dice.filter(d => d.active); }

  values() { return this.dice.map(d => d.labels[upFace(d.body.quaternion).face]); }
  faces() { return this.dice.map(d => upFace(d.body.quaternion)); }
  moving() { return this.phase !== 'rest'; }

  ///////////////////////////////////////////////////////////////////////////
  // input while the dice are in the hand or on the felt

  // horizontal gravity from tilting a phone: x and z in -1..1
  setTilt(x, z)
  {
    if (this.phase === 'cast') return;
    this.tilt.x = x; this.tilt.z = z;
    this.world.gravity.set(x*this.G*.5, -this.G, z*this.G*.5);
    if (x || z) for (const d of this.live) d.body.wakeUp();
  }

  // a shake: random knocks scaled by how hard (0..1), pointing mostly the way the phone moved
  kick(strength, dirX=0, dirZ=0)
  {
    if (this.phase === 'cast') return;
    for (const d of this.live)
    {
      const b = d.body;
      b.wakeUp();
      b.velocity.x += (Math.random() - .5)*14*strength + dirX*10*strength;
      b.velocity.z += (Math.random() - .5)*14*strength + dirZ*10*strength;
      b.velocity.y += (3 + Math.random()*7)*strength*this.G/70;
      b.angularVelocity.x += (Math.random() - .5)*30*strength;
      b.angularVelocity.z += (Math.random() - .5)*30*strength;
      b.angularVelocity.y += (Math.random() - .5)*20*strength;
    }
  }

  // Take the dice into a hand that follows (x, z); they float up and jostle.
  grab(x, z)
  {
    if (this.phase === 'cast') return false;
    this.phase = 'hand';
    this.hand = { x, z, vx: 0, vz: 0, t: 0 };
    for (const d of this.live) d.body.wakeUp();
    return true;
  }
  move(x, z, dt)
  {
    const h = this.hand;
    if (!h) return;
    const a = Math.min(1, dt*12); // the hand's smoothed velocity becomes the throw
    h.vx += ((x - h.x)/Math.max(dt, 1e-3) - h.vx)*a;
    h.vz += ((z - h.z)/Math.max(dt, 1e-3) - h.vz)*a;
    h.x = x; h.z = z;
  }

  // Throw. (vx, vz) is the flick in dice per second; with none, the dice are lobbed across from a random side.
  // `targets` are the values the dice must show, or null for whatever the physics decides.
  cast(vx=0, vz=0, targets=null)
  {
    const size = this.size, fromHand = this.phase === 'hand';
    this.rigTargets = this.opts.rigged ? targets : null;
    if (Math.hypot(vx, vz) < 4)
    {
      const ang = Math.random()*Math.PI*2, s = 20 + Math.random()*12;
      vx = Math.cos(ang)*s; vz = Math.sin(ang)*s;
    }
    const k = Math.min(1, 70*size/Math.hypot(vx, vz));
    vx *= k; vz *= k;
    for (const d of this.live)
    {
      const b = d.body;
      b.wakeUp();
      if (!fromHand) b.position.y = Math.max(b.position.y, size*.9);
      b.velocity.set(vx*(.85 + Math.random()*.3), (9 + Math.random()*8)*size, vz*(.85 + Math.random()*.3));
      b.angularVelocity.set((Math.random() - .5)*60, (Math.random() - .5)*40, (Math.random() - .5)*60);
    }
    this.hand = null;
    this.world.gravity.set(0, -this.G, 0);   // a throw ignores tilt
    this.tilt.x = this.tilt.z = 0;

    // play the whole throw in a hidden world and keep every step
    const sim = new DiceTable(this.C, { ...this.opts, count: this.dice.length, bounds: this.bounds });
    sim.copyFrom(this);
    this.dice.forEach((d, i) => sim.setActive(i, d.active));
    sim.phase = 'cast'; sim.steps = 0;
    sim.recording = [];
    const frames = [];
    let guard = REST_CAP*4;
    while (sim.phase === 'cast' && guard-- > 0) { sim.stepOnce(); frames.push(sim.snapshot()); }

    if (this.rigTargets)
      this.dice.forEach((d, i) =>
      {
        if (!d.active) return;
        const up = upFace(sim.dice[i].body.quaternion).face;
        if (this.rigTargets[i] != null && d.labels[up] !== this.rigTargets[i])
          d.labels = relabelForUp(d.labels, up, this.rigTargets[i], Math.floor(Math.random()*4));
      });
    this.playback = { frames, impacts: sim.recording, t: 0, next: 0, final: sim.dice.map(d => ({ p: d.body.position.clone(), q: d.body.quaternion.clone() })) };
    this.phase = 'cast';
    this.steps = 0;
  }

  snapshot()
  {
    const a = new Float32Array(this.dice.length*7);
    this.dice.forEach(({ body: b }, i) => a.set([b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], i*7));
    return a;
  }

  copyFrom(t)
  {
    this.phase = t.phase; this._clock = t._clock;
    this.world.gravity.copy(t.world.gravity);
    this.world.time = t.world.time;
    t.dice.forEach((d, i) =>
    {
      const a = this.dice[i].body, b = d.body;
      a.position.copy(b.position); a.quaternion.copy(b.quaternion);
      a.velocity.copy(b.velocity); a.angularVelocity.copy(b.angularVelocity);
      a.sleepState = b.sleepState; a.timeLastSleepy = b.timeLastSleepy;
      a.linearDamping = b.linearDamping; a.angularDamping = b.angularDamping;
      this.dice[i].labels = d.labels.slice();
    });
  }

  ///////////////////////////////////////////////////////////////////////////
  // stepping

  // advance by real time. Live physics runs in whole fixed steps; a throw plays its recording back.
  update(dt)
  {
    dt = Math.min(dt, .1);
    this._clock += dt;
    if (this.phase === 'cast' && this.playback) return this.play(dt);
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n++ < MAX_STEPS_PER_FRAME) { this.stepOnce(); this.acc -= STEP; }
    if (n >= MAX_STEPS_PER_FRAME) this.acc = 0;
  }

  play(dt)
  {
    const pb = this.playback, last = pb.frames.length - 1;
    pb.t += dt/STEP;
    const t = Math.min(pb.t, last), i = Math.floor(t), f = t - i;
    const a = pb.frames[i], b = pb.frames[Math.min(i + 1, last)];
    this.dice.forEach(({ body, active }, d) =>
    {
      if (!active) return;
      const o = d*7;
      body.position.set(a[o] + (b[o] - a[o])*f, a[o + 1] + (b[o + 1] - a[o + 1])*f, a[o + 2] + (b[o + 2] - a[o + 2])*f);
      const qa = body.quaternion.set(a[o + 3], a[o + 4], a[o + 5], a[o + 6]);
      qa.slerp(new this.C.Quaternion(b[o + 3], b[o + 4], b[o + 5], b[o + 6]), f, qa);
    });
    while (pb.next < pb.impacts.length && pb.impacts[pb.next].step <= t) this.emit('impact', pb.impacts[pb.next++]);
    if (pb.t < last) return;
    // landed: set the dice down exactly where the recording ended, and let them sleep
    this.dice.forEach(({ body, active }, d) =>
    {
      if (!active) return;
      body.position.copy(pb.final[d].p); body.quaternion.copy(pb.final[d].q);
      body.velocity.set(0, 0, 0); body.angularVelocity.set(0, 0, 0); body.sleep();
    });
    this.playback = null;
    this.phase = 'rest';
    this.emit('rest', this.values());
  }

  stepOnce()
  {
    const size = this.size;
    if (this.phase === 'hand' && this.hand)
    {
      const h = this.hand, t = (h.t += STEP);
      const live = this.live;
      live.forEach((d, i) =>
      {
        const b = d.body, n = live.length;
        // the dice jostle in a loose cluster around the hand, held up off the felt
        const ox = Math.cos(t*7 + i*2.4)*size*.55*(n - 1 ? 1 : 0), oz = Math.sin(t*9 + i*1.9)*size*.45*(n - 1 ? 1 : 0);
        const tx = h.x + ox + (i - (n - 1)/2)*size*.35, tz = h.z + oz, ty = size*1.9 + Math.sin(t*11 + i)*size*.25;
        b.velocity.x += ((tx - b.position.x)*34 - b.velocity.x)*.3;
        b.velocity.z += ((tz - b.position.z)*34 - b.velocity.z)*.3;
        b.velocity.y += ((ty - b.position.y)*34 - b.velocity.y)*.3;
        b.angularVelocity.x += (Math.random() - .5)*9; b.angularVelocity.z += (Math.random() - .5)*9;
        b.angularVelocity.scale(.97, b.angularVelocity);
      });
    }
    this.world.step(STEP);
    if (!this.recording) return;       // only the hidden world waits for the dice to rest
    this.steps++;
    this._clock += STEP;
    if (this.steps === SETTLE_AFTER) for (const d of this.live) { d.body.linearDamping = .5; d.body.angularDamping = .6; }
    if (this.steps % 8 === 0 && this.steps > 40) this.checkRest();
  }

  // show given values on dice lying flat (used to restore a view without throwing)
  showValues(values)
  {
    this.dice.forEach((d, i) => { if (values[i] != null) d.labels = relabelForUp(d.labels, upFace(d.body.quaternion).face, values[i], i); });
  }

  // last resort for a die that won't lie flat: square it up on the nearest face and set it on the felt, clear of the others
  straighten(dice)
  {
    const C = this.C, size = this.size, { x0, x1, z0, z1 } = this.bounds;
    for (const d of dice)
    {
      const b = d.body, { face } = upFace(b.quaternion), dir = FACE_DIRS[face];
      const n = b.quaternion.vmult(new C.Vec3(dir[0], dir[1], dir[2])), r = new C.Quaternion();
      r.setFromVectors(n, new C.Vec3(0, 1, 0));
      r.mult(b.quaternion, b.quaternion);
      if (b.position.y > size*.8 || b.position.y < size*.45)
        for (let k = 0; k < 40; k++)
        {
          const x = x0 + size + Math.random()*(x1 - x0 - 2*size), z = z0 + size + Math.random()*(z1 - z0 - 2*size);
          if (this.live.every(o => o === d || Math.hypot(o.body.position.x - x, o.body.position.z - z) > size*1.5)) { b.position.x = x; b.position.z = z; break; }
        }
      b.position.y = size/2;
    }
  }

  checkRest()
  {
    const allSleep = this.live.every(d => d.body.sleepState === 2 /* SLEEPING */);
    const slow = this.steps > REST_CAP || this.nudges >= 4;
    if (!allSleep && !slow) return;
    // a die cocked against a wall, or stacked on another, gets nudged instead of ending the roll
    const cocked = this.live.filter(d => upFace(d.body.quaternion).flat < .97 || d.body.position.y > this.size*.8);
    if (cocked.length && !slow)
    {
      cocked.forEach((d, i) =>
      {
        const b = d.body, s = (this.steps/8 + i) % 4;
        b.wakeUp();
        b.velocity.set(s < 2 ? 2 : -2, 5*this.size*.5, s % 2 ? 1.5 : -1.5);
        b.angularVelocity.set(3 + s, 1, -3 + s);
      });
      this.steps = Math.min(this.steps, SETTLE_AFTER - 80);
      this.nudges++;
      return;
    }
    if (cocked.length) this.straighten(cocked);
    this.phase = 'rest';
  }
}
