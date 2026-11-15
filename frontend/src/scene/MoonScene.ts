import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  EARTH_RADIUS_KM,
  MOON_RADIUS_KM,
  SUN_ANGULAR_DIAMETER_DEG,
  geometryAt,
  toLatLon,
  toVec,
  type Geometry,
  type LatLon,
} from '../astro/ephemeris';
import type { MoonManifest, RegionId } from '../data/types';
import { EARTH_FRAG, EARTH_VERT, GLOBE_FRAG, GLOBE_VERT, STEREO_FRAG, STEREO_VERT } from './shaders';

/**
 * Vesper's 3D view. Scene units are Moon radii; the Moon sits at the origin in
 * its body-fixed frame (lon 0 -> +X, north -> +Y, east -> -Z). Earth is placed
 * at its true distance and size; the Sun at its true direction and angular size.
 * Renders on demand: nothing is drawn while nothing changes.
 */

export type ViewMode = 'globe' | 'stereo';
export type SceneEvents = {
  onRegion: (id: RegionId) => void;
  onCenter: (c: LatLon) => void;
  /** A click (not a drag) on the lunar surface. */
  onPick?: (c: LatLon) => void;
};

const DEFAULT_FOV = 30;
const SKY_FOV = 18;
const SKY_DIST = 12;
const SUN_DIST = 30_000; // far enough to look infinitely distant; angular size is true
const CORONA_SCALE = 6; // sprite size / solar disk size
const EARTH_R = EARTH_RADIUS_KM / MOON_RADIUS_KM;
// The global 4K mosaic is ~2.7 km/px; closer than about ±6 deg from the pole it
// only shows interpolation. Lower this when a polar DEM/mosaic is loaded.
const STEREO_MIN_HALF = 0.11;
const STEREO_EXIT_HALF = 0.95;
const D2R = Math.PI / 180;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

type Fly = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromDist: number;
  toDist: number;
  fromFov: number;
  toFov: number;
  t0: number;
  dur: number;
};

