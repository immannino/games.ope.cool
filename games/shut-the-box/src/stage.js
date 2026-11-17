// The 3D layer: a transparent three.js canvas laid over the painted table. A camera looks straight down at the
// felt with a narrow lens, so a world unit on the felt is a fixed number of screen pixels. Dice and tiles are
// real meshes; everything else on the table stays in the painted 2D layer underneath.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export { THREE, RoundedBoxGeometry };

const FOV = 24;

export class Stage
{
  constructor()
  {
    const r = this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);
    Object.assign(r.domElement.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', zIndex: '2' });
    document.body.append(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, .1, 400);
    this.camera.up.set(0, 0, -1);

    // light from the upper left, a soft fill from the room, and a warm lamp over the middle
    const hemi = new THREE.HemisphereLight(0xfff0dc, 0x2a1a0c, 1.25);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1de, 3.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -.0004;
    sun.shadow.normalBias = .02;
    sun.shadow.radius = 5;
    this.scene.add(hemi, sun, sun.target);

    // the felt catches shadows but draws nothing itself
    const catcher = this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: .55 }));
    catcher.rotation.x = -Math.PI/2;
    catcher.receiveShadow = true;
    this.scene.add(catcher);

    // faint environment so the lacquer on the dice has something to reflect
    const pm = new THREE.PMREMGenerator(r);
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ color: 0x6a5a48, side: THREE.BackSide })));
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0xfff4e0 }));
    lamp.position.set(-3, 7, -2); lamp.lookAt(0, 0, 0);
    env.add(lamp);
    this.scene.environment = pm.fromScene(env, .04).texture;
    this.scene.environmentIntensity = .55;
    pm.dispose();

    this.W = 1; this.H = 1; this.ppu = 100;
  }

  // ppu: screen pixels per world unit on the felt. Call whenever the window or layout changes.
  resize(W, H, ppu)
  {
    this.W = W; this.H = H; this.ppu = ppu;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(W, H, false);
    Object.assign(this.renderer.domElement.style, { width: W + 'px', height: H + 'px' });
    this.camY = (H/2/ppu)/Math.tan(FOV*Math.PI/360);
    const c = this.camera;
    c.aspect = W/H; c.fov = FOV; c.updateProjectionMatrix();
    c.position.set(0, this.camY, 0); c.lookAt(0, 0, 0);
    const reach = Math.max(W, H)/ppu*.62;
    const s = this.sun;
    s.position.set(-.55*reach, 1.5*reach, -.45*reach);
    s.shadow.camera.left = -W/ppu/2 - 1; s.shadow.camera.right = W/ppu/2 + 1;
    s.shadow.camera.top = H/ppu/2 + 1; s.shadow.camera.bottom = -H/ppu/2 - 1;
    s.shadow.camera.near = .5; s.shadow.camera.far = reach*5;
    s.shadow.camera.updateProjectionMatrix();
  }

  // screen px <-> felt-plane world units, optionally at a height above the felt
  toWorld(px, py, h=0)
  {
    const k = (this.camY - h)/this.camY;
    return { x: (px - this.W/2)/this.ppu*k, z: (py - this.H/2)/this.ppu*k };
  }
  toScreen(x, z) { return { x: this.W/2 + x*this.ppu, y: this.H/2 + z*this.ppu }; }

  render() { this.renderer.render(this.scene, this.camera); }
}
