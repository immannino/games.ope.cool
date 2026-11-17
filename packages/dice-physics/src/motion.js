// Phone motion: shaking and tilting. Shaking rattles the dice and, when it stops, throws them; tilting slides
// them across the felt like dice in a tray. Nothing happens until `enable()` is called from a tap, because iOS
// asks permission and only from a user gesture.

export class Motion
{
  // callbacks: onShake(strength 0..1, dirX, dirZ), onShakeEnd(), onTilt(x, z)
  constructor({ onShake, onShakeEnd, onTilt, threshold=9, quietMs=380 }={})
  {
    Object.assign(this, { onShake, onShakeEnd, onTilt, threshold, quietMs });
    this.enabled = false; this.shaking = false; this.lastLoud = 0; this.timer = 0;
    this.listener = e => this.handle(e);
  }

  static get supported() { return typeof window !== 'undefined' && 'DeviceMotionEvent' in window; }
  static get needsPermission() { return Motion.supported && typeof DeviceMotionEvent.requestPermission === 'function'; }
  get isIOS() { return Motion.needsPermission; }

  // returns true when motion events are flowing (or at least allowed)
  async enable()
  {
    if (this.enabled) return true;
    if (!Motion.supported) return false;
    if (Motion.needsPermission)
    {
      try { if (await DeviceMotionEvent.requestPermission() !== 'granted') return false; } catch { return false; }
    }
    addEventListener('devicemotion', this.listener);
    this.enabled = true;
    return true;
  }
  disable()
  {
    removeEventListener('devicemotion', this.listener);
    this.enabled = false; this.shaking = false; clearTimeout(this.timer);
    this.onTilt?.(0, 0);
  }

  handle(e)
  {
    const g = e.accelerationIncludingGravity, a = e.acceleration;
    if (!g) return;
    // screen-space axes: undo the phone's rotation so up on screen is always -z on the table
    const angle = (screen.orientation?.angle ?? window.orientation ?? 0)*Math.PI/180, c = Math.cos(angle), s = Math.sin(angle);
    const sign = this.isIOS ? -1 : 1;                   // iOS reports gravity with the opposite sign to the spec
    const rot = (x, y) => [x*c + y*s, -x*s + y*c];
    const [gx, gy] = rot(g.x ?? 0, g.y ?? 0);
    // lying flat reads (0, 0, 9.8); tilting the right edge down pulls gravity to the right
    this.onTilt?.(Math.max(-1, Math.min(1, sign*gx/9.8)), Math.max(-1, Math.min(1, -sign*gy/9.8)));

    const lin = a && a.x != null ? a : null;
    const [ax, ay] = lin ? rot(lin.x ?? 0, lin.y ?? 0) : [0, 0];
    const mag = lin ? Math.hypot(lin.x ?? 0, lin.y ?? 0, lin.z ?? 0) : 0;
    if (mag > this.threshold)
    {
      this.shaking = true; this.lastLoud = performance.now();
      const m = Math.hypot(ax, ay) || 1;
      this.onShake?.(Math.min(1, mag/35), sign*ax/m, -sign*ay/m);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { if (this.shaking) { this.shaking = false; this.onShakeEnd?.(); } }, this.quietMs);
    }
  }
}