export class MoonScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  private stereoScene = new THREE.Scene();
  private stereoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private stereo = { pole: 1 as 1 | -1, center: new THREE.Vector2(), half: 0.32, vel: new THREE.Vector2() };

  private shared = {
    uColor: { value: null as THREE.Texture | null },
    uNormal: { value: null as THREE.Texture | null },
    uHasColor: { value: 0 },
    uHasNormal: { value: 0 },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uEarthDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunIntensity: { value: 2.2 },
    uEarthshine: { value: 0.05 },
    uNormalStrength: { value: 1 },
    // Night-side fill (user requirement: dark, but never a black hemisphere)
    uAmbient: { value: 0.11 },
  };
  private stereoUniforms = {
    ...this.shared,
    // Maps read better with gentler relief and a little fill light at low Sun
    uNormalStrength: { value: 0.45 },
    uAmbient: { value: 0.16 },
    uCenter: { value: new THREE.Vector2() },
    uHalfHeight: { value: 0.32 },
    uAspect: { value: 1 },
    uPole: { value: 1 },
    uGrid: { value: 0.22 },
  };

  private earth: THREE.Mesh;
  private earthUniforms = { uSunDir: this.shared.uSunDir, uMap: { value: null as THREE.Texture | null }, uHasMap: { value: 0 } };
  private sun: THREE.Sprite;
  private earthPos = new THREE.Vector3(221, 0, 0);

  mode: ViewMode = 'globe';
  private region: RegionId | null = null;
  private dirty = true;
  private fly: Fly | null = null;
  private raf = 0;
  private lastCenterEmit = 0;
  private overlay: HTMLElement | null = null;
  private bodyLabels: Partial<Record<'earth' | 'sun', HTMLElement>> = {};
  private resizeObs: ResizeObserver;
  private drag: { id: number; x: number; y: number; t: number } | null = null;

  constructor(private host: HTMLElement, private events: SceneEvents, private reducedMotion = false) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'scene-canvas';
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#03040f');
    this.stereoScene.background = new THREE.Color('#03040f');

    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.002, 200_000);
    this.camera.position.fromArray(toVec(6, 8)).multiplyScalar(3.6);

    const c = (this.controls = new OrbitControls(this.camera, this.renderer.domElement));
    c.enableDamping = true;
    c.dampingFactor = 0.07;
    c.enablePan = false;
    c.minDistance = 1.06;
    c.maxDistance = 16;
    c.zoomSpeed = 0.9;
    c.addEventListener('change', () => this.onViewChange());
    c.addEventListener('start', () => (this.fly = null));

    // Moon
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(1, 256, 128),
      new THREE.ShaderMaterial({ uniforms: this.shared, vertexShader: GLOBE_VERT, fragmentShader: GLOBE_FRAG }),
    );
    this.scene.add(moon);

    // Earth, true size; placed and oriented in setSky
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R, 96, 48),
      new THREE.ShaderMaterial({ uniforms: this.earthUniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }),
    );
    this.scene.add(this.earth);

    // Sun: disk at true angular size plus corona
    this.sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeSunTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    const disk = 2 * SUN_DIST * Math.tan((SUN_ANGULAR_DIAMETER_DEG / 2) * D2R);
    this.sun.scale.setScalar(disk * CORONA_SCALE);
    this.scene.add(this.sun);

    this.scene.add(makeStars());

    // Stereographic polar map: a full-screen quad drawn by its shader
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: this.stereoUniforms, vertexShader: STEREO_VERT, fragmentShader: STEREO_FRAG, depthTest: false }),
    );
    quad.frustumCulled = false;
    this.stereoScene.add(quad);

    this.bindStereoInput();
    this.bindPick();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.loop();
  }

  // ---------- data ----------

  async load(manifest: MoonManifest) {
    const loader = new THREE.TextureLoader();
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const prep = (t: THREE.Texture, color: boolean) => {
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      return t;
    };
    const [color, normal, earth] = await Promise.all([
      manifest.color ? loader.loadAsync(manifest.color.url) : null,
      manifest.normal ? loader.loadAsync(manifest.normal.url) : null,
      // The Earth is optional: a missing file keeps the placeholder instead of failing the load
      manifest.earth?.color ? loader.loadAsync(manifest.earth.color.url).catch(() => null) : null,
    ]);
    if (earth) {
      earth.colorSpace = THREE.SRGBColorSpace;
      earth.anisotropy = aniso;
      this.earthUniforms.uMap.value = earth;
      this.earthUniforms.uHasMap.value = 1;
    }
    if (color) {
      this.shared.uColor.value = prep(color, true);
      this.shared.uHasColor.value = 1;
    }
    if (normal) {
      this.shared.uNormal.value = prep(normal, false);
      this.shared.uHasNormal.value = 1;
    }
    this.dirty = true;
  }

  // ---------- time ----------

  /**
   * Places the Sun and Earth from the backend ephemeris (JPL Horizons, Moon frame,
   * already converted to scene axes). `ms` only spins Earth on its axis (visual).
   */
  setSky(ms: number, sunDir: [number, number, number], earthKm: [number, number, number]) {
    const sun = new THREE.Vector3().fromArray(sunDir).normalize();
    this.earthPos.fromArray(earthKm).divideScalar(MOON_RADIUS_KM);
    const earthDir = this.earthPos.clone().normalize();
    this.earthDistanceKm = this.earthPos.length() * MOON_RADIUS_KM;
    this.shared.uSunDir.value.copy(sun);
    this.shared.uEarthDir.value.copy(earthDir);
    // Earthshine follows Earth's phase as seen from the Moon (full Earth at new Moon)
    this.shared.uEarthshine.value = 0.06 * (1 - sun.dot(earthDir)) * 0.5;

    this.earth.position.copy(this.earthPos);
    this.earth.quaternion.setFromRotationMatrix(earthBasis(geometryAt(ms), sun));
    this.sun.position.copy(sun).multiplyScalar(SUN_DIST);
    this.dirty = true;
  }

  earthDistanceKm = 0;

  // ---------- navigation ----------

  setRegion(id: RegionId) {
    if (id === 'stereo-north' || id === 'stereo-south') {
      this.enterStereo(id === 'stereo-north' ? 1 : -1, new THREE.Vector2(0, 0), 0.32);
      return;
    }
    const target: Record<string, LatLon> = {
      nearside: { lat: 0, lon: 0 },
      farside: { lat: 0, lon: 180 },
      north: { lat: 89, lon: 0 },
      south: { lat: -89, lon: 0 },
    };
    const t = target[id];
    this.flyTo(t.lat, t.lon, 3.4, DEFAULT_FOV);
  }

  flyTo(lat: number, lon: number, dist?: number, fov = DEFAULT_FOV) {
    if (this.mode === 'stereo') {
      const pole = this.stereo.pole;
      if (Math.sign(lat) === pole && Math.abs(lat) > 60) {
        // Stay in the polar map and pan to the point
        this.stereo.center.copy(stereoProject(lat, lon, pole));
        this.stereo.half = Math.min(this.stereo.half, 0.16);
        this.syncStereo();
        return;
      }
      this.exitStereo();
    }
    const to = new THREE.Vector3().fromArray(toVec(lat, lon));
    const d = dist ?? Math.min(this.camera.position.length(), 2.2);
    this.startFly(to, d, fov);
  }

  /** Turn the view so Earth or the Sun shows just beyond the Moon's limb. */
  face(body: 'earth' | 'sun') {
    if (this.mode === 'stereo') this.exitStereo();
    const b = body === 'earth' ? this.earthPos.clone() : this.sun.position.clone().normalize().multiplyScalar(1e9);
    const bHat = b.clone().normalize();
    // Offset the camera "up" so the body rises above the limb, in the free
    // centre of the screen (an Earthrise composition), not behind a side panel.
    const u = new THREE.Vector3(0, 1, 0).sub(bHat.clone().multiplyScalar(bHat.y)).normalize();

    const dist = SKY_DIST;
    const want = Math.asin(1 / dist) * 1.28; // body just outside the limb
    const camAt = (a: number) => bHat.clone().multiplyScalar(-Math.cos(a)).add(u.clone().multiplyScalar(Math.sin(a))).multiplyScalar(dist);
    const angleFor = (a: number) => {
      const c = camAt(a);
      return b.clone().sub(c).angleTo(c.clone().negate());
    };
    let lo = 0;
    let hi = 1.4;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (angleFor(mid) < want) lo = mid;
      else hi = mid;
    }
    this.startFly(camAt((lo + hi) / 2).normalize(), dist, SKY_FOV);
  }

  zoomBy(factor: number) {
    if (this.mode === 'stereo') {
      this.zoomStereo(factor, 0, 0);
      return;
    }
    const d = THREE.MathUtils.clamp(this.camera.position.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.startFly(this.camera.position.clone().normalize(), d, this.camera.fov, 220);
  }

  /** Keyboard rotation, in degrees of latitude/longitude of the view centre. */
  rotateBy(dLat: number, dLon: number) {
    if (this.mode === 'stereo') {
      this.stereo.center.add(new THREE.Vector2(dLon, -dLat).multiplyScalar(this.stereo.half * 0.02));
      this.syncStereo();
      return;
    }
    const c = toLatLon(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    const lat = THREE.MathUtils.clamp(c.lat + dLat, -89, 89);
    this.startFly(new THREE.Vector3().fromArray(toVec(lat, c.lon + dLon)), this.camera.position.length(), this.camera.fov, 220);
  }

  private startFly(to: THREE.Vector3, dist: number, fov: number, dur = 1100) {
    const from = this.camera.position.clone().normalize();
    if (this.reducedMotion) dur = 0;
    this.fly = { from, to: to.clone().normalize(), fromDist: this.camera.position.length(), toDist: dist, fromFov: this.camera.fov, toFov: fov, t0: performance.now(), dur };
    this.killInertia();
    this.dirty = true;
  }

  private killInertia() {
    const f = this.controls.dampingFactor;
    this.controls.dampingFactor = 1;
    this.controls.update();
    this.controls.dampingFactor = f;
  }

  // ---------- stereographic mode ----------

  private enterStereo(pole: 1 | -1, center: THREE.Vector2, half: number) {
    this.mode = 'stereo';
    this.fly = null;
    this.controls.enabled = false;
    this.stereo.pole = pole;
    this.stereo.center.copy(center);
    this.stereo.half = half;
    this.stereo.vel.set(0, 0);
    this.syncStereo();
    this.emitRegion(pole > 0 ? 'stereo-north' : 'stereo-south');
  }

  private exitStereo() {
    const pole = this.stereo.pole;
    const c = stereoUnproject(this.stereo.center, pole);
    this.mode = 'globe';
    this.controls.enabled = true;
    const lat = THREE.MathUtils.clamp(c.lat, -88, 88);
    this.camera.position.fromArray(toVec(pole > 0 ? Math.max(lat, 70) : Math.min(lat, -70), c.lon)).multiplyScalar(1.9);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this.onViewChange(true);
  }

  private syncStereo() {
    const s = this.stereo;
    s.half = THREE.MathUtils.clamp(s.half, STEREO_MIN_HALF, 1.0);
    const lim = 2 * Math.tan((35 * D2R) / 2) + s.half; // keep the map in view (to ~55 deg lat)
    s.center.clampLength(0, lim);
    this.stereoUniforms.uCenter.value.copy(s.center);
    this.stereoUniforms.uHalfHeight.value = s.half;
    this.stereoUniforms.uPole.value = s.pole;
    this.dirty = true;
    this.emitCenter(true);
  }

  private zoomStereo(factor: number, sx: number, sy: number) {
    const s = this.stereo;
    const aspect = this.stereoUniforms.uAspect.value;
    const anchor = new THREE.Vector2(s.center.x + sx * aspect * s.half, s.center.y + sy * s.half);
    const next = THREE.MathUtils.clamp(s.half * factor, STEREO_MIN_HALF, 1.0);
    if (factor > 1 && s.half >= STEREO_EXIT_HALF) {
      this.exitStereo();
      return;
    }
    s.center.set(anchor.x - sx * aspect * next, anchor.y - sy * next);
    s.half = next;
    this.syncStereo();
  }

  private bindStereoInput() {
    const el = this.renderer.domElement;
    const toScreen = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
    };
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.mode === 'stereo') {
          e.preventDefault();
          const [sx, sy] = toScreen(e);
          this.zoomStereo(Math.exp(e.deltaY * 0.0015), sx, sy);
          return;
        }
        // Zooming in close over a pole opens its stereographic map
        if (e.deltaY < 0) {
          const p = this.camera.position;
          const c = toLatLon(p.x, p.y, p.z);
          if (Math.abs(c.lat) > 72 && p.length() < 1.32) {
            const pole = c.lat > 0 ? 1 : -1;
            this.enterStereo(pole, stereoProject(c.lat, c.lon, pole), Math.max(0.16, (p.length() - 1) * 1.2));
          }
        }
      },
      { passive: false },
    );
    el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'stereo') return;
      el.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
      this.stereo.vel.set(0, 0);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.mode !== 'stereo' || !this.drag || this.drag.id !== e.pointerId) return;
      const r = el.getBoundingClientRect();
      const k = (2 * this.stereo.half) / r.height;
      const dx = (e.clientX - this.drag.x) * k;
      const dy = (e.clientY - this.drag.y) * k;
      const now = performance.now();
      const dt = Math.max(1, now - this.drag.t);
      this.stereo.center.x -= dx;
      this.stereo.center.y += dy;
      this.stereo.vel.set(-dx / dt, dy / dt);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now };
      this.syncStereo();
    });
    const end = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // ---------- picking ----------

  /** Surface coordinates under a screen position, or null off the Moon. */
  private latLonAt(clientX: number, clientY: number): LatLon | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * 2 - 1;
    const sy = -(((clientY - r.top) / r.height) * 2 - 1);
    if (this.mode === 'stereo') {
      const s = this.stereo;
      const q = new THREE.Vector2(s.center.x + sx * this.stereoUniforms.uAspect.value * s.half, s.center.y + sy * s.half);
      if (q.length() >= 2) return null;
      return stereoUnproject(q, s.pole);
    }
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(sx, sy), this.camera);
    const hit = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
    return hit ? toLatLon(hit.x, hit.y, hit.z) : null;
  }

  private bindPick() {
    const el = this.renderer.domElement;
    let down: { id: number; x: number; y: number; t: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      down = e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
    });
    el.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      // A press that stayed in place is a pick; anything else was a rotation
      if (!d || d.id !== e.pointerId || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.t > 500) return;
      const c = this.latLonAt(e.clientX, e.clientY);
      if (c) this.events.onPick?.(c);
    });
    el.addEventListener('pointercancel', () => (down = null));
  }

  // ---------- overlays (HTML markers and labels) ----------

  /** Children with data-lat / data-lon are positioned over the Moon every frame. */
  setOverlay(el: HTMLElement | null) {
    this.overlay = el;
    this.dirty = true;
  }

  setBodyLabel(body: 'earth' | 'sun', el: HTMLElement | null) {
    if (el) this.bodyLabels[body] = el;
    else delete this.bodyLabels[body];
    this.dirty = true;
  }

  requestRender() {
    this.dirty = true;
  }

  private updateOverlays() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const camPos = this.camera.position;
    const v = new THREE.Vector3();

    if (this.overlay) {
      const placed: { node: HTMLElement; x: number; y: number; prio: number }[] = [];
      for (const node of Array.from(this.overlay.children) as HTMLElement[]) {
        const lat = Number(node.dataset.lat);
        const lon = Number(node.dataset.lon);
        let x = 0;
        let y = 0;
        let visible = false;
        if (this.mode === 'globe') {
          v.fromArray(toVec(lat, lon));
          const facing = v.dot(camPos.clone().sub(v)) > 0;
          v.project(this.camera);
          visible = facing && v.z < 1;
          x = (v.x * 0.5 + 0.5) * w;
          y = (-v.y * 0.5 + 0.5) * h;
        } else {
          const s = this.stereo;
          if (Math.sign(lat) === s.pole || Math.abs(lat) < 1e-6) {
            const q = stereoProject(lat, lon, s.pole);
            const aspect = this.stereoUniforms.uAspect.value;
            const sx = (q.x - s.center.x) / (aspect * s.half);
            const sy = (q.y - s.center.y) / s.half;
            visible = Math.abs(sx) < 1.2 && Math.abs(sy) < 1.2 && q.length() < 2;
            x = (sx * 0.5 + 0.5) * w;
            y = (-sy * 0.5 + 0.5) * h;
          }
        }
        node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        node.dataset.visible = visible ? 'true' : 'false';
        if (visible) placed.push({ node, x, y, prio: node.dataset.selected === 'true' ? 3 : node.matches(':hover, :focus-visible') ? 2 : node.dataset.kind === 'reco' ? 1 : 0 });
      }
      // Declutter: keep a label only if it doesn't overlap one already kept
      // (selected, hovered, then recommended sites first); the dot always stays.
      placed.sort((a, b) => b.prio - a.prio);
      const kept: { l: number; r: number; t: number; b: number }[] = [];
      for (const m of placed) {
        const label = m.node.querySelector<HTMLElement>('.marker-label');
        const w = (label?.offsetWidth ?? 80) + 28;
        const box = { l: m.x - 12, r: m.x - 12 + w, t: m.y - 12, b: m.y + 12 };
        const clash = kept.some((k) => box.l < k.r && box.r > k.l && box.t < k.b && box.b > k.t);
        m.node.dataset.label = clash ? 'hidden' : 'shown';
        if (!clash) kept.push(box);
      }
    }

    for (const [body, el] of Object.entries(this.bodyLabels) as ['earth' | 'sun', HTMLElement][]) {
      const p = body === 'earth' ? this.earthPos : this.sun.position;
      v.copy(p).project(this.camera);
      const onScreen = this.mode === 'globe' && v.z < 1 && Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.95;
      const hidden = onScreen && rayHitsMoon(camPos, p);
      const r = body === 'earth' ? EARTH_R : 0;
      const off = r > 0 ? this.pixelRadius(p, r) : 18;
      el.style.transform = `translate3d(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h + off + 10).toFixed(1)}px, 0)`;
      el.dataset.visible = onScreen && !hidden ? 'true' : 'false';
    }
  }

  private pixelRadius(p: THREE.Vector3, r: number) {
    const d = p.distanceTo(this.camera.position);
    return (r / (d * Math.tan((this.camera.fov * D2R) / 2))) * (this.host.clientHeight / 2);
  }

  // ---------- loop ----------

  private onViewChange(force = false) {
    this.dirty = true;
    if (this.mode !== 'globe') return;
    const p = this.camera.position;
    const c = toLatLon(p.x, p.y, p.z);
    const id: RegionId = c.lat > 55 ? 'north' : c.lat < -55 ? 'south' : Math.abs(c.lon) <= 90 ? 'nearside' : 'farside';
    this.emitRegion(id, force);
    this.emitCenter(force);
  }

  private emitRegion(id: RegionId, force = false) {
    if (id === this.region && !force) return;
    this.region = id;
    this.events.onRegion(id);
  }

  private emitCenter(force = false) {
    const now = performance.now();
    if (!force && now - this.lastCenterEmit < 120) return;
    this.lastCenterEmit = now;
    if (this.mode === 'globe') {
      const p = this.camera.position;
      this.events.onCenter(toLatLon(p.x, p.y, p.z));
    } else {
      this.events.onCenter(stereoUnproject(this.stereo.center, this.stereo.pole));
    }
  }

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.stereoUniforms.uAspect.value = w / h;
    this.dirty = true;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();

    if (this.fly) {
      const f = this.fly;
      const t = f.dur <= 0 ? 1 : Math.min(1, (now - f.t0) / f.dur);
      const k = easeInOut(t);
      const q = new THREE.Quaternion().setFromUnitVectors(f.from, f.to);
      const dir = f.from.clone().applyQuaternion(new THREE.Quaternion().slerp(q, k));
      this.camera.position.copy(dir).multiplyScalar(THREE.MathUtils.lerp(f.fromDist, f.toDist, k));
      this.camera.fov = THREE.MathUtils.lerp(f.fromFov, f.toFov, k);
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(0, 0, 0);
      this.onViewChange();
      if (t >= 1) {
        this.fly = null;
        this.controls.update();
        this.emitCenter(true);
      }
    } else if (this.mode === 'globe') {
      // Slower rotation close to the surface
      this.controls.rotateSpeed = THREE.MathUtils.clamp((this.camera.position.length() - 1) * 0.45, 0.04, 0.6);
      this.controls.update();
    } else if (!this.drag && this.stereo.vel.lengthSq() > 1e-12) {
      // Stereographic pan inertia
      this.stereo.center.addScaledVector(this.stereo.vel, 16);
      this.stereo.vel.multiplyScalar(this.reducedMotion ? 0 : 0.9);
      this.syncStereo();
    }

    if (!this.dirty) return;
    this.dirty = false;
    if (this.mode === 'globe') this.renderer.render(this.scene, this.camera);
    else this.renderer.render(this.stereoScene, this.stereoCam);
    this.updateOverlays();
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// ---------- helpers ----------

