// Touch controls for phones and tablets, mirroring wheel + space with two thumbs:
//   left half of the screen: a steering pad. Drag up or down and the worm follows your thumb.
//   right half: the throttle. Hold to surge, let go to ease off.
// Menus are tapped directly (see updateMenu in main.js).

export const touch = {
  used: false,      // a finger has touched the screen at some point: switch hints and controls to touch
  active: false,    // a finger is down right now
  throttle: false,  // a finger is down on the right half
};
let steerPixels = 0; // vertical drag on the left half since last read, in CSS pixels (up is positive)
const fingers = new Map();

// a phone or tablet, even before the first touch (for showing the right controls on the title screen)
export const touchFirst = () => touch.used || matchMedia('(pointer: coarse)').matches;

function refresh()
{
  touch.active = fingers.size > 0;
  touch.throttle = [...fingers.values()].some(f => !f.left);
}

addEventListener('pointerdown', e =>
{
  if (e.pointerType != 'touch') return;
  touch.used = true;
  fingers.set(e.pointerId, { left: e.clientX < innerWidth/2, y: e.clientY });
  refresh();
}, { capture: true, passive: true });

addEventListener('pointermove', e =>
{
  const f = fingers.get(e.pointerId);
  if (!f) return;
  if (f.left) steerPixels += f.y - e.clientY;
  f.y = e.clientY;
}, { capture: true, passive: true });

for (const type of ['pointerup', 'pointercancel'])
  addEventListener(type, e => { fingers.delete(e.pointerId); refresh(); }, { capture: true, passive: true });

// steering drag since the last call, in CSS pixels
export function takeSteerPixels()
{
  const v = steerPixels;
  steerPixels = 0;
  return v;
}
