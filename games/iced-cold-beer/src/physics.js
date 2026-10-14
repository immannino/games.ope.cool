// 3D rigid-body simulation of the Ice Cold Beer mechanism.
//
// Units are SI (meters, seconds). Axes: x right, y up the playfield,
// z out of the board toward the player. The board is the plane z = 0 with
// cylindrical holes through it; the cabinet glass sits in front at z = glassZ.
// The playfield leans back from vertical, so gravity has a component along -y
// (rolls the ball down the bar) and a smaller one along -z (presses the ball
// into the board, which is what makes it drop into holes).
//
// The ball is a solid steel sphere with full 3D angular velocity, so rolling,
// spin and slip come out of the contact friction model rather than being faked.

export const PHYS = {
  g: 9.81,
  incline: 14 * Math.PI / 180, // playfield lean back from vertical
  ballR: 0.0127, // 1" steel ball
  barR: 0.0048, // ~3/8" rod
  barZ: 0.0118, // bar axis distance in front of the board
  glassZ: 0.0275, // playfield glass: close enough that the ball cannot ride over the front of the bar
  poleR: 0.006,
  boardThickness: 0.012,
  restitution: 0.35,
  mu: 0.3, // steel on steel / lacquered wood
  rollResist: 0.08, // rolling resistance (1/s on spin)
  spinDamp: 0.6, // drilling friction: damping of spin about a contact normal
  airDrag: 0.02,
  captureDepth: 0.45, // ball center this many radii behind the board => gone
  motorSpeed: 0.1, // m/s bar end speed
  motorAccel: 0.9, // m/s^2 spin-up of the bar motors
  maxTiltDiff: 0.16, // m height difference between bar ends
};