/** Polar stereographic projection of a unit sphere, r = 2 tan(c/2). */
export function stereoProject(lat: number, lon: number, pole: 1 | -1) {
  const c = (90 - pole * lat) * D2R;
  const r = 2 * Math.tan(c / 2);
  const l = lon * D2R;
  return pole > 0 ? new THREE.Vector2(r * Math.sin(l), -r * Math.cos(l)) : new THREE.Vector2(r * Math.sin(l), r * Math.cos(l));
}

export function stereoUnproject(q: THREE.Vector2, pole: 1 | -1): LatLon {
  const r = q.length();
  const c = 2 * Math.atan(r / 2);
  const lat = pole * (90 - c / D2R);
  const lon = (pole > 0 ? Math.atan2(q.x, -q.y) : Math.atan2(q.x, q.y)) / D2R;
  return { lat, lon };
}

function rayHitsMoon(from: THREE.Vector3, to: THREE.Vector3) {
  const d = to.clone().sub(from);
  const len = d.length();
  d.divideScalar(len);
  const t = -from.dot(d);
  if (t < 0 || t > len) return false;
  return from.clone().addScaledVector(d, t).length() < 1;
}

/**
 * Earth's orientation in the Moon frame (visual only). The lunar equator is
 * within 1.5 deg of the ecliptic, so ecliptic longitudes are measured from the
 * backend Sun direction; the pole is then tilted and the spin fixed so the
 * scene's Sun falls exactly on Earth's sub-solar point (Sun right ascension
 * and Greenwich sidereal time). Day and night on Earth match the Moon's light.
 */
