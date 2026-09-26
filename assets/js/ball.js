// The red ball.
//
// One flat ball (a solid red disc, one small flat highlight and a flat offset
// shadow) that the hero, the projects catalogue and the hackathons pass
// between them. The section on screen owns it: its controller, registered by
// section id, places it every frame. This module draws it, squashes it on
// landings, leaves faint outline ghosts along its arcs, draws a thin ring
// where it lands and tells the dot floor about it:
//   floor:ripple  {x, y, strength, r}          once per landing
//   floor:contact {id: 'ball', x, y, r, depth}  while it rests on the floor
//   floor:contact {id: 'ball', off: true}      when it leaves
//
// Hosts. The ball lives in a layer inside whatever it stands on, so it
// scrolls natively with it instead of chasing the page a frame late: the page
// layer (in <main>) for the hero and the hackathons, the catalogue's sticky
// stage for projects. Poses are in that layer's px.
//
// When no section owns it, it drops off the bottom of the screen and hides:
// a fall in viewport terms (the scroll does not carry it), from its own
// velocity, until it has left the screen.
// Reduced motion (html.reduced): no ball; the headings show a static CSS
// period instead (.ball-period in site.css).
//
// Controller contract (register(sectionId, ctrl)):
//   ctrl.frame(now, B) → place the ball with B.place(pose), or B.idle() /
//                        B.hide(); return true while it needs more frames
//   ctrl.enter(from)   → optional; the section became active. `from` is the
//                        ball's viewport pose {x, y, r, gx, gy} if it is on
//                        screen, else null
//   ctrl.leave()       → optional; another section took over
// A pose: {layer, x, y, r, gx, gy, air, floor, rest, ox?, oy?, fixed?}: ball
// centre (x, y) and radius r, its ground point (gx, gy) and height above it
// (air), all in layer px; floor = it stands on the dot floor; rest = touching
// the ground and not moving; ox/oy = the layer's viewport origin if the
// controller already knows it (saves a layout read); fixed = the controller
// moves the ball in viewport terms (it adds the scroll itself), so the ball's
// own velocity is its viewport velocity, not its velocity in the layer.

const BASE = 64;              // px: the drawn size of the body and shadow before scaling
const HALF = BASE / 2;
const RING_MS = 700;
const GHOST_MS = 420;
const SQUASH_MS = 320;
const DROP_G = 2600;          // px/s², falling away when no section owns the ball
const DROP_MAX_MS = 3000;     // a fall never lasts longer (it is off screen long before)
const DROP_SHADOW_MS = 220;   // the shadow fades as the ball leaves the ground

const ctrls = new Map();
const root = typeof document !== 'undefined' ? document.documentElement : null;
let alive = false;
let reduced = false;
let raf = 0;
let activeId = '';
let ctrl = null;

let pageLayer = null;
const pageOff = { x: 0, y: 0 };
let ballEl = null;
let bodyEl = null;
let shadowEl = null;
let layer = null;

// The last placed pose, in layer px. vx/vy: the ball's own velocity (px/s),
// in the layer, or in the viewport for a `fixed` pose; shK: shadow opacity.
const cur = { vis: false, x: 0, y: 0, r: 10, gx: 0, gy: 0, air: 0, floor: false, rest: false, ox: NaN, oy: NaN, vx: 0, vy: 0, shK: 1 };
const written = { body: '', shadow: '', shadowOp: '', vis: null };
// Velocity tracking: the previous position in the frame of reference it was
// measured in, and when (the rAF time of the frame that placed it).
// For a fixed pose, ox/oy: the layer's viewport origin when it was placed.
const prev = { at: -1, x: 0, y: 0, ox: 0, oy: 0, fixed: false, layer: null };
let tick = 0;                 // this frame's rAF time while controllers run, else 0