// ---- small vec3 helpers (plain arrays, hot loop friendly) ----
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Sim {
  constructor(cfg) {
    // cfg: { holes:[{x,y}], holeR, poleXL, poleXR, barMinY, barMaxY, speedScale }
    this.cfg = cfg;
    this.holes = cfg.holes;
    this.holeR = cfg.holeR;
    this.speedScale = 1;
    this.bar = { yl: cfg.barMinY, yr: cfg.barMinY, vl: 0, vr: 0 };
    this.ball = null;
    this.events = []; // { type:'impact', strength } | { type:'capture', hole }
    const s = Math.sin(PHYS.incline), c = Math.cos(PHYS.incline);
    this.gravity = [0, -PHYS.g * c, -PHYS.g * s];
  }

  // drop a ball at x, sitting on the bar unless a release height y is given
  spawnBall(x, y) {
    const R = PHYS.ballR;
    y = Math.max(y ?? -Infinity, this.barYAt(x) + R + PHYS.barR + 0.004);
    this.ball = {
      p: [x, y, R],
      v: [0, 0, 0],
      w: [0, 0, 0],
      q: [0, 0, 0, 1], // orientation quaternion (x,y,z,w)
      onBar: false,
      onBoard: false,
      hole: null, // hole currently under the ball, if any
      speed: 0,
    };
  }

  barYAt(x) {
    const { poleXL, poleXR } = this.cfg;
    const t = clamp((x - poleXL) / (poleXR - poleXL), 0, 1);
    return this.bar.yl + (this.bar.yr - this.bar.yl) * t;
  }

  nearestHole(x, y) {
    let best = null, bd = Infinity;
    for (const h of this.holes) {
      const d = (h.x - x) ** 2 + (h.y - y) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    return { hole: best, d: Math.sqrt(bd) };
  }

  // inputL / inputR in [-1, 1]
  step(dt, inputL, inputR) {
    this.dt = dt;
    this.stepBar(dt, inputL, inputR);
    if (this.ball && !this.ball.captured) this.stepBall(dt);
  }

  stepBar(dt, inL, inR) {
    const b = this.bar, { barMinY, barMaxY } = this.cfg;
    const vmax = PHYS.motorSpeed * this.speedScale, acc = PHYS.motorAccel * this.speedScale;
    const approach = (v, target) => v + clamp(target - v, -acc * dt, acc * dt);
    b.vl = approach(b.vl, inL * vmax);
    b.vr = approach(b.vr, inR * vmax);
    b.yl += b.vl * dt;
    b.yr += b.vr * dt;
    if (b.yl < barMinY) { b.yl = barMinY; b.vl = 0; }
    if (b.yl > barMaxY) { b.yl = barMaxY; b.vl = 0; }
    if (b.yr < barMinY) { b.yr = barMinY; b.vr = 0; }
    if (b.yr > barMaxY) { b.yr = barMaxY; b.vr = 0; }
    // mechanical tilt limit: the end that is driving the tilt stalls
    const diff = b.yl - b.yr, lim = PHYS.maxTiltDiff;
    if (Math.abs(diff) > lim) {
      const over = Math.abs(diff) - lim, sign = Math.sign(diff);
      // which end is moving to make it worse?
      const worseL = sign * b.vl > 0, worseR = -sign * b.vr > 0;
      if (worseL || !worseR) { b.yl -= sign * over; b.vl = 0; }
      else { b.yr += sign * over; b.vr = 0; }
    }
  }

  stepBall(dt) {
    const ball = this.ball, p = ball.p, v = ball.v, w = ball.w, R = PHYS.ballR;
    const g = this.gravity;

    // integrate (semi-implicit Euler)
    v[0] += g[0] * dt; v[1] += g[1] * dt; v[2] += g[2] * dt;
    const drag = 1 - PHYS.airDrag * dt;
    v[0] *= drag; v[1] *= drag; v[2] *= drag;
    p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
    integrateQuat(ball.q, w, dt);

    ball.onBar = ball.onBoard = false;
    const nh = this.nearestHole(p[0], p[1]);
    ball.hole = nh.d < this.holeR ? nh.hole : null;
    ball.holeDist = nh.d;

    // contacts, a couple of sequential-impulse passes
    for (let iter = 0; iter < 2; iter++) {
      this.contactBoard(nh, iter === 0);
      this.contactBar(iter === 0);
      this.contactWalls(iter === 0);
    }

    // resistance while touching something
    if (ball.onBar || ball.onBoard) {
      const k = 1 - PHYS.rollResist * dt;
      w[0] *= k; w[1] *= k; w[2] *= k;
    }

    ball.speed = Math.hypot(v[0], v[1], v[2]);

    // fell through a hole?
    if (ball.hole && p[2] < -PHYS.captureDepth * R) {
      ball.captured = ball.hole;
      this.events.push({ type: 'capture', hole: ball.hole });
    }
    // safety: lost below the playfield
    if (p[1] < this.cfg.barMinY - 0.1) {
      ball.captured = { lost: true };
      this.events.push({ type: 'capture', hole: null });
    }
  }

  // closest point on the board solid (plane with cylindrical holes)
  contactBoard(nh, report) {
    const ball = this.ball, p = ball.p, R = PHYS.ballR, hr = this.holeR;
    let n, pen;
    if (nh.d >= hr) {
      if (p[2] >= R) return;
      n = [0, 0, 1];
      pen = R - p[2];
    } else {
      // over a hole: the nearest solid is the rim edge (or the tube wall once inside)
      const h = nh.hole;
      let dx = p[0] - h.x, dy = p[1] - h.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-7) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
      const zc = Math.max(Math.min(p[2], 0), -PHYS.boardThickness);
      const rim = [h.x + dx * hr, h.y + dy * hr, zc];
      const delta = [p[0] - rim[0], p[1] - rim[1], p[2] - rim[2]];
      const dist = Math.hypot(delta[0], delta[1], delta[2]);
      if (dist >= R || dist < 1e-9) return;
      n = [delta[0] / dist, delta[1] / dist, delta[2] / dist];
      pen = R - dist;
    }
    ball.onBoard = true;
    this.resolve(n, pen, [0, 0, 0], report);
  }

  contactBar(report) {
    const ball = this.ball, p = ball.p, R = PHYS.ballR;
    const { poleXL, poleXR } = this.cfg, b = this.bar;
    const ax = poleXL, ay = b.yl, bx = poleXR, by = b.yr, z = PHYS.barZ;
    const ex = bx - ax, ey = by - ay;
    const t = clamp(((p[0] - ax) * ex + (p[1] - ay) * ey) / (ex * ex + ey * ey), 0, 1);
    const c = [ax + ex * t, ay + ey * t, z];
    const delta = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const dist = Math.hypot(delta[0], delta[1], delta[2]);
    const minD = R + PHYS.barR;
    if (dist >= minD || dist < 1e-9) return;
    const n = [delta[0] / dist, delta[1] / dist, delta[2] / dist];
    ball.onBar = true;
    this.resolve(n, minD - dist, [0, b.vl + (b.vr - b.vl) * t, 0], report);
  }

  contactWalls(report) {
    const p = this.ball.p, R = PHYS.ballR;
    const xl = this.cfg.poleXL + PHYS.poleR + R, xr = this.cfg.poleXR - PHYS.poleR - R;
    if (p[0] < xl) this.resolve([1, 0, 0], xl - p[0], [0, 0, 0], report);
    if (p[0] > xr) this.resolve([-1, 0, 0], p[0] - xr, [0, 0, 0], report);
    const zg = PHYS.glassZ - R;
    if (p[2] > zg) this.resolve([0, 0, -1], p[2] - zg, [0, 0, 0], report);
  }

  // positional correction + normal impulse + Coulomb friction with rolling
  resolve(n, pen, vOther, report) {
    const ball = this.ball, p = ball.p, v = ball.v, w = ball.w, R = PHYS.ballR;
    p[0] += n[0] * pen; p[1] += n[1] * pen; p[2] += n[2] * pen;

    const rel = [v[0] - vOther[0], v[1] - vOther[1], v[2] - vOther[2]];
    const vn = dot(rel, n);
    let jn = 0;
    if (vn < 0) {
      const e = vn < -0.12 ? PHYS.restitution : 0;
      jn = -(1 + e) * vn;
      v[0] += n[0] * jn; v[1] += n[1] * jn; v[2] += n[2] * jn;
      if (report && vn < -0.06) this.events.push({ type: 'impact', strength: -vn });
    }

    // friction at the contact point r = -n R
    const r = [-n[0] * R, -n[1] * R, -n[2] * R];
    const wr = cross(w, r);
    const u = [v[0] + wr[0] - vOther[0], v[1] + wr[1] - vOther[1], v[2] + wr[2] - vOther[2]];
    const un = dot(u, n);
    const ut = [u[0] - n[0] * un, u[1] - n[1] * un, u[2] - n[2] * un];
    // impulse (per unit mass) that would make the contact roll without slipping
    let jt = [ut[0] * -2 / 7, ut[1] * -2 / 7, ut[2] * -2 / 7];
    const jtLen = Math.hypot(jt[0], jt[1], jt[2]);
    const maxF = PHYS.mu * jn;
    if (jtLen > maxF && jtLen > 0) {
      const s = maxF / jtLen;
      jt = [jt[0] * s, jt[1] * s, jt[2] * s];
    }
    v[0] += jt[0]; v[1] += jt[1]; v[2] += jt[2];
    const dw = cross(r, jt), k = 5 / (2 * R * R);
    w[0] += dw[0] * k; w[1] += dw[1] * k; w[2] += dw[2] * k;

    // spin about the contact normal dies quickly (pivot friction)
    const wn = dot(w, n), sd = Math.min(1, PHYS.spinDamp * this.dt);
    w[0] -= n[0] * wn * sd; w[1] -= n[1] * wn * sd; w[2] -= n[2] * wn * sd;
  }
}

function integrateQuat(q, w, dt) {
  const ang = Math.hypot(w[0], w[1], w[2]) * dt;
  if (ang < 1e-9) return;
  const s = Math.sin(ang / 2) / (ang / dt), c = Math.cos(ang / 2);
  const dx = w[0] * s, dy = w[1] * s, dz = w[2] * s;
  const [x, y, z, ww] = q;
  // dq * q
  q[0] = c * x + dx * ww + dy * z - dz * y;
  q[1] = c * y - dx * z + dy * ww + dz * x;
  q[2] = c * z + dx * y - dy * x + dz * ww;
  q[3] = c * ww - dx * x - dy * y - dz * z;
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
}

// rotate world vector into the ball's local frame (inverse quaternion)
export function toLocal(q, v) {
  const x = -q[0], y = -q[1], z = -q[2], w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}