function earthBasis(g: Geometry, sunDir: THREE.Vector3) {
  const north = new THREE.Vector3(0, 1, 0);
  const sunEcl = sunDir.clone().sub(north.clone().multiplyScalar(sunDir.dot(north))).normalize();
  // Ecliptic longitude 90 deg, measured from the Sun's (sunEclLon), eastward about north
  const lon90 = sunEcl.clone().applyAxisAngle(north, (90 - g.sunEclLon) * D2R);
  const pole = north.clone().multiplyScalar(Math.sin((90 - 23.4393) * D2R)).add(lon90.multiplyScalar(Math.cos((90 - 23.4393) * D2R))).normalize();
  const sun = sunDir.clone();
  // Tilt the pole within the pole-Sun plane so the solar declination is exact
  const axis = pole.clone().cross(sun).normalize();
  const want = (90 - g.earthSubSolar.lat) * D2R;
  pole.applyAxisAngle(axis, pole.angleTo(sun) - want).normalize();
  const sunEq = sun.sub(pole.clone().multiplyScalar(sun.dot(pole))).normalize();
  // Greenwich lies `earthSubSolar.lon` degrees west of the Sun's meridian
  const gw = sunEq.applyAxisAngle(pole, -g.earthSubSolar.lon * D2R).normalize();
  const z = gw.clone().cross(pole);
  return new THREE.Matrix4().makeBasis(gw, pole, z);
}

function makeSunTexture() {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const c = size / 2;
  const disk = c / CORONA_SCALE;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,250,235,1)');
  g.addColorStop((disk / c) * 0.92, 'rgba(255,246,225,1)');
  g.addColorStop(disk / c, 'rgba(255,224,170,0.55)');
  g.addColorStop(0.32, 'rgba(255,205,140,0.14)');
  g.addColorStop(0.62, 'rgba(255,190,120,0.04)');
  g.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeStars() {
  const N = 2600;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos.set([r * Math.cos(a) * 90000, u * 90000, r * Math.sin(a) * 90000], i * 3);
    const b = 0.25 + rand() ** 3 * 0.75;
    const warm = rand();
    col.set([b * (0.9 + warm * 0.1), b * 0.92, b * (1.0 - warm * 0.12)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
}
