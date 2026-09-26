// dots.js — the particle engine behind every scene.
//
// One particle set reshapes as the page scrolls: floor, sphere, grid, wave,
// torus and point. Each shape is evaluated in screen space every frame (its
// own centre, scale and rotation); a morph mixes two shapes per particle with
// a hashed stagger, and particles in transit leave streaks.
// Contract: SPEC.md, "dots.js — particle engine". Listens on window for
// scene:progress, scene:change, motion:change, resize, pointermove,
// pointerdown/up, visibilitychange, floor:ripple and floor:contact; emits
// dots:readout {shape, rot, count, rotLabel}; exposes window.dotsFloor.
//
// floor — a perspective plane of dots that behaves like an elastic mesh.
//
//   World coordinates (shared by every floor section): x to the right, y up,
//   z along the floor away from the viewer, measured from the floor point
//   right under the camera. One world unit is one CSS pixel at camera depth
//   f, i.e. the z = 0 plane of a CSS scene with `perspective: f px`. The
//   camera sits at (0, height, 0), tilted down by `pitch`:
//     yc = (y - height) cos(pitch) + z sin(pitch)     camera up
//     zc = z cos(pitch) - (y - height) sin(pitch)     camera depth
//     sx = cx + f x / zc,   sy = cy - f yc / zc      viewport px
//   so the horizon is the row sy = cy - f tan(pitch).
//
//   Section attributes (all optional):
//     data-floor-horizon  horizon row, share of the viewport height (.36)
//     data-floor-pitch    camera tilt below the horizontal, degrees (12)
//     data-floor-lens     focal length f, x min(vh, 1.15 vw) (1.25)
//     data-floor-dot      dot size multiplier (1)
//     data-floor-scale    dot spacing multiplier; the first floor section's
//                         value sets the shared lattice (1)
//     data-floor-follow   the floor lifts with an element's top edge once it
//                         passes the viewport top: empty = the section
//                         itself, else a selector (a sticky stage, say);
//                         default: fixed to the viewport
//     data-dots-alpha     dots layer alpha here (phones default to .45)
//
//   Events in:
//     floor:ripple  {x, y, strength = 1, r?}  an impact at a viewport point
//                   (r = impactor radius, px); also rings the flat grid
//     floor:contact {id, x, y, r, depth?}      a resting dimple under a ball
//                   touching the floor at (x, y) (r = contact radius px,
//                   depth px, default .8 r); send again to move it
//     floor:contact {id, off: true}           lifts it
//   window.dotsFloor: camera(el?), toScreen(x, z, y?, el?, out?),
//   toFloor(sx, sy, el?, out?), heightAt(x, z), cssMatrix(x, z, opts?),
//   refresh(). See the API block near the end.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const GOLDEN = 137.508 * DEG;

// Colour tones. Mixed tones reproduce the dark-red fringe the reference shows
// where a hot dot cools back to the base colour.
const T_BASE = 0, T_MIX1 = 1, T_MIX2 = 2, T_HI = 3, T_ALT = 4;
const TONES = 5;
const TONE_ORDER = [T_BASE, T_MIX1, T_MIX2, T_ALT, T_HI]; // hi paints last
const LEVELS = 5;
const LEVEL_ALPHA = [1, 0.8, 0.6, 0.42, 0.26];
const BUCKETS = TONES * LEVELS;
const STREAK_R = [1.4, 2.4, 4.2]; // representative dot radius per streak width class

const NMAX = 1400;
const STAGGER = 0.35;
const SPAN = 1 - STAGGER;
const POSE_TIME = 3.4; // frozen clock for reduced motion: a flattering pose
// scenes.js morph window, in viewport heights from the centre line
const MORPH_START = 0.55, MORPH_SPAN = 0.6;

// Floor budget. Particles take the nearest mesh nodes; up to XMAX further
// mesh dots are drawn only while the floor shows (they fade during morphs);
// past them a cached far field of dot rows runs on to the horizon. Every
// screen size gets the full XMAX (scaled only by adaptive frame-rate drops):
// phones have fewer particles but need the reactive mesh to reach as far up
// the screen, where the ball lands.
const EXTRA_K = 1.25;
const XMAX = Math.ceil(NMAX * EXTRA_K);
const DMAX = Math.max(NMAX, XMAX);
const SMAX = 7200;   // simulated nodes: the mesh plus its absorbing margin
const RMAX = 480;    // lattice rows
const FCAM_MAX = 8;  // floor sections whose views the lattice covers
const PATCH = 13;    // an impact or contact touches at most PATCH x PATCH nodes

const FLOOR = {
  horizon: 0.36, pitch: 12, lens: 1.25,
  height: 0.32,      // camera height, x f
  near: 0.042,       // dot spacing along the bottom edge, x vw ...
  nearMin: 28, nearMax: 64, // ... clamped, px
  dot: 0.085,        // dot radius, x lattice pitch
  gap: 0.012,        // the far field stops this far below the horizon, x vh
};

// Membrane, in lattice cells (one cell = one pitch). Tuned for taut fabric:
// a clear dent, a trough ring then a crest ring, settled in about 1.2 s.
const SIM = {
  dt: 1 / 240, maxSteps: 12,
  c2: 34 * 34,     // wave speed squared, cells^2/s^2
  k: 60,           // pull back to rest, 1/s^2
  g0: 3,           // damping, 1/s
  gs: 34,          // extra damping across the absorbing margin
  margin: 5,       // absorbing margin, cells
  nu: 0.35,        // viscosity: damps the finest ripples first
  impT: 0.06,      // impact pulse length, s
  impA: 900,       // impact push, cells/s^2 per unit strength
  impSig: 1.6,     // impact footprint, cells
  kc: 9000, cc: 110, // contact spring (stiffer than the fabric) and its damping
  ptrDepth: 0.8, ptrSig: 1.3, // pointer dimple, cells
  hot: 0.28,       // heat above which a floor dot turns accent (flat: no mixed tones)
  heatTau: 0.28,   // colour memory, s
  heatV: 0.13, heatV0: 0.06, heatU: 2, // colour from speed (past a dead zone) and crest height
  // Each impact's colour travels out as a ring: behind its front (moving at
  // frontC of the wave speed from the footprint's edge), more than frontW
  // cells back, the fabric still rings and dents but no longer heats, and
  // what heat it had cools over frontCool. Newer fronts' bands win.
  frontC: 0.9, frontW: 5, frontCool: 0.07, frontT: 2.2, frontMin: 0.3,
  sleepV: 0.006,   // cells/s: below this everywhere the mesh sleeps
};

// Desktop layout defaults per scene (SPEC table); section data-dots-* wins.
const LAYOUT = {
  sphere: { x: 0.76, y: 0.5, scale: 0.32 },
  grid: { x: 0.5, y: 0.5, scale: 0.5 },
  wave: { x: 0.5, y: 0.5, scale: 0.5 },
  torus: { x: 0.76, y: 0.52, scale: 0.3 },
  point: { x: 0.5, y: 0.5, scale: 0.02 },
};
const LATTICE_SHAPES = { grid: 1, wave: 1 };
// Wide, flat shapes pair row band to row band instead of by angle.
const FLAT_SHAPES = { grid: 1, wave: 1, floor: 1 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const levelOf = (a) => (a > 0.9 ? 0 : a > 0.7 ? 1 : a > 0.5 ? 2 : a > 0.33 ? 3 : 4);

function hash01(i) {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBuf(n) {
  return {
    x: new Float32Array(n), y: new Float32Array(n), r: new Float32Array(n),
    a: new Float32Array(n), t: new Uint8Array(n),
  };
}

function makeCam() {
  return { el: null, f: 1, th: 0, ct: 1, st: 0, hc: 1, cx: 0, cy: 0, hy: 0, hy0: 0, shift: 0, dot: 1 };
}

// An impact or contact footprint: the nodes it touches and their weights.
function makePatch() {
  return { on: false, cnt: 0, idx: new Int32Array(PATCH * PATCH), w: new Float32Array(PATCH * PATCH) };
}

const heatTone = (h) => (h > 0.4 ? T_HI : h > 0.24 ? T_MIX2 : h > 0.1 ? T_MIX1 : T_BASE);

// Floor dots fade with their on-screen spacing, so the plane recedes.
const floorAlpha = (sp) => 0.3 + 0.7 * smoothstep(2.5, 34, sp);

// Rotate model points (Z, then Y, then X), perspective-project around the
// layout centre, and write depth-scaled size and alpha. vis 0 parks a point.
function projectModel(out, n, mx, my, mz, tones, vis, L, ax, ay, az, D, rBase) {
  const cax = Math.cos(ax), sax = Math.sin(ax), cay = Math.cos(ay), say = Math.sin(ay);
  const caz = Math.cos(az), saz = Math.sin(az);
  const s = L.s, cx = L.cx, cy = L.cy;
  for (let i = 0; i < n; i++) {
    const x = mx[i] * caz - my[i] * saz, y = mx[i] * saz + my[i] * caz, z = mz[i];
    const x1 = x * cay + z * say, z1 = z * cay - x * say;
    const y2 = y * cax - z1 * sax, z2 = y * sax + z1 * cax;
    const f = D / (D - z2);
    const d = clamp01((z2 + 1) * 0.5);
    out.x[i] = cx + x1 * f * s;
    out.y[i] = cy - y2 * f * s;
    out.r[i] = rBase * f * (0.72 + 0.28 * d);
    out.a[i] = vis[i] ? 0.3 + 0.7 * d * d : 0;
    out.t[i] = tones[i];
  }
}

// Order points by angle around a centre in equal-count sectors, then by
// radius inside each sector. Two sets ordered this way pair up without
// criss-crossing: the k-th point of one goes to the k-th of the other.
function orderByKey(xs, ys, cx, cy, n, out, ang, rad) {
  const idx = new Array(n);
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx, dy = ys[i] - cy;
    ang[i] = Math.atan2(dy, dx);
    rad[i] = dx * dx + dy * dy;
    idx[i] = i;
  }
  idx.sort((a, b) => ang[a] - ang[b]);
  const sectors = Math.max(1, Math.round(Math.sqrt(n) * 0.5));
  const size = Math.ceil(n / sectors);
  for (let c = 0; c < n; c += size) {
    const sub = idx.slice(c, Math.min(n, c + size)).sort((a, b) => rad[a] - rad[b]);
    for (let k = 0; k < sub.length; k++) out[c + k] = sub[k];
  }
}

// Order points top to bottom in equal-count bands, then left to right in
// each band: a floor's far rows meet a grid's top rows, and so on.
function orderByBands(xs, ys, n, out) {
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => ys[a] - ys[b]);
  const bands = Math.max(1, Math.round(Math.sqrt(n / 1.8)));
  const size = Math.ceil(n / bands);
  for (let c = 0; c < n; c += size) {
    const sub = idx.slice(c, Math.min(n, c + size)).sort((a, b) => xs[a] - xs[b]);
    for (let k = 0; k < sub.length; k++) out[c + k] = sub[k];
  }
}

function parseColor(ctx, str, fallback) {
  const s = (str || '').trim();
  if (!s) return fallback;
  ctx.fillStyle = '#000';
  ctx.fillStyle = s;
  const v = String(ctx.fillStyle);
  if (v[0] === '#' && v.length === 7) {
    return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  }
  const m = v.match(/[\d.]+/g);
  return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : fallback;
}

