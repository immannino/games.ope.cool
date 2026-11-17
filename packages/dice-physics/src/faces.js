// Face bookkeeping for cube dice, independent of any engine.
//
// A die's six faces are numbered like three.js's BoxGeometry materials: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z.
// `labels[face]` is the value written on that face. Rigging a roll never touches the physics: it only
// re-writes the labels, by a rotation of the cube, so the die is still a legal die (opposite faces keep
// their sums, handedness is kept) but its top face reads the value the game decided.

export const FACE_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const faceOfDir = (x, y, z) => FACE_DIRS.findIndex(d => d[0] === x && d[1] === y && d[2] === z);

// a standard d6: opposite faces add to 7
export const STANDARD_D6 = [3, 4, 1, 6, 2, 5];

// the 24 rotations of a cube, as 3x3 integer matrices
export const ROTATIONS = (() =>
{
  const out = [], perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const parity = p => { let s = 0; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (p[i] > p[j]) s++; return s % 2 ? -1 : 1; };
  for (const p of perms)
    for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1])
      if (parity(p)*sx*sy*sz === 1)
      {
        const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        m[0][p[0]] = sx; m[1][p[1]] = sy; m[2][p[2]] = sz;
        out.push(m);
      }
  return out;
})();
const apply = (m, v) => [0, 1, 2].map(i => m[i][0]*v[0] + m[i][1]*v[1] + m[i][2]*v[2]);

// Re-label a die so that physical face `up` shows `value`. Of the four ways to do it, `pick` (0..3) chooses one,
// so repeated rolls don't always turn a die the same way. Returns the new labels (the input isn't changed).
export function relabelForUp(labels, up, value, pick=0)
{
  const from = labels.indexOf(value);
  if (from < 0) return labels.slice();
  const fits = ROTATIONS.filter(m => { const d = apply(m, FACE_DIRS[from]); return faceOfDir(d[0], d[1], d[2]) === up; });
  const m = fits[Math.abs(pick) % fits.length];
  const next = labels.slice();
  labels.forEach((label, f) => { const d = apply(m, FACE_DIRS[f]); next[faceOfDir(d[0], d[1], d[2])] = label; });
  return next;
}

// which physical face points up, given the body's orientation as a quaternion {x,y,z,w}
export function upFace(q)
{
  // the y component of each local axis in world space
  const yx = 2*(q.x*q.y + q.w*q.z), yy = 1 - 2*(q.x*q.x + q.z*q.z), yz = 2*(q.y*q.z - q.w*q.x);
  const ys = [yx, -yx, yy, -yy, yz, -yz];
  let best = 0;
  for (let i = 1; i < 6; i++) if (ys[i] > ys[best]) best = i;
  return { face: best, flat: ys[best] }; // flat is 1 when lying square on the table
}
