// A three.js view of a DiceTable: a lacquered, rounded die mesh per body, with the face labels as textures.
// three is passed in (`THREE`, and `RoundedBoxGeometry` from three/examples) so the package carries no dependencies.
//
// `faceTexture(label)` returns a canvas (or texture) for one face. Games with their own dice (say, poker dice
// with card ranks) pass their own; `pipFace` below draws the classic d6 pips.

// Pips for a classic die, drawn inside the middle of the face (a rounded cube spends the outer fifth of the
// face's texture on its rounded edges).
export function pipFace(label, { size=256, body=['#fffbee', '#ece0c2'], pip='#16110e', one='#a8261a' }={})
{
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, body[0]); grad.addColorStop(1, body[1]);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  // faint grain and wear so the bone isn't flat
  for (let i = 0; i < 260; i++)
  {
    g.fillStyle = `rgba(120,90,40,${Math.random()*.05})`;
    g.fillRect(Math.random()*size, Math.random()*size, 1 + Math.random()*2, 1 + Math.random()*2);
  }
  const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[label] || [];
  const step = size*.2, r = size*.062*(label === 1 ? 1.5 : 1);
  for (const [px, py] of P)
  {
    const x = size/2 + px*step, y = size/2 + py*step;
    g.beginPath(); g.arc(x + r*.1, y + r*.2, r*1.02, 0, Math.PI*2); g.fillStyle = 'rgba(255,255,255,.75)'; g.fill(); // lit lower lip
    const pg = g.createRadialGradient(x - r*.3, y - r*.35, 0, x, y, r);
    if (label === 1) { pg.addColorStop(0, '#d9493a'); pg.addColorStop(1, one); }
    else { pg.addColorStop(0, '#4a4440'); pg.addColorStop(1, pip); }
    g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fillStyle = pg; g.fill();
  }
  return c;
}

export class DiceView
{
  // options: size (matches the table), faceTexture, radius (edge rounding, in dice), segments, material (extra props), anisotropy
  constructor({ THREE, RoundedBoxGeometry, table, faceTexture=pipFace, radius=.13, segments=4, material={}, anisotropy=8 })
  {
    this.THREE = THREE; this.table = table; this.faceTexture = faceTexture;
    this.group = new THREE.Group();
    this.cache = new Map();
    this.materialProps = material; this.anisotropy = anisotropy;
    const s = table.size;
    const geometry = new RoundedBoxGeometry(s, s, s, segments, s*radius);
    this.meshes = table.dice.map(d =>
    {
      const mesh = new THREE.Mesh(geometry, [0, 1, 2, 3, 4, 5].map(() => null));
      mesh.castShadow = true;
      this.group.add(mesh);
      d.mesh = mesh;
      return mesh;
    });
    this.sync();
  }

  materialFor(label)
  {
    let m = this.cache.get(label);
    if (!m)
    {
      const { THREE } = this;
      const src = this.faceTexture(label);
      const map = src.isTexture ? src : new THREE.CanvasTexture(src);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = this.anisotropy;
      m = new THREE.MeshPhysicalMaterial({ map, roughness: .38, metalness: 0, clearcoat: .55, clearcoatRoughness: .25, ...this.materialProps });
      this.cache.set(label, m);
    }
    return m;
  }

  // copy the physics onto the meshes, and re-skin any die whose labels changed
  sync()
  {
    this.table.dice.forEach(({ body, labels, mesh }) =>
    {
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      for (let f = 0; f < 6; f++)
      {
        const m = this.materialFor(labels[f]);
        if (mesh.material[f] !== m) mesh.material[f] = m;
      }
    });
  }
}