const rgb = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function init(opts = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  let canvas = opts.canvas || document.getElementById('dots');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'dots';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
  }
  if (canvas.__dots) return canvas.__dots;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (getComputedStyle(canvas).position === 'static') {
    Object.assign(canvas.style, {
      position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '0',
    });
  }

  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = typeof opts.reduced === 'boolean' ? opts.reduced : !!(mq && mq.matches);

  // ---------------------------------------------------------------- state
  let W = 0, H = 0, dpr = 1;
  let N = 0, adaptScale = 1, drops = 0;
  let time = 0, last = 0, raf = 0, alive = true;

  const X = new Float32Array(NMAX), Y = new Float32Array(NMAX);
  const R = new Float32Array(NMAX), A = new Float32Array(NMAX);
  const T = new Uint8Array(NMAX), TJ = new Float32Array(NMAX);
  const PX = new Float32Array(NMAX), PY = new Float32Array(NMAX);
  const jitter = new Float32Array(NMAX), delay = new Float32Array(NMAX);
  for (let i = 0; i < NMAX; i++) delay[i] = jitter[i] = hash01(i + 17);
  const bufA = makeBuf(NMAX), bufB = makeBuf(NMAX), bufX = makeBuf(XMAX);
  let asA = new Int32Array(NMAX), asB = new Int32Array(NMAX);
  let poolA = new Int32Array(NMAX), poolB = new Int32Array(NMAX);
  const keyAng = new Float64Array(NMAX), keyRad = new Float64Array(NMAX);
  const ordSrc = new Int32Array(NMAX), ordDst = new Int32Array(NMAX);

  // draw scratch
  const bucketOf = new Uint8Array(DMAX), order = new Int32Array(DMAX);
  const bCount = new Int32Array(BUCKETS), bStart = new Int32Array(BUCKETS), bFill = new Int32Array(BUCKETS);
  const sCount = new Int32Array(TONES * 3), sStart = new Int32Array(TONES * 3), sFill = new Int32Array(TONES * 3);
  const sOrder = new Int32Array(NMAX);
  const streakOf = new Uint8Array(NMAX);

  const toneStr = ['#151517', '#6b2a22', '#a83a2a', '#E5432F', '#3340E6'];

  // Scene state. "from"/"to" name the shapes, *El the sections; blendS is
  // the smoothed blend actually drawn.
  const scene = { from: 'floor', to: 'floor', fromEl: null, toEl: null, blend: 0 };
  let blendS = 0;
  let held = { from: '', to: '', fromEl: null, toEl: null }; // what asA/asB describe
  let sawProgress = false, domDirty = false;

  // reduced-motion crossfade
  const rx = { cur: '', curEl: null, prev: '', prevEl: null, f: 1 };

  const pointer = { x: -1e4, y: -1e4, at: -1e9, touch: false, inView: false, down: false };
  const focus = { x: 0, y: 0, init: false };
  let resizeAt = 0, needResize = true, needColors = true, needFloor = false;
  const frameLog = new Float32Array(256), frameSort = new Float32Array(256);
  let fpsT0 = 0, fpsPrev = 0, fpsN = 0, fpsLow = 0, fpsWarm = 0, fpsLast = 60;
  let adaptTrial = null, adaptLocked = false, adaptRecovered = false, adaptGoodMs = 0, pendingN = 0;
  let readoutAt = 0, lastReadout = '';

  // Layouts. Floor layouts also carry a camera and their far mesh dots.
  const LA = { cx: 0, cy: 0, s: 1, ar: 0, cam: makeCam(), ex: makeBuf(XMAX), nx: 0 };
  const LB = { cx: 0, cy: 0, s: 1, ar: 0, cam: makeCam(), ex: makeBuf(XMAX), nx: 0 };
  const LTMP = { cx: 0, cy: 0, s: 1, ar: 0, cam: makeCam(), ex: null, nx: 0 };

  // ------------------------------------------------------------ lattice
  // The grid and the wave share one lattice so the wave is literally the
  // grid tilted into 3D; particle k sits on cell k in both.
  const lat = {
    p: 30, cols: 1, rows: 1, M: 1, x0: 0, y0: 0,
    heat: new Float32Array(NMAX), cell: new Int32Array(NMAX),
  };

  function buildLattice() {
    let p = 30, cols = 1, rows = 1;
    for (let guard = 0; guard < 80; guard++) {
      cols = Math.floor(W / p) + 1;
      rows = Math.floor(H / p) + 1;
      if (cols * rows <= N) break;
      p *= 1.03;
    }
    if (cols !== lat.cols || rows !== lat.rows) lat.heat.fill(0);
    lat.p = p; lat.cols = cols; lat.rows = rows; lat.M = cols * rows;
    lat.x0 = (W - (cols - 1) * p) / 2;
    lat.y0 = (H - (rows - 1) * p) / 2;
    for (let k = 0; k < N; k++) lat.cell[k] = k < lat.M ? k : ((k - lat.M) * 7919) % lat.M;
  }

  // ------------------------------------------------------------- shapes
  const shapes = {};

  // sphere — Fibonacci sphere with a tilted hi band that rides the rotation.
  shapes.sphere = (() => {
    const mx = new Float32Array(NMAX), my = new Float32Array(NMAX), mz = new Float32Array(NMAX);
    const tones = new Uint8Array(NMAX), vis = new Uint8Array(NMAX);
    const nx = 0.26, ny = 0.95, nz = 0.17; // band normal (unit-ish)
    return {
      build() {
        for (let i = 0; i < N; i++) {
          const y = 1 - (2 * (i + 0.5)) / N, rr = Math.sqrt(1 - y * y), th = i * GOLDEN;
          mx[i] = Math.cos(th) * rr; my[i] = y; mz[i] = Math.sin(th) * rr;
          const d = mx[i] * nx + my[i] * ny + mz[i] * nz;
          tones[i] = Math.abs(d - 0.22) < 0.05 ? T_HI : T_BASE;
          vis[i] = 1;
        }
      },
      rot: (t) => t * 0.38,
      eval(out, L, t) {
        const r = Math.max(1.3, Math.min(3.4, L.s * 0.0092));
        projectModel(out, N, mx, my, mz, tones, vis, L, 0.3, t * 0.38, 0, 4, r);
      },
    };
  })();

  // grid — flat screen lattice with signals, ripples and pointer swell.
  const signals = [0, 1, 2].map(() => ({ alive: false, wait: 0, c: 0, r: 0, dc: 1, dr: 0, prog: 0, run: 0, speed: 30 }));
  const ripples = [0, 1, 2, 3].map(() => ({ on: false, x: 0, y: 0, age: 0, str: 1 }));
  let rippleTimer = 1.6;
  const simRand = rng(20260925);

  function spawnSignal(s) {
    const { cols, rows } = lat;
    const edge = simRand() < 0.65;
    if (edge) {
      const side = (simRand() * 4) | 0;
      if (side === 0) { s.c = (simRand() * cols) | 0; s.r = -1; s.dc = 0; s.dr = 1; }
      else if (side === 1) { s.c = (simRand() * cols) | 0; s.r = rows; s.dc = 0; s.dr = -1; }
      else if (side === 2) { s.c = -1; s.r = (simRand() * rows) | 0; s.dc = 1; s.dr = 0; }
      else { s.c = cols; s.r = (simRand() * rows) | 0; s.dc = -1; s.dr = 0; }
    } else {
      s.c = (simRand() * cols) | 0; s.r = (simRand() * rows) | 0;
      const d = (simRand() * 4) | 0;
      s.dc = d === 0 ? 1 : d === 1 ? -1 : 0; s.dr = d === 2 ? 1 : d === 3 ? -1 : 0;
    }
    s.alive = true; s.prog = 0; s.run = 10 + ((simRand() * 16) | 0); s.speed = 44 + simRand() * 20;
  }

  function stampHeat(c, r, v) {
    if (c < 0 || r < 0 || c >= lat.cols || r >= lat.rows) return;
    const i = r * lat.cols + c;
    if (lat.heat[i] < v) lat.heat[i] = v;
  }

  function stepSignal(s) {
    s.c += s.dc; s.r += s.dr; s.run--;
    const { cols, rows } = lat;
    if (s.c < -1 || s.r < -1 || s.c > cols || s.r > rows) { s.alive = false; s.wait = 0.2 + simRand() * 1.1; return; }
    const pc = -s.dr, pr = s.dc; // the band is two cells wide with a cooler fringe
    stampHeat(s.c, s.r, 1); stampHeat(s.c + pc, s.r + pr, 0.95);
    stampHeat(s.c - pc, s.r - pr, 0.34); stampHeat(s.c + 2 * pc, s.r + 2 * pr, 0.34);
    if (s.run <= 0) {
      const turn = simRand() < 0.5 ? 1 : -1;
      const dc = -s.dr * turn, dr = s.dc * turn;
      s.dc = dc; s.dr = dr; s.run = 4 + ((simRand() * 13) | 0);
    }
  }

  function spawnRipple(x, y, str) {
    let slot = ripples[0];
    for (const rp of ripples) { if (!rp.on) { slot = rp; break; } if (rp.age > slot.age) slot = rp; }
    slot.on = true; slot.x = x; slot.y = y; slot.age = 0; slot.str = clamp(str, 0.2, 1.6);
  }

  function simGrid(dt) {
    const dec = dt / 0.8, heat = lat.heat, M = lat.M;
    for (let i = 0; i < M; i++) heat[i] = heat[i] > dec ? heat[i] - dec : 0;
    for (const s of signals) {
      if (!s.alive) { s.wait -= dt; if (s.wait <= 0) spawnSignal(s); continue; }
      s.prog += s.speed * dt;
      while (s.prog >= 1 && s.alive) { s.prog -= 1; stepSignal(s); }
    }
    rippleTimer -= dt;
    if (rippleTimer <= 0) {
      spawnRipple(W * (0.2 + simRand() * 0.6), H * (0.2 + simRand() * 0.6), 1);
      rippleTimer = 3.4 + simRand() * 1.4;
    }
    for (const rp of ripples) if (rp.on && (rp.age += dt) > 1.2) rp.on = false;
  }

  function gridRadius() { return 1.6 * Math.sqrt(Math.max(1, Math.min(1.7, lat.p / 30))); }

  shapes.grid = {
    build() {},
    rot: () => {
      const s = signals[0];
      return Math.atan2(s.dr, s.dc);
    },
    eval(out, L, t, still) {
      const { cols, p, x0, y0, M, heat, cell } = lat;
      const rb = gridRadius(), rMax = rb * 2.8;
      const px = pointer.x, py = pointer.y;
      const swell = !still && performance.now() - pointer.at < 6000;
      let nRip = 0;
      if (!still) for (let q = 0; q < ripples.length; q++) if (ripples[q].on) nRip++;
      for (let k = 0; k < N; k++) {
        const c = cell[k], col = c % cols, row = (c - col) / cols;
        let x = x0 + col * p, y = y0 + row * p;
        let h = still ? 0 : heat[c];
        if (nRip) {
          for (let q = 0; q < ripples.length; q++) {
            const rp = ripples[q];
            if (!rp.on) continue;
            const dx = x - rp.x, dy = y - rp.y, dx2 = dx * dx, dy2 = dy * dy;
            const d = Math.sqrt(Math.sqrt(dx2 * dx2 + dy2 * dy2)) + 1e-3;
            const front = rp.age * 900, off = d - front;
            const e = off > 0 ? 1 - off / 18 : 1 + off / 34;
            if (e <= 0) continue;
            const fade = 1 - rp.age / 1.2, v = e * fade * rp.str;
            if (v > h) h = v;
            const push = 5 * v / d;
            x += dx * push; y += dy * push;
          }
        }
        let r = rb + (rMax - rb) * Math.pow(Math.min(1.2, h), 0.85);
        if (swell) {
          const dx = x - px, dy = y - py, d2 = dx * dx + dy * dy;
          if (d2 < 12100) { const q = 1 - Math.sqrt(d2) / 110; r += 1.5 * q * q; }
        }
        out.x[k] = x; out.y[k] = y; out.r[k] = r;
        out.a[k] = k < M ? 1 : 0;
        out.t[k] = heatTone(h);
      }
    },
  };

  // wave — the lattice tilted into a perspective plane with travelling
  // waves, a squarish ripple ring and a foveated falloff around the focus.
  const WAVE = { tilt: 1.05, yaw: -0.14, D: 2.6, scale: 1.25, cx: 0.56, cy: 0.6 };
  shapes.wave = {
    build() {},
    rot: (t) => WAVE.tilt + 0.05 * Math.sin(t * 0.21),
    eval(out, L, t, still) {
      const { cols, rows, M, p, cell } = lat;
      const hr = (rows - 1) / 2, hc = (cols - 1) / 2, pm = 2 / Math.max(1, rows - 1);
      const S = p * hr * WAVE.scale, cx = W * WAVE.cx, cy = H * WAVE.cy, D = WAVE.D;
      const tilt = WAVE.tilt + (still ? 0 : 0.05 * Math.sin(t * 0.21));
      const ca = Math.cos(tilt), sa = Math.sin(tilt);
      const yaw = WAVE.yaw + (still ? 0 : 0.06 * Math.sin(t * 0.17));
      const cb = Math.cos(yaw), sb = Math.sin(yaw);
      const cyc = t * 0.4, k0 = Math.floor(cyc), ph = cyc - k0;
      const u0 = (hash01(k0 * 3 + 1) - 0.5) * 1.6, v0 = (hash01(k0 * 3 + 2) - 0.5) * 0.8;
      const ringR = ph * 2.6, ringFade = still ? 0 : (1 - ph) * smoothstep(0, 0.08, ph);
      const rb = gridRadius() * 1.3;
      // A still frame never runs updateFocus(): use the idle target's centre.
      const fx = still ? W * 0.5 : focus.x, fy = still ? H * 0.64 : focus.y;
      const fr0 = Math.min(W, H) * 0.2, fr1 = Math.max(W, H) * 0.62;
      for (let k = 0; k < N; k++) {
        const c = cell[k], col = c % cols, row = (c - col) / cols;
        const u = (col - hc) * pm, v = (row - hr) * pm;
        let h = 0.07 * Math.sin(2.1 * u + 1.2 * t) + 0.05 * Math.sin(2.7 * v - 1.0 * t + 0.6 * u);
        let ring = 0;
        if (ringFade > 0) {
          const du = u - u0, dv = v - v0, du2 = du * du, dv2 = dv * dv;
          const d = Math.sqrt(Math.sqrt(du2 * du2 + dv2 * dv2)), q = (d - ringR) / 0.1;
          ring = Math.exp(-q * q) * ringFade;
          h += 0.13 * ring;
        }
        // flat grid is (u, -v, 0) facing the viewer; tilt the top away, then yaw
        const y1 = -v * ca + h * sa, z1 = v * sa + h * ca;
        const x2 = u * cb + z1 * sb, z2 = z1 * cb - u * sb;
        const f = D / (D - z2);
        const sx = cx + x2 * f * S, sy = cy - y1 * f * S;
        const dx = sx - fx, dy = sy - fy;
        const near = 1 - smoothstep(fr0, fr1, Math.sqrt(dx * dx + dy * dy));
        out.x[k] = sx; out.y[k] = sy;
        out.r[k] = rb * f * (0.6 + 0.4 * near);
        out.a[k] = k < M ? 0.55 + 0.45 * near : 0;
        const crest = h > 0.1 || ring > 0.5 ? T_HI : h > 0.08 || ring > 0.3 ? T_MIX2 : h > 0.062 || ring > 0.15 ? T_MIX1 : T_BASE;
        out.t[k] = crest;
      }
    },
  };

  // torus — lattice torus (R 1, r .38) with a winding alt helix.
  shapes.torus = (() => {
    const mx = new Float32Array(NMAX), my = new Float32Array(NMAX), mz = new Float32Array(NMAX);
    const tones = new Uint8Array(NMAX), vis = new Uint8Array(NMAX);
    return {
      build() {
        const Rr = 1, rr = 0.38, norm = 1 / (Rr + rr);
        const U = Math.max(8, Math.round(Math.sqrt((N * Rr) / rr))), V = Math.max(4, Math.floor(N / U));
        const count = U * V;
        for (let i = 0; i < N; i++) {
          const j = i < count ? i : (i * 7919) % count;
          const u = Math.floor(j / V), v = j % V;
          const th = (u / U) * TAU, ph = ((v + (u & 1) * 0.5) / V) * TAU;
          const ring = Rr + rr * Math.cos(ph);
          mx[i] = ring * Math.cos(th) * norm;
          my[i] = ring * Math.sin(th) * norm;
          mz[i] = rr * Math.sin(ph) * norm;
          tones[i] = v === (u * 3) % V ? T_ALT : T_BASE;
          vis[i] = i < count ? 1 : 0;
        }
      },
      rot: (t) => t * 0.45,
      eval(out, L, t) {
        const r = Math.max(1.3, Math.min(3.4, L.s * 0.0095));
        const ax = 0.78 + 0.2 * Math.sin(t * 0.29), ay = 0.5 * Math.sin(t * 0.19 + 0.8);
        projectModel(out, N, mx, my, mz, tones, vis, L, ax, ay, t * 0.45, 4, r);
      },
    };
  })();

  // point — every particle gathers on the anchor centre; the anchor disc
  // itself is painted separately (see drawPoint).
  shapes.point = {
    build() {},
    rot: (t) => t * 20 * Math.PI / 180,
    eval(out, L) {
      const r = Math.min(1.8, L.ar);
      for (let i = 0; i < N; i++) {
        out.x[i] = L.cx; out.y[i] = L.cy; out.r[i] = r; out.a[i] = 1; out.t[i] = T_HI;
      }
    },
  };

  // --------------------------------------------------------------- floor
  // One world lattice (pitch fl.p) for every floor section. Sim rows run
  // near to far; each row is clipped to the union of the floor cameras' views
  // plus an absorbing margin. Mesh dot m (particles first, then extras) sits
  // on sim node fl.node[m].
  const fl = {
    p: 30, rw: 2.5, zStart: 0, zMeshFar: 0, zFar: 0, midZ: 0, tilt: FLOOR.pitch * DEG,
    spn: SIM.margin, rows: 0, rs: 0, S: 0, mesh: 0, nP: 0, nX: 0, version: 0,
    x: new Float32Array(SMAX), z: new Float32Array(SMAX),
    u: new Float32Array(SMAX), v: new Float32Array(SMAX), vn: new Float32Array(SMAX),
    F: new Float32Array(SMAX), damp: new Float32Array(SMAX), heat: new Float32Array(SMAX),
    hs: new Float32Array(SMAX), nb: new Int32Array(SMAX * 8), fade: new Float32Array(SMAX),
    node: new Int32Array(NMAX + XMAX), q: new Float32Array(NMAX + XMAX),
    rowStart: new Int32Array(RMAX), rowK: new Int32Array(RMAX), kv: new Int32Array(RMAX),
    acc: 0, awake: false, calm: 0, heatOn: false, hsDirty: true, moved: false,
  };
  const FCAMS = Array.from({ length: FCAM_MAX }, makeCam);
  const ECAM = makeCam(), ACAM = makeCam();
  const GP = { x: 0, z: 0 };
  let floorEls = [];

  const impacts = [0, 1, 2, 3, 4, 5].map(() => Object.assign(makePatch(), { age: 0, str: 1 }));
  // The impacts' colour fronts (cells, wall-clock start): see SIM.frontC.
  const fronts = [0, 1, 2, 3, 4, 5].map(() => ({ on: false, t0: 0, cx: 0, cz: 0, r0: 0, R: 0 }));
  const liveFronts = [];
  // Contacts: slot 0 is the pointer's own dimple.
  const contacts = Array.from({ length: 9 }, () => Object.assign(makePatch(), { id: null, x: 0, z: 0, sig: 1, d: 0, dirty: false }));
  const ptrC = contacts[0];
  const ptr = { x: 0, z: 0, d: 0 };

  function readFloorSections() {
    try { return Array.from(document.querySelectorAll('section.scene[data-scene="floor"]')); } catch (e) { return []; }
  }

  // Fill a camera from a section's attributes. live adds the follow shift.
  function setCam(cam, el, live) {
    const d = readData(el);
    const base = Math.min(H, 1.15 * W);
    const f = Math.max(80, (d.fLens != null ? d.fLens : FLOOR.lens) * base);
    const th = clamp(d.fPitch != null ? d.fPitch : FLOOR.pitch, 0.5, 60) * DEG;
    const hy = clamp(d.fHorizon != null ? d.fHorizon : FLOOR.horizon, 0, 0.9) * H;
    const shift = live && d.fFollow != null ? followTop(el, d.fFollow) : 0;
    cam.el = el; cam.f = f; cam.th = th; cam.ct = Math.cos(th); cam.st = Math.sin(th);
    cam.hc = FLOOR.height * f; cam.cx = W / 2;
    cam.hy0 = hy; cam.hy = hy + shift; cam.cy = hy + f * Math.tan(th) + shift; cam.shift = shift;
    cam.dot = d.fDot != null ? Math.max(0.2, d.fDot) : 1;
    return cam;
  }

  // The floor lifts with the element once its top edge passes the viewport
  // top, and never drops below rest: a section scrolling in morphs onto a
  // floor that is already in place.
  function followTop(el, sel) {
    const t = sel ? anchorEl(sel, el) : el;
    return t ? Math.min(0, t.getBoundingClientRect().top) : 0;
  }

  // Camera depth of the floor point (x, y, z); ground points use y = 0.
  const camDepth = (cam, z, y) => z * cam.ct - (y - cam.hc) * cam.st;

  // The floor point under a viewport point, or null at or above the horizon.
  function camGround(cam, sx, sy, out) {
    const xs = (sx - cam.cx) / cam.f, ys = (cam.cy - sy) / cam.f;
    const ry = ys * cam.ct - cam.st;
    if (ry > -1e-6) return null;
    const t = cam.hc / -ry;
    out.x = t * xs; out.z = t * (ys * cam.st + cam.ct);
    return out;
  }

  function buildFloor() {
    floorEls = readFloorSections();
    const nc = clamp(floorEls.length, 1, FCAM_MAX);
    for (let c = 0; c < nc; c++) setCam(FCAMS[c], floorEls[c] || null, false);
    const ref = FCAMS[0];
    // Lattice pitch: the wanted dot spacing along the bottom edge of the
    // first floor view, in world units there.
    const spacing = clamp(FLOOR.near * W, FLOOR.nearMin, FLOOR.nearMax) * clamp(readData(floorEls[0] || null).fScale || 1, 0.5, 3);
    const zb = camGround(ref, W / 2, H, GP) ? GP.z : ref.hc;
    const p = spacing * Math.max(1, camDepth(ref, zb, 0)) / ref.f;
    let zNear = Infinity, zFar = 0;
    for (let c = 0; c < nc; c++) {
      const cam = FCAMS[c];
      if (camGround(cam, W / 2, H + 2, GP)) zNear = Math.min(zNear, GP.z);
      if (camGround(cam, W / 2, cam.hy + Math.max(3, FLOOR.gap * H), GP)) zFar = Math.max(zFar, GP.z);
    }
    if (!isFinite(zNear)) zNear = 4 * p;
    fl.p = p; fl.rw = p * FLOOR.dot;
    fl.zStart = Math.max(p * (SIM.margin + 1), zNear - p);
    fl.zFar = Math.max(zFar, fl.zStart + p);
    // Mesh rows near to far until the dot budget is spent.
    const spn = SIM.margin, spf = 3, spl = SIM.margin;
    let budget = N + Math.min(XMAX, Math.round(XMAX * adaptScale));
    let rows = 0, count = 0, S = 0;
    for (let guard = 0; guard < 6; guard++) {
      rows = 0; count = 0;
      for (let r = 0; r < RMAX - spn - spf; r++) {
        const z = fl.zStart + r * p;
        if (z > fl.zFar) break;
        let kv = 0;
        for (let c = 0; c < nc; c++) {
          const cam = FCAMS[c];
          kv = Math.max(kv, Math.ceil(((W / 2) * camDepth(cam, z, 0)) / cam.f / p));
        }
        if (count + 2 * kv + 1 > budget) break;
        fl.kv[r + spn] = kv; count += 2 * kv + 1; rows++;
      }
      rows = Math.max(1, rows);
      S = 0;
      for (let rr = 0; rr < spn + rows + spf; rr++) {
        const r = clamp(rr - spn, 0, rows - 1);
        S += 2 * (fl.kv[r + spn] + spl) + 1;
      }
      if (S <= SMAX) break;
      budget = Math.floor(budget * 0.8);
    }
    fl.spn = spn; fl.rows = rows; fl.rs = spn + rows + spf;
    fl.zMeshFar = fl.zStart + (rows - 1) * p;
    // row extents (visible kv and simulated K) with the margins filled in
    const rowKv = (rr) => fl.kv[clamp(rr - spn, 0, rows - 1) + spn];
    S = 0;
    for (let rr = 0; rr < fl.rs; rr++) {
      const K = rowKv(rr) + spl;
      fl.rowK[rr] = K; fl.rowStart[rr] = S; S += 2 * K + 1;
    }
    fl.S = Math.min(S, SMAX);
    // a missing neighbour reads the node itself: a free (reflecting) edge
    const at = (rr, c, self) => {
      if (rr < 0 || rr >= fl.rs || c < -fl.rowK[rr] || c > fl.rowK[rr]) return self;
      const i = fl.rowStart[rr] + c + fl.rowK[rr];
      return i < fl.S ? i : self;
    };
    for (let rr = 0; rr < fl.rs; rr++) {
      const K = fl.rowK[rr], kv = rowKv(rr), z = fl.zStart + (rr - spn) * p;
      for (let c = -K; c <= K; c++) {
        const i = fl.rowStart[rr] + c + K;
        if (i >= fl.S) break;
        fl.x[i] = c * p; fl.z[i] = z;
        const b = i * 8;
        fl.nb[b] = at(rr + 1, c, i); fl.nb[b + 1] = at(rr - 1, c, i);
        fl.nb[b + 2] = at(rr, c + 1, i); fl.nb[b + 3] = at(rr, c - 1, i);
        fl.nb[b + 4] = at(rr + 1, c + 1, i); fl.nb[b + 5] = at(rr + 1, c - 1, i);
        fl.nb[b + 6] = at(rr - 1, c + 1, i); fl.nb[b + 7] = at(rr - 1, c - 1, i);
        // cells outside the drawn mesh: waves die there instead of bouncing back
        const out = Math.max(Math.abs(c) - kv, spn - rr, rr - (spn + rows - 1));
        fl.damp[i] = SIM.g0 + (out > 0 ? SIM.gs * Math.min(1, out / SIM.margin) ** 2 : 0);
      }
    }
    // The last rows thin out where the far field has no ray to carry them on
    // (the oblique sides, see renderFar), so the mesh never ends on a hard
    // row; where a ray continues the column, they stay whole.
    const zLast = fl.zStart + (rows - 1) * p, vx = ref.cx, vy = ref.hy;
    const rayEnd = (cos) => ((ref.f * p * cos) / 2.2 - ref.hc * ref.st) / ref.ct;
    let m = 0;
    for (let r = 0; r < rows; r++) {
      const rr = r + spn, kv = fl.kv[rr], K = fl.rowK[rr], z = fl.zStart + r * p;
      const edge = clamp01((r - (rows - 6)) / 5), zc = camDepth(ref, z, 0);
      const sy = ref.cy - (z * ref.st - ref.hc * ref.ct) * (ref.f / zc);
      for (let c = -kv; c <= kv && m < NMAX + XMAX && fl.rowStart[rr] + c + K < fl.S; c++, m++) {
        const i = fl.rowStart[rr] + c + K;
        fl.node[m] = i;
        fl.q[m] = rows > 1 ? r / (rows - 1) : 0;
        let fade = 1;
        if (edge > 0) {
          const dx = vx - (ref.cx + (c * p * ref.f) / zc), dy = vy - sy;
          const cos = Math.floor((Math.abs(dy) / Math.sqrt(dx * dx + dy * dy)) * 8) / 8;
          fade = 1 - 0.55 * edge * (1 - smoothstep(zLast + p, zLast + 4 * p, rayEnd(cos)));
        }
        fl.fade[i] = fade;
      }
    }
    fl.mesh = m; fl.nP = Math.min(N, m); fl.nX = Math.min(XMAX, m - fl.nP);
    fl.midZ = fl.z[fl.node[Math.max(0, (fl.nP >> 1))]];
    fl.version++;
    resetFloorMotion(!reduced);
  }

  // Drop the running waves (the lattice changed or motion switched); resting
  // contacts come back as their static dimples.
  function resetFloorMotion(live) {
    const S = fl.S;
    fl.v.fill(0, 0, S); fl.vn.fill(0, 0, S); fl.heat.fill(0, 0, S); fl.F.fill(0, 0, S);
    for (let q = 0; q < impacts.length; q++) impacts[q].on = false;
    for (let q = 0; q < fronts.length; q++) fronts[q].on = false;
    ptr.d = 0; ptrC.on = false; ptrC.d = 0;
    fl.hsDirty = true;
    const hs = staticHeights();
    fl.u.set(hs.subarray(0, S));
    for (let q = 0; q < contacts.length; q++) contacts[q].dirty = true;
    fl.acc = 0; fl.calm = 0; fl.heatOn = false;
    fl.awake = live;
  }

  // Sim node at lattice (row, col), or -1.
  function nodeAt(rr, c) {
    if (rr < 0 || rr >= fl.rs) return -1;
    const K = fl.rowK[rr], i = fl.rowStart[rr] + c + K;
    return c < -K || c > K || i >= fl.S ? -1 : i;
  }

  // Gaussian footprint of width sig (world) around floor point (x, z).
  function gatherPatch(pt, x, z, sig) {
    const p = fl.p, cc = x / p, rc = (z - fl.zStart) / p + fl.spn;
    const R = Math.min((PATCH - 1) >> 1, Math.ceil((2.6 * sig) / p));
    const c0 = Math.round(cc), r0 = Math.round(rc), inv = 1 / (2 * sig * sig);
    let n = 0;
    for (let rr = r0 - R; rr <= r0 + R; rr++) {
      for (let c = c0 - R; c <= c0 + R; c++) {
        const i = nodeAt(rr, c);
        if (i < 0) continue;
        const dx = (c - cc) * p, dz = (rr - rc) * p, g = Math.exp(-(dx * dx + dz * dz) * inv);
        if (g < 0.02) continue;
        pt.idx[n] = i; pt.w[n] = g; n++;
      }
    }
    pt.cnt = n;
  }

  // Resting dimples without the sim (reduced motion), a little wider than
  // the spring target to stand in for the fabric's pull.
  function staticHeights() {
    if (!fl.hsDirty) return fl.hs;
    fl.hsDirty = false;
    const hs = fl.hs, p = fl.p;
    hs.fill(0, 0, fl.S);
    for (let q = 1; q < contacts.length; q++) {
      const c = contacts[q];
      if (!c.on) continue;
      const sig = c.sig * 1.7, inv = 1 / (2 * sig * sig);
      const cc = c.x / p, rc = (c.z - fl.zStart) / p + fl.spn, Rn = Math.min(10, Math.ceil((3 * sig) / p));
      const c0 = Math.round(cc), r0 = Math.round(rc);
      for (let rr = r0 - Rn; rr <= r0 + Rn; rr++) {
        for (let k = c0 - Rn; k <= c0 + Rn; k++) {
          const i = nodeAt(rr, k);
          if (i < 0) continue;
          const dx = (k - cc) * p, dz = (rr - rc) * p;
          hs[i] -= c.d * 0.8 * Math.exp(-(dx * dx + dz * dz) * inv);
        }
      }
    }
    return hs;
  }

  function wakeFloor() { fl.awake = !reduced; fl.calm = 0; }

  // Dominant floor section: the floor side of the current morph that shows
  // most, else the first floor section.
  function floorEl(el) {
    if (el && el.nodeType === 1) return (el.closest && el.closest('section.scene')) || el;
    if (scene.from === 'floor' && (scene.to !== 'floor' || blendS < 0.5)) return scene.fromEl;
    if (scene.to === 'floor') return scene.toEl;
    return floorEls[0] || null;
  }

  function floorImpact(sx, sy, str, rPx) {
    if (reduced || !(str > 0) || !fl.S) return;
    const cam = setCam(ECAM, floorEl(null), true);
    if (!camGround(cam, sx, sy, GP)) return;
    const p = fl.p;
    if (GP.z < fl.zStart - 2 * p || GP.z > fl.zMeshFar + 2 * p) return;
    let slot = impacts[0];
    for (let q = 0; q < impacts.length; q++) {
      const s = impacts[q];
      if (!s.on) { slot = s; break; }
      if (s.age > slot.age) slot = s;
    }
    const s = cam.f / Math.max(1, camDepth(cam, GP.z, 0));
    const sig = rPx > 0 ? clamp((0.8 * rPx) / s, 1.1 * p, 2.3 * p) : SIM.impSig * p;
    gatherPatch(slot, GP.x, GP.z, sig);
    slot.on = slot.cnt > 0; slot.age = 0; slot.str = Math.min(2.5, str);
    // A light touch (a rebound, a dent) adds no front of its own: its band
    // would re-open the older ring's dark inside.
    if (slot.on && str >= SIM.frontMin) {
      let fr = fronts[0];
      for (let q = 0; q < fronts.length; q++) {
        const f = fronts[q];
        if (!f.on) { fr = f; break; }
        if (f.t0 < fr.t0) fr = f;
      }
      fr.on = true; fr.t0 = performance.now(); fr.cx = GP.x / p; fr.cz = GP.z / p; fr.r0 = (2 * sig) / p;
    }
    wakeFloor();
  }

  function setContact(c, x, z, sig, d) {
    if (c.on && Math.abs(c.x - x) < 0.01 && Math.abs(c.z - z) < 0.01 && Math.abs(c.sig - sig) < 0.01 && Math.abs(c.d - d) < 0.01) return;
    c.x = x; c.z = z; c.sig = sig; c.d = d; c.on = d > 0; c.dirty = true;
    if (c !== ptrC) fl.hsDirty = true;
  }

  function floorContact(d) {
    const id = d.id == null ? '' : String(d.id);
    let slot = null, free = null;
    for (let q = 1; q < contacts.length; q++) {
      const c = contacts[q];
      if (c.id === id) { slot = c; break; }
      if (!free && !c.on) free = c;
    }
    if (d.off) {
      if (slot && slot.on) { slot.on = false; slot.id = null; fl.hsDirty = true; wakeFloor(); }
      return;
    }
    slot = slot || free;
    if (!slot || !fl.S) return;
    const cam = setCam(ECAM, floorEl(null), true);
    if (!camGround(cam, +d.x, +d.y, GP)) return;
    const s = cam.f / Math.max(1, camDepth(cam, GP.z, 0));
    const r = Math.max(1, +d.r || 12);
    const depth = d.depth != null && isFinite(+d.depth) ? Math.max(0, +d.depth) : r * 0.8;
    slot.id = id;
    setContact(slot, GP.x, GP.z, clamp(r / s, 1.3 * fl.p, 2.3 * fl.p), depth / s);
    if (slot.dirty) wakeFloor();
  }

  // The pointer presses a small dimple while it moves over the floor.
  function pointerDimple(dt, now, cam, on) {
    let want = 0;
    if (on && !reduced && pointer.inView && now - pointer.at < 2500 && (!pointer.touch || pointer.down) &&
      camGround(cam, pointer.x, pointer.y, GP) && GP.z >= fl.zStart && GP.z <= fl.zMeshFar) {
      want = SIM.ptrDepth * fl.p;
      if (ptr.d <= 1e-4) { ptr.x = GP.x; ptr.z = GP.z; }
      else { const k = 1 - Math.exp(-dt * 22); ptr.x += (GP.x - ptr.x) * k; ptr.z += (GP.z - ptr.z) * k; }
    }
    ptr.d += (want - ptr.d) * (1 - Math.exp(-dt * (want > ptr.d ? 10 : 4)));
    if (ptr.d < 0.004 * fl.p) ptr.d = 0;
    if (ptr.d > 0 || ptrC.on) setContact(ptrC, ptr.x, ptr.z, SIM.ptrSig * fl.p, ptr.d);
  }

  // One fixed step of the membrane: 9-point Laplacian, damped, with the
  // impact pulses and contact springs as forces. Returns the peak speed.
  function substep() {
    const S = fl.S, u = fl.u, v = fl.v, vn = fl.vn, F = fl.F, nb = fl.nb, damp = fl.damp;
    const dt = SIM.dt, p = fl.p;
    F.fill(0, 0, S);
    for (let q = 0; q < impacts.length; q++) {
      const im = impacts[q];
      if (!im.on) continue;
      im.age += dt;
      if (im.age > SIM.impT) { im.on = false; continue; }
      const amp = im.str * SIM.impA * p * Math.sin((Math.PI * im.age) / SIM.impT);
      for (let j = 0; j < im.cnt; j++) F[im.idx[j]] -= amp * im.w[j];
    }
    for (let q = 0; q < contacts.length; q++) {
      const c = contacts[q];
      if (!c.on) continue;
      for (let j = 0; j < c.cnt; j++) {
        const i = c.idx[j], w = c.w[j], target = -c.d * w;
        if (u[i] > target) F[i] += (SIM.kc * (target - u[i]) - SIM.cc * v[i]) * w;
      }
    }
    const c2 = SIM.c2, nu = SIM.nu, k = SIM.k;
    let vmax = 0;
    for (let i = 0, b = 0; i < S; i++, b += 8) {
      const lu = (4 * (u[nb[b]] + u[nb[b + 1]] + u[nb[b + 2]] + u[nb[b + 3]]) +
        u[nb[b + 4]] + u[nb[b + 5]] + u[nb[b + 6]] + u[nb[b + 7]] - 20 * u[i]) / 6;
      const lv = (4 * (v[nb[b]] + v[nb[b + 1]] + v[nb[b + 2]] + v[nb[b + 3]]) +
        v[nb[b + 4]] + v[nb[b + 5]] + v[nb[b + 6]] + v[nb[b + 7]] - 20 * v[i]) / 6;
      const w = v[i] + (c2 * lu + nu * lv - damp[i] * v[i] - k * u[i] + F[i]) * dt;
      vn[i] = w;
      const aw = w < 0 ? -w : w;
      if (aw > vmax) vmax = aw;
    }
    fl.v = vn; fl.vn = v;
    for (let i = 0; i < S; i++) u[i] += vn[i] * dt;
    return vmax;
  }

  // Per frame: pointer dimple, footprints of moved contacts, the fixed-step
  // sim, then the colour memory. The mesh sleeps once everything is still.
  function floorFrame(dt, now, cam, dominant) {
    fl.tilt = cam.th;
    pointerDimple(dt, now, cam, dominant);
    let moved = false;
    for (let q = 0; q < contacts.length; q++) {
      const c = contacts[q];
      if (!c.dirty) continue;
      c.dirty = false; moved = true;
      if (c.on) gatherPatch(c, c.x, c.z, c.sig);
    }
    if (moved) wakeFloor();
    let busy = moved;
    for (let q = 0; q < impacts.length; q++) if (impacts[q].on) busy = true;
    if (fl.awake) {
      fl.acc = Math.min(fl.acc + dt, SIM.dt * SIM.maxSteps);
      let vmax = 0, steps = 0;
      while (fl.acc >= SIM.dt) { const v = substep(); if (v > vmax) vmax = v; fl.acc -= SIM.dt; steps++; }
      if (steps) {
        if (!busy && vmax < SIM.sleepV * fl.p) {
          if (++fl.calm > 30) { fl.awake = false; fl.v.fill(0, 0, fl.S); }
        } else fl.calm = 0;
      }
    } else fl.acc = 0;
    if (fl.awake || fl.heatOn) floorHeat(dt);
  }

  // Crests and fast nodes run hot and cool off over heatTau; behind an
  // impact's colour front they cool fast and stay dark (a ring, not a disc).
  function floorHeat(dt) {
    const dec = Math.exp(-dt / SIM.heatTau), ip = 1 / fl.p, u = fl.u, v = fl.v, heat = fl.heat;
    const kv = SIM.heatV * ip, k0 = SIM.heatV0, ku = SIM.heatU * ip;
    const decIn = Math.exp(-dt / SIM.frontCool), W = SIM.frontW, speed = SIM.frontC * Math.sqrt(SIM.c2);
    const now = performance.now();
    liveFronts.length = 0;
    for (let q = 0; q < fronts.length; q++) {
      const f = fronts[q];
      if (!f.on) continue;
      const age = (now - f.t0) / 1000;
      if (age > SIM.frontT) { f.on = false; continue; }
      f.R = f.r0 + speed * age;
      liveFronts.push(f);
    }
    const nf = liveFronts.length;
    let any = false;
    for (let m = 0; m < fl.mesh; m++) {
      const i = fl.node[m];
      const vi = v[i] < 0 ? -v[i] : v[i], ui = u[i] > 0 ? u[i] : 0;
      let e = Math.max(0, vi * kv - k0) + ui * ku;
      let h = heat[i] * dec;
      if (nf) {
        let inner = false, band = false;
        const cx = fl.x[i] * ip, cz = fl.z[i] * ip;
        for (let q = 0; q < nf; q++) {
          const f = liveFronts[q], dx = cx - f.cx, dz = cz - f.cz, d = Math.sqrt(dx * dx + dz * dz);
          if (d < f.R - W) inner = true;
          else if (d < f.R + W) band = true;
        }
        if (inner && !band) { e = 0; h = heat[i] * decIn; }
      }
      if (e > h) h = e;
      if (h < 0.01) h = 0; else any = true;
      heat[i] = h;
    }
    fl.heatOn = any;
  }

  function projectNode(buf, k, i, cam, h, still) {
    const x = fl.x[i], z = fl.z[i], dy = h[i] - cam.hc;
    const yc = dy * cam.ct + z * cam.st, zc = z * cam.ct - dy * cam.st;
    if (zc < 1) { buf.x[k] = cam.cx; buf.y[k] = cam.cy; buf.r[k] = 0; buf.a[k] = 0; buf.t[k] = T_BASE; return; }
    const s = cam.f / zc;
    buf.x[k] = cam.cx + x * s;
    buf.y[k] = cam.cy - yc * s;
    const heat = still ? 0 : fl.heat[i];
    buf.r[k] = fl.rw * cam.dot * s * (1 + 0.5 * Math.min(1.2, heat));
    const a = floorAlpha(fl.p * s) * fl.fade[i];
    buf.a[k] = heat > 0.1 ? Math.max(a, Math.min(1, 0.45 + heat)) : a;
    buf.t[k] = heat > SIM.hot ? T_HI : T_BASE;
  }

  shapes.floor = {
    build() { buildFloor(); },
    rot: () => fl.tilt,
    eval(out, L, t, still) {
      const cam = L.cam, h = still ? staticHeights() : fl.u, nP = fl.nP;
      for (let k = 0; k < N; k++) {
        const m = k < nP ? k : nP ? ((k - nP) * 7919) % nP : 0;
        projectNode(out, k, fl.node[m], cam, h, still);
        if (k >= nP) out.a[k] = 0;
      }
      if (!L.ex) return;
      for (let j = 0; j < fl.nX; j++) projectNode(L.ex, j, fl.node[nP + j], cam, h, still);
      L.nx = fl.nX;
    },
  };

  // ------------------------------------------------------ floor far field
  // Rows past the mesh, drawn once per camera and colour into an offscreen
  // band and blitted each frame (shifted when the floor follows a section).
  const farSlots = [0, 1].map(() => ({ canvas: null, ver: -1, f: 0, th: 0, hy: 0, dot: 0, col: '', dpr: 0, y0: 0, h: 0, used: 0 }));
  let farTick = 0;

  function farFor(cam) {
    const col = toneStr[T_BASE];
    for (let q = 0; q < farSlots.length; q++) {
      const s = farSlots[q];
      if (s.ver === fl.version && s.f === cam.f && s.th === cam.th && s.hy === cam.hy0 && s.dot === cam.dot && s.col === col && s.dpr === dpr) {
        s.used = ++farTick;
        return s;
      }
    }
    const slot = farSlots[0].used <= farSlots[1].used ? farSlots[0] : farSlots[1];
    renderFar(slot, cam, col);
    slot.used = ++farTick;
    return slot;
  }

  function renderFar(slot, cam, col) {
    slot.ver = fl.version; slot.f = cam.f; slot.th = cam.th; slot.hy = cam.hy0; slot.dot = cam.dot; slot.col = col; slot.dpr = dpr;
    slot.h = 0;
    const p = fl.p, rw = fl.rw * cam.dot, f = cam.f, ct = cam.ct, st = cam.st, hc = cam.hc;
    const cy0 = cam.cy - cam.shift, hy0 = cam.hy0, cx = cam.cx;
    const gap = Math.max(3, FLOOR.gap * H), fadeSpan = 0.14 * H;
    const rowY = (z) => { const zc = z * ct + hc * st; return { s: f / zc, y: cy0 - (z * st - hc * ct) * (f / zc) }; };
    const first = rowY(fl.zStart + fl.rows * p), lastMesh = rowY(fl.zStart + (fl.rows - 1) * p);
    if (first.y - hy0 < gap) return;
    const top = Math.floor(hy0 - 2), bottom = Math.ceil(lastMesh.y + rw * lastMesh.s + 3);
    const bh = bottom - top;
    if (!slot.canvas) slot.canvas = document.createElement('canvas');
    const cw = Math.max(1, Math.ceil(W * dpr)), chh = Math.max(1, Math.ceil(bh * dpr));
    if (slot.canvas.width !== cw || slot.canvas.height !== chh) { slot.canvas.width = cw; slot.canvas.height = chh; }
    const c = slot.canvas.getContext('2d');
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cw, chh);
    c.setTransform(dpr, 0, 0, dpr, 0, -top * dpr);
    c.fillStyle = col;
    // 1) Dot rows while they still read as dots.
    let r = fl.rows, lastY = rowY(fl.zStart + (r - 1) * p).y;
    for (; r < fl.rows + 400; r++) {
      const z = fl.zStart + r * p;
      const zc = z * ct + hc * st, s = f / zc, y = cy0 - (z * st - hc * ct) * s;
      const sp = p * s, rad = Math.max(0.3, rw * s);
      if (y - hy0 < gap || lastY - y < 3.5 || sp < 7) break;
      lastY = y;
      c.globalAlpha = LEVEL_ALPHA[levelOf(floorAlpha(sp))] * smoothstep(gap, gap + fadeSpan, y - hy0);
      c.beginPath();
      const x0 = cx - Math.ceil(cx / sp) * sp;
      for (let x = x0; x < W + sp; x += sp) {
        if (rad < 0.9) c.rect(x - rad, y - rad, rad * 2, rad * 2);
        else { c.moveTo(x + rad, y); c.arc(x, y, rad, 0, TAU); }
      }
      c.fill();
    }
    // 2) Past that the rows merge: each column becomes a tapered ray toward
    // the vanishing point, fading out before the dots would alias.
    const zA = fl.zStart + (r - 0.5) * p;
    const zcB = (f * p) / 2.2, zB = Math.min((zcB - hc * st) / ct, camGround(cam, cx, hy0 + cam.shift + gap, GP) ? GP.z : zA);
    if (zB > zA) {
      const sA = f / (zA * ct + hc * st), sB = f / (zB * ct + hc * st);
      const yA = cy0 - (zA * st - hc * ct) * sA;
      const spA = p * sA, rA = Math.max(0.35, rw * sA);
      // a merged column is darker than a dotted one: start at dot coverage
      const dyA = rowY(zA - 0.5 * p).y - rowY(zA + 0.5 * p).y;
      const a0 = LEVEL_ALPHA[levelOf(floorAlpha(spA))] * Math.min(1, (Math.PI * rA) / (2 * Math.max(0.5, dyA)));
      const rgba = (al) => col.replace('rgb(', 'rgba(').replace(')', `,${al.toFixed(3)})`);
      c.globalAlpha = 1;
      // Oblique rays sit closer together across their direction: each ends
      // where that gap falls to ~2 px. Rays are binned by obliqueness, one
      // gradient per bin.
      const BINS = 8, vy = cam.hy - cam.shift, cMax = Math.ceil((W / 2 + 4) / (p * sB));
      for (let bin = BINS - 1; bin >= 1; bin--) {
        const cos = bin / BINS;
        const zE = Math.min(zB, ((f * p * cos) / 2.2 - hc * st) / ct);
        if (zE <= zA + p) continue;
        const sE = f / (zE * ct + hc * st), yE = cy0 - (zE * st - hc * ct) * sE, rE = Math.max(0.25, rw * sE);
        const g = c.createLinearGradient(0, yA, 0, yE);
        g.addColorStop(0, rgba(a0)); g.addColorStop(0.55, rgba(a0 * 0.55)); g.addColorStop(1, rgba(0));
        c.fillStyle = g;
        c.beginPath();
        let any = false;
        for (let k = -cMax; k <= cMax; k++) {
          const xA = cx + k * p * sA, dx = cx - xA, dy = vy - yA;
          const kc = Math.abs(dy) / Math.sqrt(dx * dx + dy * dy);
          if (Math.min(BINS - 1, Math.floor(kc * BINS)) !== bin) continue;
          const xE = cx + k * p * sE;
          if ((xA < -8 && xE < -8) || (xA > W + 8 && xE > W + 8)) continue;
          c.moveTo(xA - rA, yA); c.lineTo(xA + rA, yA); c.lineTo(xE + rE, yE); c.lineTo(xE - rE, yE); c.closePath();
          any = true;
        }
        if (any) c.fill();
      }
    }
    c.globalAlpha = 1;
    slot.y0 = top; slot.h = bh;
  }

  // Blit a camera's far band; top/bottom (optional) stretch it onto another
  // horizon-to-mesh-edge span.
  function drawFar(cam, alpha, top, bottom) {
    if (alpha < 0.02) return;
    const s = farFor(cam);
    if (!s.h || !s.canvas) return;
    const y = top == null ? s.y0 + cam.shift : top, h = top == null ? s.h : bottom - top;
    if (h < 1) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(s.canvas, 0, 0, s.canvas.width, s.canvas.height, 0, y, W, h);
    ctx.globalAlpha = 1;
  }

  // Far field and extra mesh dots behind the particles. Leaving the floor
  // they fade far rows first; forming it, near rows first.
  function drawFloorBack(fromFloor, toFloor, b, mul) {
    const nx = fl.nX;
    if (fromFloor && toFloor) {
      // Both far bands are stretched onto the span between the two cameras'
      // horizons and mesh edges (crossfaded when the cameras differ), so the
      // band meets the gliding mesh and there is never a second horizon.
      const e = easeInOutCubic(b), ca = LA.cam, cb = LB.cam;
      const sa = farFor(ca), sb = farFor(cb);
      const ta = sa.y0 + ca.shift, tb = sb.y0 + cb.shift;
      const top = ta + (tb - ta) * e, bot = ta + sa.h + (tb + sb.h - ta - sa.h) * e;
      if (sa === sb) drawFar(ca, mul, top, bot);
      else { drawFar(ca, mul * (1 - e), top, bot); drawFar(cb, mul * e, top, bot); }
      const ea = LA.ex, eb = LB.ex;
      for (let j = 0; j < nx; j++) {
        bufX.x[j] = ea.x[j] + (eb.x[j] - ea.x[j]) * e; bufX.y[j] = ea.y[j] + (eb.y[j] - ea.y[j]) * e;
        bufX.r[j] = ea.r[j] + (eb.r[j] - ea.r[j]) * e; bufX.a[j] = ea.a[j] + (eb.a[j] - ea.a[j]) * e;
        bufX.t[j] = e < 0.5 ? ea.t[j] : eb.t[j];
      }
      drawDots(bufX.x, bufX.y, bufX.r, bufX.a, bufX.t, nx, mul);
      return;
    }
    const L = fromFloor ? LA : LB, ex = L.ex;
    if (fromFloor && b <= 0) {
      drawFar(L.cam, mul);
      drawDots(ex.x, ex.y, ex.r, ex.a, ex.t, nx, mul);
      return;
    }
    drawFar(L.cam, mul * (fromFloor ? 1 - smoothstep(0, 0.4, b) : smoothstep(0.6, 1, b)));
    const q = fl.q, nP = fl.nP;
    for (let j = 0; j < nx; j++) {
      const d = q[nP + j];
      const w = fromFloor ? 1 - clamp01((b - 0.3 * (1 - d)) / 0.4) : clamp01((b - 0.3 - 0.3 * d) / 0.4);
      bufX.x[j] = ex.x[j]; bufX.y[j] = ex.y[j]; bufX.t[j] = ex.t[j];
      bufX.r[j] = ex.r[j] * (0.5 + 0.5 * w); bufX.a[j] = ex.a[j] * w;
    }
    drawDots(bufX.x, bufX.y, bufX.r, bufX.a, bufX.t, nx, mul);
  }

  const SHAPE_NAMES = Object.keys(shapes);
  const known = (name) => (shapes[name] ? name : null);

  // ------------------------------------------------------------- layout
  const dataCache = new Map();
  // Anchors resolve per scope, so one selector can name a different element
  // in each section (e.g. every pinned section's own sticky stage).
  let anchorCache = new WeakMap();
  const docAnchors = new Map();

  function sectionFor(name) {
    try { return document.querySelector(`section.scene[data-scene="${name}"]`); } catch (e) { return null; }
  }

  const NO_DATA = {
    x: null, y: null, scale: null, anchor: '', alpha: null,
    fHorizon: null, fPitch: null, fLens: null, fDot: null, fScale: null, fFollow: null,
  };
  function readData(el) {
    if (!el) return NO_DATA;
    let d = dataCache.get(el);
    if (d) return d;
    const ds = el.dataset || {};
    const num = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);
    d = {
      x: num(ds.dotsX), y: num(ds.dotsY), scale: num(ds.dotsScale), anchor: ds.dotsAnchor || '', alpha: num(ds.dotsAlpha),
      fHorizon: num(ds.floorHorizon), fPitch: num(ds.floorPitch), fLens: num(ds.floorLens),
      fDot: num(ds.floorDot), fScale: num(ds.floorScale),
      fFollow: ds.floorFollow == null ? null : ds.floorFollow.trim(),
    };
    dataCache.set(el, d);
    return d;
  }

  // The anchor inside its own section first, so a class selector stays local.
  function anchorEl(sel, scope) {
    if (!sel) return null;
    let map = docAnchors;
    if (scope) {
      map = anchorCache.get(scope);
      if (!map) { map = new Map(); anchorCache.set(scope, map); }
    }
    let el = map.get(sel);
    if (el && el.isConnected) return el;
    try { el = (scope && scope.querySelector(sel)) || document.querySelector(sel); } catch (e) { el = null; }
    if (el) map.set(sel, el);
    return el;
  }

  // Phones, tablets and portrait windows have no free column beside the text:
  // shapes centre behind it, smaller and fainter.
  const compactMq = window.matchMedia ? window.matchMedia('(max-width: 1023px), (orientation: portrait)') : null;
  const isCompact = () => (compactMq ? compactMq.matches : W < 1024 || W <= H);

  // A point anchor below the fold would pull the particles off screen. Past a
  // knee it eases toward the bottom band instead, so the dot waits there and
  // rides up with its section once the anchor itself comes into view.
  function holdOnScreen(y) {
    const hi = H * 0.94, k = H * 0.18, knee = hi - k;
    return y > knee ? knee + k * (1 - Math.exp(-(y - knee) / k)) : y;
  }

  function layout(name, el, out) {
    if (name === 'floor') {
      // Full bleed: the camera comes from the section; the centre is where
      // the particle rows sit, for pairing and stagger.
      const cam = setCam(out.cam, el, true);
      const zc = camDepth(cam, fl.midZ, 0);
      out.cx = W / 2; out.cy = cam.cy - (fl.midZ * cam.st - cam.hc * cam.ct) * (cam.f / Math.max(1, zc));
      out.s = 0.5 * Math.min(W, H); out.ar = 0;
      return out;
    }
    const def = LAYOUT[name] || LAYOUT.sphere;
    const d = readData(el);
    let x = d.x != null ? d.x : def.x, y = d.y != null ? d.y : def.y;
    let sc = d.scale != null ? d.scale : def.scale;
    const compact = isCompact();
    if (compact) { x = 0.5; sc *= 0.75; }
    out.cx = x * W; out.cy = y * H; out.s = sc * Math.min(W, H); out.ar = 0;
    // Beside the text column, never reach further left than the free side allows.
    const free = !compact && x > 0.5 ? (1 - x) * W : 0;
    if (free) out.s = Math.min(out.s, free * 0.9);
    if (name === 'point') {
      const a = anchorEl(d.anchor || (el && el.id === 'contact' ? '#contact-dot' : el && el.id === 'skills' ? '#rings-center' : ''), el);
      if (a) {
        const rc = a.getBoundingClientRect();
        if (rc.width > 0 || rc.height > 0) {
          out.cx = rc.left + rc.width / 2; out.cy = holdOnScreen(rc.top + rc.height / 2);
          out.ar = Math.max(2, rc.width / 2);
        }
      }
      if (!out.ar) out.ar = 9;
    } else if (d.anchor) {
      // A shape anchor (e.g. a layout slot on mobile) wins while it has a box:
      // the shape is centred on it and fills it.
      const a = anchorEl(d.anchor, el);
      const rc = a && a.getBoundingClientRect();
      if (rc && rc.width > 0 && rc.height > 0) {
        out.cx = rc.left + rc.width / 2; out.cy = rc.top + rc.height / 2;
        out.s = Math.min(rc.width, rc.height) / 2;
      }
    }
    return out;
  }

  function alphaMul(el) {
    const d = readData(el);
    if (d.alpha != null) return clamp01(d.alpha);
    return isCompact() && !(el && el.id === 'hello') ? 0.45 : 1;
  }

  // ------------------------------------------------------------- colours
  function readColors() {
    needColors = false;
    const cs = getComputedStyle(document.body);
    const base = parseColor(ctx, cs.getPropertyValue('--dot'), parseColor(ctx, cs.getPropertyValue('--fg'), [21, 21, 23]));
    const hi = parseColor(ctx, cs.getPropertyValue('--dot-hi'), parseColor(ctx, cs.getPropertyValue('--accent'), [229, 67, 47]));
    const alt = parseColor(ctx, cs.getPropertyValue('--dot-alt'), [51, 64, 230]);
    toneStr[T_BASE] = rgb(base);
    toneStr[T_MIX1] = rgb(mixRgb(base, hi, 0.38));
    toneStr[T_MIX2] = rgb(mixRgb(base, hi, 0.7));
    toneStr[T_HI] = rgb(hi);
    toneStr[T_ALT] = rgb(alt);
  }

  // -------------------------------------------------------------- sizing
  function applySize() {
    needResize = false;
    const cw = canvas.clientWidth || window.innerWidth, ch = canvas.clientHeight || window.innerHeight;
    W = Math.max(1, cw); H = Math.max(1, ch);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dataCache.clear();
    rest.el = null;
    const n = targetCount();
    pendingN = 0;
    // Same count: shape indices stay valid, so only the screen lattice and
    // the floor move and a morph in progress carries on without a snap.
    if (n === N) { buildLattice(); buildFloor(); } else setCount(n);
    fpsWarm = 1;
  }

  function targetCount() {
    const base = W >= 1024 ? 1400 : W >= 768 ? 900 : 600;
    return Math.max(240, Math.min(NMAX, Math.round(base * adaptScale)));
  }

  function setCount(n) {
    N = n;
    buildLattice();
    for (const name of SHAPE_NAMES) shapes[name].build();
    for (let i = 0; i < N; i++) { asA[i] = i; asB[i] = i; }
    held = { from: '', to: '', fromEl: null, toEl: null };
    snapToScene();
  }

  // After a rebuild, put every particle straight onto the current scene.
  function snapToScene() {
    const name = scene.to && blendS >= 0.5 ? scene.to : scene.from;
    const el = name === scene.to && blendS >= 0.5 ? scene.toEl : scene.fromEl;
    layout(name, el, LA);
    shapes[name].eval(bufA, LA, time, reduced);
    for (let i = 0; i < N; i++) {
      X[i] = PX[i] = bufA.x[i]; Y[i] = PY[i] = bufA.y[i];
      R[i] = bufA.r[i]; A[i] = bufA.a[i]; T[i] = bufA.t[i]; TJ[i] = 0;
      asA[i] = i; asB[i] = i;
    }
    held = { from: name, to: name, fromEl: el, toEl: el };
  }

  // ------------------------------------------------------ pair matching
  // Give shape `name` an assignment (particle -> shape point) by pairing the
  // particles' current screen positions with the shape's points.
  function matchInto(dst, name, el, L, buf, bands) {
    layout(name, el, L);
    shapes[name].eval(buf, L, time, reduced);
    if (bands) {
      orderByBands(X, Y, N, ordSrc);
      orderByBands(buf.x, buf.y, N, ordDst);
    } else {
      const src = currentCentre();
      orderByKey(X, Y, src.cx, src.cy, N, ordSrc, keyAng, keyRad);
      orderByKey(buf.x, buf.y, L.cx, L.cy, N, ordDst, keyAng, keyRad);
    }
    for (let k = 0; k < N; k++) dst[ordSrc[k]] = ordDst[k];
  }

  function currentCentre() {
    const name = blendS >= 0.5 ? held.to : held.from;
    const el = blendS >= 0.5 ? held.toEl : held.fromEl;
    return layout(name || scene.from, el, LTMP);
  }

  // The assignment already held for this shape, if any. Every floor section
  // shares one lattice, so a floor keeps each particle on its node.
  function heldAssignment(name, el) {
    if (name === held.from && (name !== 'point' || el === held.fromEl)) return asA;
    if (name === held.to && (name !== 'point' || el === held.toEl)) return asB;
    // grid <-> wave share the lattice: keep each particle on its cell
    if (LATTICE_SHAPES[name]) {
      if (LATTICE_SHAPES[held.from]) return asA;
      if (LATTICE_SHAPES[held.to]) return asB;
    }
    return null;
  }

  // On a new (from, to) pair, reuse assignments the particles already hold
  // and match fresh ones against where the particles are right now.
  function adoptPair() {
    const { from, to, fromEl, toEl } = scene;
    if (from === held.from && to === held.to && fromEl === held.fromEl && toEl === held.toEl) return false;
    const same = from === to && fromEl === toEl;
    const srcA = heldAssignment(from, fromEl);
    const srcB = same ? null : heldAssignment(to, toEl);
    const bands = !!(FLAT_SHAPES[from] && FLAT_SHAPES[to] && !(LATTICE_SHAPES[from] && LATTICE_SHAPES[to]));
    if (srcA) poolA.set(srcA.subarray(0, N)); else matchInto(poolA, from, fromEl, LA, bufA, bands);
    if (same) poolB.set(poolA.subarray(0, N));
    else if (srcB) poolB.set(srcB.subarray(0, N));
    else matchInto(poolB, to, toEl, LB, bufB, bands);
    let t = asA; asA = poolA; poolA = t;
    t = asB; asB = poolB; poolB = t;
    held = { from, to, fromEl, toEl };
    rest.el = null;
    if (!same) computeDelays(from, to, fromEl, toEl);
    return true;
  }

  // Stagger for a new pair: part hash, part a centre-out sweep over the
  // target (over the source when the target is a point), so the new shape
  // forms from its core while the old outline lingers — as in the reference.
  function computeDelays(from, to, fromEl, toEl) {
    if (from === 'point' && to === 'point') { delay.fill(0, 0, N); return; }
    if (from === 'floor' && to === 'floor') { delay.fill(0, 0, N); return; } // a camera glide
    if (FLAT_SHAPES[from] && FLAT_SHAPES[to] && !(LATTICE_SHAPES[from] && LATTICE_SHAPES[to])) {
      // band-paired planes: the top rows lead, so the plane tips up (or lays
      // down) as one sheet instead of scattering
      layout(to, toEl, LB); shapes[to].eval(bufB, LB, time, false);
      let y0 = Infinity, y1 = -Infinity;
      for (let j = 0; j < N; j++) { const y = bufB.y[asB[j]]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const k = 1 / Math.max(1, y1 - y0);
      for (let j = 0; j < N; j++) delay[j] = 0.85 * (bufB.y[asB[j]] - y0) * k + 0.15 * jitter[j];
      return;
    }
    if (LATTICE_SHAPES[from] && LATTICE_SHAPES[to]) {
      const cols = lat.cols, rowsM1 = Math.max(1, lat.rows - 1);
      for (let j = 0; j < N; j++) {
        const c = lat.cell[asA[j]], row = (c - (c % cols)) / cols / rowsM1;
        delay[j] = 0.72 * row + 0.28 * jitter[j]; // the lattice tilts from the top row down
      }
      return;
    }
    const onSource = to === 'point';
    let xs = X, ys = Y, cx, cy;
    if (onSource) { layout(from, fromEl, LTMP); cx = LTMP.cx; cy = LTMP.cy; }
    else { layout(to, toEl, LB); shapes[to].eval(bufB, LB, time, false); xs = bufB.x; ys = bufB.y; cx = LB.cx; cy = LB.cy; }
    let maxD = 1e-3;
    for (let j = 0; j < N; j++) {
      const i = onSource ? j : asB[j], dx = xs[i] - cx, dy = ys[i] - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      delay[j] = d;
      if (d > maxD) maxD = d;
    }
    for (let j = 0; j < N; j++) delay[j] = 0.62 * (delay[j] / maxD) + 0.38 * jitter[j];
  }

  // ---------------------------------------------------------- scene input
  function setScene(from, to, blend, fromEl, toEl) {
    const f = known(from) || scene.from, t = known(to) || f;
    scene.from = f; scene.to = t;
    scene.fromEl = fromEl || sectionFor(f);
    scene.toEl = t === f && !toEl ? scene.fromEl : toEl || sectionFor(t);
    scene.blend = f === t && scene.fromEl === scene.toEl ? 0 : clamp01(+blend || 0);
  }

  function progressFromDom() {
    const secs = document.querySelectorAll('section.scene');
    if (!secs.length) return;
    const c = H / 2;
    let active = secs[0];
    for (let i = 0; i < secs.length; i++) {
      const rc = secs[i].getBoundingClientRect();
      if (rc.top <= c && rc.bottom > c) active = secs[i];
      if (i < secs.length - 1) {
        const top = secs[i + 1].getBoundingClientRect().top;
        const bl = (c + MORPH_START * H - top) / (MORPH_SPAN * H);
        if (bl > 0 && bl < 1) {
          setScene(secs[i].dataset.scene, secs[i + 1].dataset.scene, bl, secs[i], secs[i + 1]);
          return;
        }
      }
    }
    setScene(active.dataset.scene, active.dataset.scene, 0, active, active);
  }

  // The first section rests a little into its morph window (the hero is one
  // screen tall, so the next top already sits inside it at scroll 0). Its
  // morph is re-based to start from that rest blend.
  const rest = { el: null, to: null, b0: 0 };
  function restBlend(b) {
    if (rest.el !== scene.fromEl || rest.to !== scene.toEl) {
      rest.el = scene.fromEl; rest.to = scene.toEl; rest.b0 = 0;
      const first = document.querySelector('section.scene');
      if (first && scene.fromEl === first && scene.toEl && scene.toEl !== first) {
        const vh = window.innerHeight || H;
        const top = scene.toEl.getBoundingClientRect().top + window.scrollY;
        const b0 = clamp01((MORPH_START - (top - vh / 2) / vh) / MORPH_SPAN);
        rest.b0 = b0 < 0.5 ? b0 : 0;
      }
    }
    return rest.b0 > 0 ? clamp01((b - rest.b0) / (1 - rest.b0)) : b;
  }

  // --------------------------------------------------------------- frame
  // Fisheye factor for a flat-grid endpoint in transit: the grid bulges as if
  // wrapped on a sphere and flattens as the particle lands (reference 5.9 s).
  function bulge(dx, dy, w) {
    const r = Math.sqrt(dx * dx + dy * dy) / fishR;
    if (r < 1e-4) return 1 + 0.6 * w * 0.5708;
    return 1 + 0.6 * w * (Math.sin(Math.min(r, 1) * 1.5708) / r - 1);
  }
  let fishR = 1;

  // together: every particle on the same eased blend (point to point, and
  // floor to floor, where one lattice glides from one camera to the next).
  function mixParticles(morph, b, pointA, pointB, fishA, fishB, glide) {
    const together = (pointA && pointB) || glide;
    const gcx = W / 2, gcy = H / 2;
    fishR = 0.5 * Math.hypot(W, H);
    const ax = bufA.x, ay = bufA.y, ar = bufA.r, aa = bufA.a, at = bufA.t;
    const bx = bufB.x, by = bufB.y, br = bufB.r, ba = bufB.a, bt = bufB.t;
    const pcx = pointB ? LB.cx : LA.cx, pcy = pointB ? LB.cy : LA.cy;
    const spiral = (pointA || pointB) && !(pointA && pointB);
    for (let j = 0; j < N; j++) {
      const ia = asA[j];
      if (!morph) {
        X[j] = ax[ia]; Y[j] = ay[ia]; R[j] = ar[ia]; A[j] = aa[ia]; T[j] = at[ia]; TJ[j] = 0;
        continue;
      }
      const ib = asB[j];
      const u = together ? b : (b - delay[j] * STAGGER) / SPAN;
      const t = u <= 0 ? 0 : u >= 1 ? 1 : easeInOutCubic(u);
      let x0 = ax[ia], y0 = ay[ia], x1 = bx[ib], y1 = by[ib];
      if (fishB && t < 1) { const dx = x1 - gcx, dy = y1 - gcy, g = bulge(dx, dy, 1 - t); x1 = gcx + dx * g; y1 = gcy + dy * g; }
      if (fishA && t > 0) { const dx = x0 - gcx, dy = y0 - gcy, g = bulge(dx, dy, t); x0 = gcx + dx * g; y0 = gcy + dy * g; }
      let x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (spiral && t > 0 && t < 1) {
        const th = 1.25 * Math.sin(Math.PI * t) * (pointB ? 1 : -1);
        const c = Math.cos(th), s = Math.sin(th), dx = x - pcx, dy = y - pcy;
        x = pcx + dx * c - dy * s; y = pcy + dx * s + dy * c;
      }
      X[j] = x; Y[j] = y;
      R[j] = ar[ia] + (br[ib] - ar[ia]) * t;
      A[j] = aa[ia] + (ba[ib] - aa[ia]) * t;
      T[j] = t > 0.5 ? bt[ib] : at[ia];
      TJ[j] = t;
    }
  }

  function drawDots(xs, ys, rs, as, ts, n, mul) {
    bCount.fill(0);
    for (let i = 0; i < n; i++) {
      const a = as[i], r = rs[i], x = xs[i], y = ys[i];
      if (a < 0.07 || r < 0.3 || x < -r - 2 || y < -r - 2 || x > W + r + 2 || y > H + r + 2) { bucketOf[i] = 255; continue; }
      const bk = levelOf(a) * TONES + ts[i];
      bucketOf[i] = bk; bCount[bk]++;
    }
    // faint levels first so nearer, opaque dots paint over them
    let acc = 0;
    for (let lv = LEVELS - 1; lv >= 0; lv--) {
      for (let q = 0; q < TONES; q++) { const bk = lv * TONES + TONE_ORDER[q]; bStart[bk] = acc; acc += bCount[bk]; }
    }
    bFill.set(bStart);
    for (let i = 0; i < n; i++) { const bk = bucketOf[i]; if (bk !== 255) order[bFill[bk]++] = i; }
    for (let lv = LEVELS - 1; lv >= 0; lv--) {
      for (let q = 0; q < TONES; q++) {
        const bk = lv * TONES + TONE_ORDER[q], cnt = bCount[bk];
        if (!cnt) continue;
        ctx.globalAlpha = LEVEL_ALPHA[lv] * mul;
        ctx.fillStyle = toneStr[TONE_ORDER[q]];
        ctx.beginPath();
        const s0 = bStart[bk];
        for (let k = s0; k < s0 + cnt; k++) {
          const i = order[k], x = xs[i], y = ys[i], r = rs[i];
          if (r < 0.9) ctx.rect(x - r, y - r, r * 2, r * 2);
          else { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Streaks for particles in transit, one stroke per tone and width class.
  function drawStreaks(dt, mul) {
    const k60 = 1 / Math.max(dt * 60, 0.25);
    sCount.fill(0);
    let any = 0;
    for (let i = 0; i < N; i++) {
      streakOf[i] = 255;
      const t = TJ[i];
      if (t <= 0.02 || t >= 0.98 || A[i] < 0.2) continue;
      const dx = (X[i] - PX[i]) * k60, dy = (Y[i] - PY[i]) * k60;
      if (dx * dx + dy * dy < 6.25) continue;
      const r = R[i], wc = r < 1.8 ? 0 : r < 3.2 ? 1 : 2;
      const sk = T[i] * 3 + wc;
      streakOf[i] = sk; sCount[sk]++; any++;
    }
    if (!any) return;
    let acc = 0;
    for (let sk = 0; sk < TONES * 3; sk++) { sStart[sk] = acc; acc += sCount[sk]; }
    sFill.set(sStart);
    for (let i = 0; i < N; i++) { const sk = streakOf[i]; if (sk !== 255) sOrder[sFill[sk]++] = i; }
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.35 * mul;
    for (let sk = 0; sk < TONES * 3; sk++) {
      const cnt = sCount[sk];
      if (!cnt) continue;
      ctx.strokeStyle = toneStr[(sk / 3) | 0];
      ctx.lineWidth = STREAK_R[sk % 3] * 1.2; // ≈ .6 × dot diameter
      ctx.beginPath();
      for (let k = sStart[sk]; k < sStart[sk] + cnt; k++) {
        const i = sOrder[k];
        let dx = (X[i] - PX[i]) * 1.6, dy = (Y[i] - PY[i]) * 1.6;
        const len = Math.hypot(dx, dy);
        if (len > 90) { dx *= 90 / len; dy *= 90 / len; }
        ctx.moveTo(X[i] - dx, Y[i] - dy);
        ctx.lineTo(X[i], Y[i]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPoint(L, w) {
    if (w <= 0.001) return;
    ctx.globalAlpha = 1;
    ctx.fillStyle = toneStr[T_HI];
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, Math.max(0.1, L.ar * w), 0, TAU);
    ctx.fill();
  }

  // The floor reports its camera pitch as ROT and every dot it draws
  // (particles + mesh dots).
  function emitReadout(now, name) {
    // Live frames are throttled to ~10/s. Still frames only come on a change
    // and may be the last for a while, so they always report (deduped below).
    if (!reduced && now - readoutAt < 100) return;
    readoutAt = now;
    let deg, count = N;
    if (name === 'floor') {
      deg = fl.tilt / DEG; count = fl.nP + fl.nX;
    } else {
      deg = ((((shapes[name].rot(time) * 180) / Math.PI) % 360) + 360) % 360;
    }
    const rot = Math.round(deg * 10) / 10;
    const key = `${name}|${rot}|${count}`;
    if (key === lastReadout && reduced) return;
    lastReadout = key;
    window.dispatchEvent(new CustomEvent('dots:readout', {
      detail: { shape: name.toUpperCase(), rot, count, rotLabel: 'ROT', mode: '', saved: 0 },
    }));
  }

  // Adaptive count. Each 1 s window is judged by its median frame interval,
  // so one-off stalls from other code (layout, GC) do not count, and windows
  // where the engine only draws the point are skipped. A drop is a trial: if
  // the next two windows are not clearly faster (a display capped at 30 Hz,
  // say), it is undone and adapting stops. 10 s of smooth frames undo a drop.
  function trackFps(now) {
    if (!fpsT0) { fpsT0 = fpsPrev = now; fpsN = 0; return; }
    if (fpsN < frameLog.length) frameLog[fpsN++] = now - fpsPrev;
    fpsPrev = now;
    const el = now - fpsT0;
    if (el < 1000) return;
    frameSort.set(frameLog.subarray(0, fpsN));
    fpsLast = 1000 / Math.max(1, frameSort.subarray(0, fpsN).sort()[fpsN >> 1]);
    fpsT0 = now; fpsN = 0;
    if (fpsWarm > 0) { fpsWarm--; return; }
    if (adaptLocked || pendingN) return;
    if ((blendS > 0.5 ? scene.to : scene.from) === 'point') { fpsLow = 0; adaptGoodMs = 0; return; }
    adapt(fpsLast, el);
  }

  function adapt(fps, ms) {
    if (adaptTrial) {
      if (fps >= adaptTrial.fps * 1.2) {
        // Fewer particles helped. Dropping again after a recovery: stay put.
        if (adaptRecovered) adaptLocked = true;
        adaptTrial = null;
      } else if (--adaptTrial.left <= 0) {
        adaptScale = adaptTrial.scale; drops--;
        adaptTrial = null; adaptLocked = true;
        pendingN = targetCount();
      }
      return;
    }
    if (fps < 45) {
      adaptGoodMs = 0;
      if (++fpsLow >= 2 && drops < 2) {
        fpsLow = 0; drops++;
        adaptTrial = { scale: adaptScale, fps, left: 2 };
        adaptScale *= 0.7;
        pendingN = targetCount();
      }
      return;
    }
    fpsLow = 0;
    adaptGoodMs = drops && fps >= 55 ? adaptGoodMs + ms : 0;
    if (adaptGoodMs >= 10000) {
      adaptGoodMs = 0; drops--; adaptRecovered = true;
      adaptScale = Math.min(1, adaptScale / 0.7);
      pendingN = targetCount();
    }
  }

  // setCount() re-seats every particle, which would show as a jump while a
  // morph is still catching up with the scroll; a new count waits until the
  // drawn blend is at rest (it may rest mid-window, e.g. at the page top).
  function applyPendingCount() {
    if (!pendingN || blendS !== scene.blend) return;
    if (pendingN !== N) setCount(pendingN);
    pendingN = 0;
    fpsT0 = 0; fpsWarm = 1;
  }

  function updateFocus(dt) {
    const active = performance.now() - pointer.at < 4000;
    const tx = active ? pointer.x : W * (0.5 + 0.26 * Math.sin(time * 0.23));
    const ty = active ? pointer.y : H * (0.64 + 0.14 * Math.sin(time * 0.31 + 1));
    if (!focus.init) { focus.x = tx; focus.y = ty; focus.init = true; return; }
    const k = 1 - Math.exp(-dt * 5);
    focus.x += (tx - focus.x) * k; focus.y += (ty - focus.y) * k;
  }

  function frame(now) {
    raf = 0;
    if (!alive) return;
    const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 1 / 60;
    last = now;
    // Width changes are debounced. A height-only change (the mobile URL bar)
    // applies at once: the canvas box has already changed size, so waiting
    // would show the old bitmap stretched.
    if (needResize && (now - resizeAt > 140 || (canvas.clientWidth === W && Math.abs(canvas.clientHeight - H) < H * 0.25))) applySize();
    applyPendingCount();
    if (needColors) readColors();
    if (needFloor) { needFloor = false; dataCache.clear(); anchorCache = new WeakMap(); docAnchors.clear(); buildFloor(); }
    if (domDirty) { domDirty = false; progressFromDom(); }

    if (reduced) renderStill(now, dt);
    else renderLive(now, dt);

    if (!reduced || rx.f < 1 || needResize) schedule();
  }

  function renderLive(now, dt) {
    time += dt;
    const pairChanged = adoptPair();
    const k = 1 - Math.exp(-dt * 14);
    blendS = pairChanged ? scene.blend : blendS + (scene.blend - blendS) * k;
    if (Math.abs(scene.blend - blendS) < 1e-4) blendS = scene.blend;

    const { from, to, fromEl, toEl } = scene;
    const b = from === to && fromEl === toEl ? 0 : restBlend(blendS);
    const morph = b > 0;
    if (from === 'grid' || (morph && to === 'grid')) simGrid(dt);
    if (from === 'wave' || (morph && to === 'wave')) updateFocus(dt);

    layout(from, fromEl, LA);
    if (morph) layout(to, toEl, LB);
    const fA = from === 'floor', fB = morph && to === 'floor';
    if (fA || fB) {
      const onA = fA && (!fB || b < 0.5);
      floorFrame(dt, now, onA ? LA.cam : LB.cam, fA && fB ? true : fA ? b < 0.5 : b >= 0.5);
    }
    shapes[from].eval(bufA, LA, time, false);
    if (morph) shapes[to].eval(bufB, LB, time, false);
    const fishA = morph && from === 'grid' && !FLAT_SHAPES[to];
    const fishB = morph && to === 'grid' && !FLAT_SHAPES[from];
    mixParticles(morph, b, from === 'point', morph && to === 'point', fishA, fishB, fA && fB);

    const e = morph ? easeInOutCubic(b) : 0;
    const mul = alphaMul(fromEl) + (alphaMul(toEl) - alphaMul(fromEl)) * e;
    ctx.clearRect(0, 0, W, H);
    if (fA || fB) drawFloorBack(fA, fB, b, mul);
    if (morph) drawStreaks(dt, mul);
    drawDots(X, Y, R, A, T, N, mul);
    if (from === 'point' && morph && to === 'point') {
      // one dot travelling between two anchors
      const kk = easeInOutCubic(b);
      LTMP.cx = LA.cx + (LB.cx - LA.cx) * kk; LTMP.cy = LA.cy + (LB.cy - LA.cy) * kk;
      LTMP.ar = LA.ar + (LB.ar - LA.ar) * kk;
      drawPoint(LTMP, 1);
    } else {
      if (from === 'point') drawPoint(LA, morph ? 1 - easeInOutCubic(clamp01(b / 0.7)) : 1);
      if (morph && to === 'point') drawPoint(LB, easeInOutCubic(clamp01((b - 0.3) / 0.7)));
    }

    PX.set(X.subarray(0, N)); PY.set(Y.subarray(0, N));
    emitReadout(now, b > 0.5 && morph ? to : from);
    trackFps(now);
  }

  // Reduced motion: still shapes, 250 ms crossfade between scenes. The floor
  // lies flat, with any resting dimples drawn static.
  function renderStill(now, dt) {
    const toSide = scene.blend >= 0.5;
    const name = toSide ? scene.to : scene.from, el = toSide ? scene.toEl : scene.fromEl;
    if (name !== rx.cur || el !== rx.curEl) {
      rx.prev = rx.cur; rx.prevEl = rx.curEl; rx.cur = name; rx.curEl = el;
      rx.f = rx.prev ? 0 : 1;
    } else if (rx.f < 1) {
      rx.f = Math.min(1, rx.f + dt / 0.25);
    }
    time = POSE_TIME;
    ctx.clearRect(0, 0, W, H);
    if (rx.f < 1 && rx.prev) {
      layout(rx.prev, rx.prevEl, LA);
      shapes[rx.prev].eval(bufA, LA, time, true);
      const m = alphaMul(rx.prevEl) * (1 - rx.f);
      if (rx.prev === 'floor') { drawFar(LA.cam, m); drawDots(LA.ex.x, LA.ex.y, LA.ex.r, LA.ex.a, LA.ex.t, LA.nx, m); }
      drawDots(bufA.x, bufA.y, bufA.r, bufA.a, bufA.t, N, m);
      if (rx.prev === 'point') drawPoint(LA, 1 - rx.f);
    }
    layout(name, el, LB);
    shapes[name].eval(bufB, LB, time, true);
    const m = alphaMul(el) * rx.f;
    if (name === 'floor') {
      fl.tilt = LB.cam.th;
      drawFar(LB.cam, m);
      drawDots(LB.ex.x, LB.ex.y, LB.ex.r, LB.ex.a, LB.ex.t, LB.nx, m);
    }
    drawDots(bufB.x, bufB.y, bufB.r, bufB.a, bufB.t, N, m);
    if (name === 'point') drawPoint(LB, rx.f);
    // keep the live path's bookkeeping sensible if motion is re-enabled
    for (let i = 0; i < N; i++) { X[i] = PX[i] = bufB.x[i]; Y[i] = PY[i] = bufB.y[i]; }
    held = { from: name, to: name, fromEl: el, toEl: el };
    for (let i = 0; i < N; i++) { asA[i] = i; asB[i] = i; }
    blendS = 0;
    emitReadout(now, name);
  }

  function schedule() {
    if (!raf && alive && !document.hidden) raf = requestAnimationFrame(frame);
  }

  // -------------------------------------------------------------- events
  const on = [];
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); on.push([target, type, fn, o]); };

  listen(window, 'scene:progress', (e) => {
    const d = (e && e.detail) || {};
    sawProgress = true;
    setScene(d.from, d.to, d.blend, d.fromEl, d.toEl);
    schedule();
  });
  listen(window, 'scene:change', (e) => {
    const d = (e && e.detail) || {};
    needColors = true;
    if (!sawProgress && known(d.scene)) setScene(d.scene, d.scene, 0, d.el, d.el);
    schedule();
  });
  listen(window, 'motion:change', (e) => {
    const next = !!(e && e.detail && e.detail.reduced);
    if (next === reduced) return;
    reduced = next;
    rx.cur = ''; rx.prev = ''; rx.f = 1;
    lat.heat.fill(0);
    for (const rp of ripples) rp.on = false;
    resetFloorMotion(!reduced);
    if (!reduced) { held = { from: '', to: '', fromEl: null, toEl: null }; snapToScene(); last = 0; }
    schedule();
  });
  listen(window, 'resize', () => { resizeAt = performance.now(); needResize = true; schedule(); }, { passive: true });
  listen(window, 'scroll', () => { if (!sawProgress) { domDirty = true; schedule(); } }, { passive: true });

  // Impacts ring whichever of the floor and the grid is on screen.
  listen(window, 'floor:ripple', (e) => {
    const d = (e && e.detail) || {};
    const x = +d.x, y = +d.y, str = d.strength == null ? 1 : +d.strength;
    if (reduced || !isFinite(x) || !isFinite(y) || !(str > 0)) return;
    const morphing = !(scene.from === scene.to && scene.fromEl === scene.toEl) && blendS > 0;
    if (scene.from === 'floor' || (morphing && scene.to === 'floor')) floorImpact(x, y, str, +d.r || 0);
    if (scene.from === 'grid' || (morphing && scene.to === 'grid')) spawnRipple(x, y, str);
    schedule();
  });
  listen(window, 'floor:contact', (e) => {
    const d = (e && e.detail) || {};
    if (!d.off && !(isFinite(+d.x) && isFinite(+d.y))) return;
    floorContact(d);
    schedule();
  });

  const onPointer = (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.at = performance.now();
    pointer.touch = e.pointerType === 'touch'; pointer.inView = true;
  };
  listen(window, 'pointermove', onPointer, { passive: true });
  listen(window, 'pointerdown', (e) => {
    onPointer(e);
    if (e.isPrimary) pointer.down = true;
    if (reduced) return;
    const dom = blendS > 0.5 ? scene.to : scene.from;
    if (dom === 'grid') spawnRipple(e.clientX, e.clientY, 1);
    else if (dom === 'floor' && !pointer.touch) floorImpact(e.clientX, e.clientY, 0.4, 0);
  }, { passive: true });
  listen(window, 'pointerup', (e) => { if (e.isPrimary) pointer.down = false; }, { passive: true });
  listen(window, 'pointercancel', () => { pointer.down = false; }, { passive: true });
  listen(document.documentElement, 'pointerleave', () => { pointer.inView = false; });
  listen(window, 'blur', () => { pointer.inView = false; pointer.down = false; });
  listen(document, 'visibilitychange', () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; }
    else { last = 0; fpsT0 = 0; fpsWarm = 1; schedule(); }
  });

  const themeWatch = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { needColors = true; schedule(); })
    : null;
  if (themeWatch) themeWatch.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });

  // ------------------------------------------------------------ floor API
  // For DOM that stands on the floor. `el` picks the floor section whose
  // camera to use (any element inside it works); by default the floor on
  // screen, else the first floor section. `out` objects are optional and
  // save an allocation per call.
  const floorApi = {
    // {f, perspective, pitch (rad), pitchDeg, cameraHeight, cx, cy, horizon,
    //  shift, spacing, dotRadius, near, meshFar, far, meshTop, width, height}
    // cx/cy: the principal point = CSS perspective-origin; horizon, meshTop
    // (where the reactive mesh ends) are viewport rows; near/meshFar/far are
    // floor z values; spacing is the lattice pitch in world units.
    camera(el) {
      const c = setCam(ACAM, floorEl(el), true);
      const zc = camDepth(c, fl.zMeshFar, 0);
      return {
        f: c.f, perspective: c.f, pitch: c.th, pitchDeg: c.th / DEG, cameraHeight: c.hc,
        cx: c.cx, cy: c.cy, horizon: c.hy, shift: c.shift,
        spacing: fl.p, dotRadius: fl.rw * c.dot, near: fl.zStart, meshFar: fl.zMeshFar, far: fl.zFar,
        meshTop: c.cy - (fl.zMeshFar * c.st - c.hc * c.ct) * (c.f / Math.max(1, zc)),
        width: W, height: H,
      };
    },
    // Floor point (x, z) at height y (default 0) -> {x, y, s, depth} in
    // viewport px, s = px per world unit there; null behind the camera.
    toScreen(x, z, y = 0, el, out) {
      const c = setCam(ACAM, floorEl(el), true);
      const dy = (+y || 0) - c.hc, yc = dy * c.ct + z * c.st, zc = z * c.ct - dy * c.st;
      if (!(zc > 1e-3)) return null;
      const s = c.f / zc, o = out || {};
      o.x = c.cx + x * s; o.y = c.cy - yc * s; o.s = s; o.depth = zc;
      return o;
    },
    // Viewport point -> floor {x, z}; null at or above the horizon.
    toFloor(sx, sy, el, out) {
      const c = setCam(ACAM, floorEl(el), true);
      return camGround(c, sx, sy, out || {});
    },
    // The mesh's current height (world units, negative = pressed in).
    heightAt(x, z) {
      if (!fl.S) return 0;
      const h = reduced ? staticHeights() : fl.u;
      const cc = x / fl.p, rc = (z - fl.zStart) / fl.p + fl.spn;
      const c0 = Math.floor(cc), r0 = Math.floor(rc), fx = cc - c0, fz = rc - r0;
      const at = (rr, c) => { const i = nodeAt(rr, c); return i < 0 ? 0 : h[i]; };
      const a = at(r0, c0) + (at(r0, c0 + 1) - at(r0, c0)) * fx;
      const b = at(r0 + 1, c0) + (at(r0 + 1, c0 + 1) - at(r0 + 1, c0)) * fx;
      return a + (b - a) * fz;
    },
    // CSS matrix3d that stands an element upright on the floor at (x, z),
    // facing the camera: local (u right, v down, w toward the viewer) in CSS
    // px around its transform-origin, 1 px = k world units (default 1).
    // opts.ox/oy: the transform-origin's untransformed viewport position.
    // Append rotateX(90deg) to lay it flat, top away from the viewer.
    // No perspective may be set on its ancestors.
    cssMatrix(x, z, opts) {
      const o = opts || {};
      const c = setCam(ACAM, floorEl(o.el), true);
      const k = o.k > 0 ? +o.k : 1, ox = +o.ox || 0, oy = +o.oy || 0;
      const a = c.cx - ox, bq = c.cy - oy, f = c.f, ct = c.ct, st = c.st;
      const zc0 = z * ct + c.hc * st, yc0 = z * st - c.hc * ct;
      if (!(zc0 > 1e-3)) return 'none';
      const n = 1 / zc0;
      const m = [
        f * k, 0, 0, 0,
        (a * k * st) * n, (bq * k * st + f * k * ct) * n, (-k * st) * n, (k * st) * n,
        (-a * k * ct) * n, (-bq * k * ct + f * k * st) * n, (k * ct) * n, (-k * ct) * n,
        (a * zc0 + f * x) * n, (bq * zc0 - f * yc0) * n, (f - zc0) * n, 1,
      ];
      m[0] *= n;
      return `matrix3d(${m.map((v) => +v.toFixed(7)).join(',')})`;
    },
    // Re-read data-floor-* (after changing them) and rebuild the lattice.
    refresh() { needFloor = true; schedule(); },
  };
  window.dotsFloor = floorApi;

  // ---------------------------------------------------------------- boot
  const first = document.querySelector('section.scene');
  if (first && known(first.dataset.scene)) setScene(first.dataset.scene, first.dataset.scene, 0, first, first);
  W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
  progressFromDom();
  readColors();
  applySize();
  schedule();

  // The engine now paints the point anchors' discs: CSS drops its own fill.
  document.documentElement.classList.add('dots-live');

  const api = {
    get count() { return N; },
    get fps() { return fpsLast; },
    get reduced() { return reduced; },
    destroy() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      for (const [t, type, fn, o] of on) t.removeEventListener(type, fn, o);
      if (themeWatch) themeWatch.disconnect();
      ctx.clearRect(0, 0, W, H);
      document.documentElement.classList.remove('dots-live');
      if (window.dotsFloor === floorApi) delete window.dotsFloor;
      delete canvas.__dots;
    },
  };
  canvas.__dots = api;
  return api;
}

export default init;