let squashAt = -1e9;
let squashAmp = 0;
let contact = { on: false, x: 0, y: 0, r: 0 };
let drop = null;              // falling away, viewport px: {t0, x0, y0, gy0, vx, vy0}
let lastGhost = null;         // {x, y, t}
const rings = [];
const ghosts = [];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ------------------------------------------------------------------ layers

function makeLayer(extraClass) {
  const el = document.createElement('div');
  el.className = `ball-layer${extraClass ? ` ${extraClass}` : ''}`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// A layer for another host (the catalogue's sticky stage).
export function createLayer(host) {
  const el = makeLayer('ball-layer--host');
  host.appendChild(el);
  return el;
}

export function getPageLayer() {
  return pageLayer;
}

function measurePage() {
  if (!pageLayer) return;
  const r = pageLayer.getBoundingClientRect();
  pageOff.x = r.left + window.scrollX;
  pageOff.y = r.top + window.scrollY;
}

// Page px → page-layer px, and back.
export function toLayer(x, y, out = {}) {
  out.x = x - pageOff.x;
  out.y = y - pageOff.y;
  return out;
}

// The viewport position of a layer's origin.
function originOf(l, out) {
  if (l === pageLayer) {
    out.x = pageOff.x - window.scrollX;
    out.y = pageOff.y - window.scrollY;
  } else if (l) {
    const r = l.getBoundingClientRect();
    out.x = r.left;
    out.y = r.top;
  } else {
    out.x = 0;
    out.y = 0;
  }
  return out;
}
const O = { x: 0, y: 0 };

function attach(l) {
  if (layer === l || !ballEl) return;
  layer = l;
  l.appendChild(ballEl);
  written.body = '';
  written.shadow = '';
}

// ------------------------------------------------------------------ drawing

function setVisible(v) {
  if (written.vis === v) return;
  written.vis = v;
  ballEl.style.visibility = v ? '' : 'hidden';
}

// Squash after a landing: a damped wobble, squashed first (+), then
// stretched (−) and back.
function squashNow(now) {
  // rAF timestamps can trail performance.now() by up to a frame: clamp.
  const t = Math.max(0, now - squashAt);
  if (t > SQUASH_MS) return 0;
  return squashAmp * Math.exp(-t / 85) * Math.cos((t / 230) * Math.PI * 2);
}

function draw(now) {
  const { x, r, gx, gy } = cur;
  let { y } = cur;
  const air = Math.max(0, cur.air);
  const q = squashNow(now);
  // Stretch along the fall while in the air (vertical only, so the highlight
  // stays upper-left).
  const e = air > 0.5 ? clamp(Math.abs(cur.vy) / 3600, 0, 0.2) : 0;
  const kx = (1 + 0.42 * q) * (1 - 0.5 * e);
  const ky = (1 - 0.38 * q) * (1 + e);
  if (air < 1) y += r * (1 - ky); // squash keeps the bottom on the ground
  const s = r / HALF;
  const body = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${(s * kx).toFixed(4)},${(s * ky).toFixed(4)})`;
  if (body !== written.body) {
    written.body = body;
    bodyEl.style.transform = body;
  }
  // Flat offset shadow: an ellipse on the ground, light from the upper left.
  // It shrinks and fades as the ball rises.
  const k = 1 / (1 + air / (5 * r));
  const w = 2.1 * r * k * kx;
  const h = 0.62 * r * k;
  const sh = `translate3d(${(gx + 0.42 * r * k).toFixed(2)}px,${gy.toFixed(2)}px,0) scale(${(w / BASE).toFixed(4)},${(h / BASE).toFixed(4)})`;
  if (sh !== written.shadow) {
    written.shadow = sh;
    shadowEl.style.transform = sh;
  }
  const op = (k * k * cur.shK).toFixed(3);
  if (op !== written.shadowOp) {
    written.shadowOp = op;
    shadowEl.style.opacity = op;
  }
}

// ------------------------------------------------------------ rings, ghosts

function poolEl(pool, cls) {
  let item = pool.find((p) => !p.on);
  if (!item) {
    if (pool.length >= 8) item = pool.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    else {
      const el = document.createElement('span');
      el.className = cls;
      item = { el, on: false, t0: 0 };
      pool.push(item);
    }
  }
  return item;
}

// The ring lies on the ground: an ellipse whose height comes from the floor's
// foreshortening at the landing point (a flat 1:3 off the floor).
function ringAspect(vx, vy, r) {
  const F = window.dotsFloor;
  if (!cur.floor || !F) return 0.32;
  try {
    const p = F.toFloor(vx, vy);
    if (!p) return 0.32;
    const c = F.toScreen(p.x, p.z);
    if (!c) return 0.32;
    const R = (4 * r) / c.s;
    const a = F.toScreen(p.x, p.z - R);
    const b = F.toScreen(p.x, p.z + R);
    if (!a || !b) return 0.32;
    return clamp((a.y - b.y) / (8 * r), 0.08, 0.6);
  } catch (e) {
    return 0.32;
  }
}

function spawnRing(now, aspect) {
  const it = poolEl(rings, 'ball-ring');
  if (it.el.parentNode !== layer) layer.insertBefore(it.el, ballEl);
  it.on = true;
  it.t0 = now;
  it.x = cur.gx;
  it.y = cur.gy;
  it.r = cur.r;
  it.a = aspect;
  it.el.style.display = '';
}

function spawnGhost(now) {
  const it = poolEl(ghosts, 'ball-ghost');
  if (it.el.parentNode !== layer) layer.insertBefore(it.el, ballEl);
  it.on = true;
  it.t0 = now;
  const d = 2 * cur.r;
  it.el.style.width = `${d.toFixed(1)}px`;
  it.el.style.height = `${d.toFixed(1)}px`;
  it.el.style.transform = `translate3d(${(cur.x - cur.r).toFixed(1)}px,${(cur.y - cur.r).toFixed(1)}px,0)`;
  it.el.style.display = '';
  it.el.style.opacity = '0.5';
  lastGhost = { x: cur.x, y: cur.y, t: now };
}

function stepEffects(now) {
  let busy = false;
  for (const it of rings) {
    if (!it.on) continue;
    const e = Math.max(0, (now - it.t0) / RING_MS);
    if (e >= 1) {
      it.on = false;
      it.el.style.display = 'none';
      continue;
    }
    busy = true;
    const grow = 1 - (1 - e) ** 3;
    const rad = it.r * (1.2 + 4.6 * grow);
    const w = 2 * rad;
    const h = w * it.a;
    const st = it.el.style;
    st.width = `${w.toFixed(1)}px`;
    st.height = `${h.toFixed(1)}px`;
    st.transform = `translate3d(${(it.x - rad).toFixed(1)}px,${(it.y - h / 2).toFixed(1)}px,0)`;
    st.opacity = (0.9 * (1 - e) ** 1.6).toFixed(3);
  }
  for (const it of ghosts) {
    if (!it.on) continue;
    const e = Math.max(0, (now - it.t0) / GHOST_MS);
    if (e >= 1) {
      it.on = false;
      it.el.style.display = 'none';
      continue;
    }
    busy = true;
    it.el.style.opacity = (0.5 * (1 - e)).toFixed(3);
  }
  if (now - squashAt < SQUASH_MS) busy = true;
  return busy;
}

function clearEffects() {
  for (const it of rings.concat(ghosts)) {
    it.on = false;
    it.el.style.display = 'none';
  }
  lastGhost = null;
  squashAt = -1e9;
}

// ------------------------------------------------------------ floor events

function emit(type, detail) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function viewportOrigin() {
  if (Number.isFinite(cur.ox) && Number.isFinite(cur.oy)) {
    O.x = cur.ox;
    O.y = cur.oy;
    return O;
  }
  return originOf(layer, O);
}

function syncContact() {
  const want = cur.vis && cur.floor && cur.rest && !reduced;
  if (!want) {
    if (contact.on) {
      contact.on = false;
      emit('floor:contact', { id: 'ball', off: true });
    }
    return;
  }
  const o = viewportOrigin();
  const x = cur.gx + o.x;
  const y = cur.gy + o.y;
  if (contact.on && Math.abs(x - contact.x) < 0.4 && Math.abs(y - contact.y) < 0.4 && Math.abs(cur.r - contact.r) < 0.2) return;
  contact = { on: true, x, y, r: cur.r };
  emit('floor:contact', { id: 'ball', x, y, r: cur.r, depth: cur.r * 1.1 });
}

// The ball's own velocity, from one placed pose to the next: in the layer
// (what it stands on scrolls it; that is not its motion), or in the viewport
// for a `fixed` pose. Measured on rAF times; a gap, a new layer or a new frame
// of reference starts over from rest.
function track(fixed) {
  const t = tick || performance.now();
  let x = cur.x;
  let y = cur.y;
  if (fixed) {
    const o = viewportOrigin();
    x += o.x;
    y += o.y;
    prev.ox = o.x;
    prev.oy = o.y;
  }
  const same = cur.vis && prev.at >= 0 && prev.fixed === fixed && prev.layer === layer;
  const dt = t - prev.at;
  if (same && dt < 0.5) {
    // Placed again in the same frame: keep the latest position only.
    prev.x = x;
    prev.y = y;
    return;
  }
  if (same && dt < 120) {
    cur.vx += (((x - prev.x) / dt) * 1000 - cur.vx) * 0.6;
    cur.vy += (((y - prev.y) / dt) * 1000 - cur.vy) * 0.6;
  } else {
    cur.vx = 0;
    cur.vy = 0;
  }
  prev.at = t;
  prev.x = x;
  prev.y = y;
  prev.fixed = fixed;
  prev.layer = layer;
}

// ------------------------------------------------------------------- API

// Handed to controllers.
export const B = {
  // Place the ball this frame (see the pose notes at the top).
  place(p) {
    if (!alive || reduced) return;
    if (p.layer && p.layer !== layer) attach(p.layer);
    const now = performance.now();
    cur.x = p.x;
    cur.y = p.y;
    cur.r = p.r;
    cur.gx = p.gx == null ? p.x : p.gx;
    cur.gy = p.gy == null ? p.y + p.r : p.gy;
    cur.air = p.air == null ? Math.max(0, cur.gy - p.y - p.r) : p.air;
    cur.floor = !!p.floor;
    cur.rest = !!p.rest;
    cur.ox = p.ox == null ? NaN : p.ox;
    cur.oy = p.oy == null ? NaN : p.oy;
    cur.shK = 1;
    track(!!p.fixed);
    drop = null;
    if (!cur.vis) lastGhost = null;
    cur.vis = true;
    setVisible(true);
    // Faint outlines along the arc, one every two diameters.
    if (cur.air > cur.r * 0.6) {
      if (!lastGhost || Math.hypot(cur.x - lastGhost.x, cur.y - lastGhost.y) > 4.2 * cur.r) spawnGhost(now);
    } else if (cur.rest) lastGhost = null;
    draw(now);
    syncContact();
  },

  // A landing at the current place: squash, a thin ring on the ground and a
  // ripple through the dot floor (or the flat grid). strength ≈ .3–1.8.
  // floorK (0–1) scales what the ground gets, ring and ripple, not the squash:
  // 0 when the floor under the ball is already morphing away.
  land(strength = 1, floorK = 1) {
    if (!alive || reduced || !cur.vis) return;
    const now = performance.now();
    const s = clamp(strength, 0.2, 1.8);
    const k = clamp(floorK, 0, 1);
    squashAt = now;
    squashAmp = clamp(0.35 + 0.4 * s, 0.35, 1);
    const o = viewportOrigin();
    const vx = cur.gx + o.x;
    const vy = cur.gy + o.y;
    if (s * k >= 0.3) spawnRing(now, ringAspect(vx, vy, cur.r));
    if (s * k >= 0.05) emit('floor:ripple', { x: vx, y: vy, strength: s * k, r: cur.r });
    lastGhost = null;
    draw(now);
    schedule();
  },

  // Nothing to show: fall off the bottom of the screen if visible.
  idle() {
    if (cur.vis && !drop) startDrop(tick || performance.now());
  },

  hide() {
    drop = null;
    if (cur.vis) {
      cur.vis = false;
      setVisible(false);
    }
    syncContact();
  },

  get visible() { return cur.vis; },
  get reduced() { return reduced; },
};

// The ball's viewport pose, or null when hidden.
export function current() {
  if (!cur.vis) return null;
  const o = originOf(layer, O);
  return {
    x: cur.x + o.x, y: cur.y + o.y, r: cur.r,
    gx: cur.gx + o.x, gy: cur.gy + o.y, air: cur.air,
  };
}

export function register(id, controller) {
  ctrls.set(id, controller);
  if (id === activeId) {
    ctrl = controller;
    if (ctrl.enter) ctrl.enter(current());
  }
  schedule();
}

export function requestFrame() {
  schedule();
}

// ------------------------------------------------------------ falling away

// The fall runs in viewport px: whatever the page does under it, the ball
// only goes down the screen. It starts from the ball's own velocity (a ball
// at rest just drops; one mid-hop carries on along its arc), never with a
// kick up, and ends only once the ball is wholly off screen.
function offScreen(x, y, r) {
  const m = 1.3 * r;          // stretch and squash included
  return y - m > window.innerHeight || y + m < 0 || x - m > window.innerWidth || x + m < 0;
}

// now: this frame's rAF time.
function startDrop(now) {
  // Where the ball was last drawn: a ball placed in the layer has moved with
  // it since (the layer's origin now); one placed in viewport terms has not,
  // so it falls on from where and when it was last placed (the scroll may
  // already have moved the layer this frame).
  const kept = prev.fixed && prev.layer === layer && prev.at >= 0 && now - prev.at < 120;
  const o = kept ? { x: prev.ox, y: prev.oy } : originOf(layer, O);
  const x = cur.x + o.x;
  const y = cur.y + o.y;
  // Off screen already: just hide (never fall back through the viewport).
  if (offScreen(x, y, cur.r)) {
    B.hide();
    return;
  }
  drop = {
    t0: kept ? prev.at : now, x0: x, y0: y, gy0: cur.gy + o.y,
    vx: clamp(cur.vx, -600, 600), vy0: clamp(cur.vy, -320, 2400),
  };
  cur.rest = false;
  cur.ox = NaN;
  cur.oy = NaN;
  syncContact();
}

function stepDrop(now) {
  const t = Math.max(0, now - drop.t0) / 1000;
  const x = drop.x0 + drop.vx * t;
  const y = drop.y0 + drop.vy0 * t + 0.5 * DROP_G * t * t;
  if (offScreen(x, y, cur.r) || t * 1000 > DROP_MAX_MS) {
    B.hide();
    return false;
  }
  const o = originOf(layer, O);
  cur.x = x - o.x;
  cur.y = y - o.y;
  cur.vx = drop.vx;
  cur.vy = drop.vy0 + DROP_G * t;
  // The ground it left stays where it was on screen and its shadow fades;
  // the ball falls on past it, stretched (air stays above 0).
  cur.gx = cur.x;
  cur.gy = drop.gy0 - o.y;
  cur.air = Math.max(1, cur.gy - cur.y - cur.r);
  cur.shK = Math.max(0, 1 - (t * 1000) / DROP_SHADOW_MS);
  draw(now);
  return true;
}

// ------------------------------------------------------------------- frame

function schedule() {
  if (!raf && alive && !document.hidden) raf = requestAnimationFrame(frame);
}

function frame(now) {
  raf = 0;
  if (!alive) return;
  let busy = false;
  if (!reduced) {
    tick = now;
    if (ctrl) {
      try {
        busy = !!ctrl.frame(now, B);
      } catch (e) {
        console.warn(`[ball] ${activeId}: ${e && e.message}`);
      }
    }
    tick = 0;
    if (!ctrl && cur.vis && !drop) startDrop(now);
    if (drop) busy = stepDrop(now) || busy;
    busy = stepEffects(now) || busy;
  }
  if (busy) schedule();
}

function setActive(id, sceneName) {
  if (id === activeId) return;
  const next = ctrls.get(id) || null;
  // Skills and contact draw their own red dot (the engine's point scene):
  // the ball must never show next to it.
  if (!next && sceneName === 'point') {
    drop = null;
    B.hide();
  }
  const from = current();
  if (ctrl && ctrl.leave) {
    try { ctrl.leave(); } catch (e) { console.warn(`[ball] leave: ${e && e.message}`); }
  }
  activeId = id;
  ctrl = next;
  if (ctrl && ctrl.enter) {
    try { ctrl.enter(from); } catch (e) { console.warn(`[ball] enter: ${e && e.message}`); }
  }
  schedule();
}

function activeFromDom() {
  const secs = document.querySelectorAll('section.scene');
  const line = window.innerHeight / 2;
  let hit = null;
  secs.forEach((s) => {
    if (s.getBoundingClientRect().top <= line) hit = s;
  });
  return hit;
}

function onMotion(e) {
  const next = !!(e && e.detail ? e.detail.reduced : root.classList.contains('reduced'));
  if (next === reduced) return;
  reduced = next;
  root.classList.toggle('ball-still', reduced);
  if (reduced) {
    drop = null;
    clearEffects();
    B.hide();
  }
  schedule();
}

// ------------------------------------------------------------------- init

export function init() {
  if (alive) return;
  const main = document.querySelector('main');
  if (!main) return;
  reduced = root.classList.contains('reduced');

  pageLayer = makeLayer('ball-layer--page');
  main.appendChild(pageLayer);
  ballEl = document.createElement('div');
  ballEl.className = 'ball';
  shadowEl = document.createElement('span');
  shadowEl.className = 'ball-shadow';
  bodyEl = document.createElement('span');
  bodyEl.className = 'ball-body';
  const hi = document.createElement('span');
  hi.className = 'ball-hi';
  bodyEl.appendChild(hi);
  ballEl.append(shadowEl, bodyEl);
  attach(pageLayer);
  setVisible(false);
  alive = true;
  measurePage();

  // The headings' CSS periods give way to the ball from here on.
  root.classList.add('ball-live');

  window.addEventListener('scene:change', (e) => {
    const d = (e && e.detail) || {};
    setActive(d.id || '', d.scene || '');
  });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', () => { measurePage(); schedule(); });
  window.addEventListener('load', measurePage, { once: true });
  window.addEventListener('motion:change', onMotion);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else schedule();
  });
  if ('ResizeObserver' in window) new ResizeObserver(() => measurePage()).observe(main);

  // Before scenes.js speaks (it waits for fonts), take the section from the DOM.
  activeId = '';
  const hit = activeFromDom();
  if (hit) setActive(hit.id, hit.dataset.scene || '');
}

// ------------------------------------------------------------- hop helper

// A ballistic hop in ground terms, for the time-driven controllers. The
// ground point runs in a straight line from g0 to the target's ground point
// (the target may move: `to` is called every frame); the height above the
// ground is one parabola in time, from h0 through an apex `apex` px above
// the start down to 0. All px in one layer.
//   hop({t0, dur, g0: {x, y}, h0, r0, apex, to: () => ({gx, gy, r})})
//   .at(now, out) fills out {x, y, r, gx, gy, air, done, impact} (impact:
//   the downward speed at touchdown, px/s)
export function hop(o) {
  const h0 = Math.max(0, o.h0 || 0);
  const A = Math.max(0, o.apex || 0);
  // h(u) = a u² + b u + h0 with h(1) = 0 and a peak A above h0.
  const b = A > 0 ? 2 * A + 2 * Math.sqrt(A * A + A * h0) : 0;
  const a = -(b + h0);
  const dur = Math.max(1, o.dur);
  return {
    t0: o.t0,
    dur,
    impact: ((b + 2 * h0) / dur) * 1000,
    at(now, out) {
      const u = clamp((now - o.t0) / dur, 0, 1);
      const T = o.to();
      const gx = o.g0.x + (T.gx - o.g0.x) * u;
      const gy = o.g0.y + (T.gy - o.g0.y) * u;
      const h = Math.max(0, a * u * u + b * u + h0);
      const r = o.r0 + (T.r - o.r0) * u;
      out.gx = gx;
      out.gy = gy;
      out.r = r;
      out.air = h;
      out.x = gx;
      out.y = gy - h - r;
      out.done = u >= 1;
      return out;
    },
  };
}

// Impact speed (px/s) → floor:ripple strength.
export function strengthFor(speed) {
  return clamp(0.35 + speed / 2600, 0.35, 1.7);
}

// Fly to a target and settle there: the main hop, then small rebounds, each
// [apex in radii, duration ms]. at(now, out) fills the pose plus
// out.landed (a ripple strength on the frame a hop touches down, else 0),
// out.bounce (which touchdown that was: 0 = the main landing, 1+ = the
// rebounds) and out.rest (true once settled).
export function bounceTo(o) {
  const re = o.rebound || [[1.7, 250], [0.42, 130]];
  let i = 0;
  let h = hop({ t0: o.now, dur: o.dur, g0: { x: o.from.gx, y: o.from.gy }, h0: o.from.air || 0, r0: o.from.r, apex: o.apex || 0, to: o.to });
  let settled = false;
  return {
    at(now, out) {
      out.landed = 0;
      out.bounce = -1;
      out.rest = false;
      if (settled) {
        const T = o.to();
        out.gx = T.gx; out.gy = T.gy; out.r = T.r; out.air = 0;
        out.x = T.gx; out.y = T.gy - T.r;
        out.rest = true;
        return out;
      }
      h.at(now, out);
      while (out.done) {
        if (out.bounce < 0) out.bounce = i;
        out.landed = Math.max(out.landed, strengthFor(h.impact));
        if (i >= re.length) {
          settled = true;
          out.rest = true;
          break;
        }
        const [k, d] = re[i++];
        const T = o.to();
        h = hop({ t0: h.t0 + h.dur, dur: d, g0: { x: T.gx, y: T.gy }, h0: 0, r0: T.r, apex: k * T.r, to: o.to });
        h.at(now, out);
      }
      return out;
    },
  };
}

// Run fn at once if `section` is above the viewport or within three screens
// below it (a deep link, a reload mid-page: building may change the page's
// height above the visitor, which WebKit would not compensate); otherwise
// once the hero's intro is over and the browser is idle, or as soon as the
// visitor scrolls near it. Keeps the far sections' 3D type out of the hero's
// first seconds.
export function soon(section, fn) {
  let done = false;
  let io = null;
  const go = () => {
    if (done) return;
    done = true;
    if (io) io.disconnect();
    fn();
  };
  const r = section.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.top < 3 * vh) {
    go();
    return;
  }
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) go(); }, { rootMargin: '200% 0px' });
    io.observe(section);
  }
  setTimeout(() => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 1000 });
    else go();
  }, 2000);
}

// One idle slice (or a frame where requestIdleCallback is missing).
export function idle() {
  return new Promise((r) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => r(), { timeout: 250 });
    else setTimeout(r, 16);
  });
}

export default init;
