// Projects catalogue: a pinned, scroll-driven stage over the dot floor.
//
// The section pins (a sticky 100svh stage in a 550vh track) and shows one
// project per ~60vh of scroll. At each step the red ball arcs from the last
// landing spot to the next, lands (squash, ring, a ripple through the floor
// mesh) and that project's name stands up in 3D letters with the ball as its
// period, its tag line, description, tech and GitHub link beside it, while
// the previous name folds back down flat. Everything is a pure function of
// the scroll position, so scrolling up plays it backwards; the one timed part
// is the incoming info card, which waits CARD_WAIT ms after a touchdown so
// the landing ring runs out over open floor before the card covers it.
//
// The seven .card elements in the page stay the source of truth: this module
// builds the catalogue from their text and links (so every fact is exact) and
// the cards themselves are the plain grid shown without JS, with reduced
// motion / Pause, on very short screens, and after "See all 7".
//
// Timeline, as shares of the pinned length P (= 450vh):
//   [0, E)            entry: the ball drops onto spot 1, the first name stands
//   boundary k (1–6)  at E + k·S; the hop from spot k to k+1 spans T·S
//                     centred on it (FLY of it in the air, then the name rises)
// E = 30vh, S = 60vh, so the deep link #projects lands at s = E (CSS
// scroll-margin-top: -30vh on .cat-live) with the first project in place.

import { makeStand, fontsReady } from './stand3d.js';
import { register, createLayer, requestFrame, soon, idle } from './ball.js';

const ENTRY = 30 / 450;
const STEP = 60 / 450;
const TRANS = 0.45;
const FLY = 0.62;
const DROP = 0.55;            // share of the entry spent falling
const MIN_H = 560;            // px: shorter viewports get the grid
const HANDOFF_MS = 460;
const LAND_CALM_MS = 1000;    // a landing with this long before the next take-off (and after the last landing) gets its full strength...
const LAND_FAST_K = 0.35;     // ...a rushed one this share
const MIN_R = 7;              // px: the ball's least radius (phones' names are small; a 4 px period hides its ring)
const CARD_WAIT = 380;        // ms after a touchdown before the incoming info card fades in...
const CARD_FADE = 300;        // ...over this long, so the landing ring runs out over open floor first

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const pad2 = (n) => String(n).padStart(2, '0');
const root = typeof document !== 'undefined' ? document.documentElement : null;

let sec = null;
let track = null;
let stage = null;
let head = null;
let grid = null;
let view = null;
let layer = null;
let countEl = null;
let allBtn = null;
let oneBtn = null;
let items = [];
let dots = [];

let live = false;
let gridChosen = false;
let reduced = false;
let lastShare = -1;
let bias = 0;                 // px the horizon is lifted to keep every landing on the mesh
const geo = { top: 0, P: 1, stageH: 1, left: 0 };
let frac = 0;                 // last known s / P, kept across resizes
let curIdx = -1;
let prev = { mode: 'hidden', at: -1 };
let lastY = 0;
let lastT = 0;
let vel = 0;                  // scroll speed, px/s
let handoff = null;           // {t0, from} viewport pose to blend from
let parked = null;            // {k, y}: the project shown when we switched to the grid
let gate = null;              // {k, at}: project k's card waits for the ring of the landing at `at`
let owning = false;           // this section owns the ball (its frame applies the items)

const pose = { layer: null, x: 0, y: 0, r: 0, gx: 0, gy: 0, air: 0, floor: true, rest: false, ox: 0, oy: 0 };
const tl = { cur: 0, names: new Float32Array(7), infos: new Float32Array(7), mode: 'hidden', a: 0, b: 0, q: 0 };

// ------------------------------------------------------------------ build

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function build(cards) {
  view = el('div', 'cat-view');
  const list = el('ol', 'cat-list');
  const index = el('div', 'cat-index');
  index.setAttribute('role', 'group');
  index.setAttribute('aria-label', 'Project index');
  countEl = el('p', 'cat-count');
  countEl.setAttribute('aria-hidden', 'true');
  const dotList = el('ol', 'cat-dots');
  const n = cards.length;

  cards.forEach((card, i) => {
    const title = (card.querySelector('.card-title') || {}).textContent || `Project ${i + 1}`;
    const li = el('li', 'cat-item');
    li.dataset.side = i % 2 ? 'r' : 'l';
    const h = el('h3', 'cat-name', title.trim());
    h.setAttribute('data-stand3d', 'catalogue');
    const info = el('div', 'cat-info');
    const tag = card.querySelector('.card-tag');
    const desc = card.querySelector('.card-desc');
    const tech = card.querySelector('.card-tech');
    const link = card.querySelector('.card-link');
    if (tag) info.appendChild(el('p', 'cat-tag', tag.textContent.trim()));
    if (desc) info.appendChild(el('p', 'cat-desc', desc.textContent.trim()));
    if (tech) {
      const t = tech.cloneNode(true);
      t.className = 'cat-tech';
      info.appendChild(t);
    }
    if (link) {
      const a = link.cloneNode(true);
      a.className = 'cat-link';
      info.appendChild(a);
    }
    li.append(h, info);
    list.appendChild(li);

    const dli = el('li');
    const b = el('button', 'cat-dot');
    b.type = 'button';
    b.setAttribute('aria-label', `${title.trim()}, ${i + 1} of ${n}`);
    b.addEventListener('click', () => jumpTo(i, true));
    dli.appendChild(b);
    dotList.appendChild(dli);
    dots.push(b);
    items.push({ li, h, info, stand: null, p: -1, op: -1, spot: null });
  });

  allBtn = el('button', 'cat-all', `See all ${n}`);
  allBtn.type = 'button';
  allBtn.addEventListener('click', () => chooseGrid(true));
  index.append(countEl, dotList, allBtn);
  view.append(list, index);

  oneBtn = el('button', 'cat-one', 'One at a time');
  oneBtn.type = 'button';
  oneBtn.addEventListener('click', () => chooseGrid(false));

  head.after(view, oneBtn);

  // Keyboard: tabbing into a project that is not on stage brings it there.
  list.addEventListener('focusin', (e) => {
    if (!live) return;
    const li = e.target instanceof Element ? e.target.closest('.cat-item') : null;
    const k = items.findIndex((it) => it.li === li);
    if (k >= 0 && k !== curIdx) jumpTo(k, false);
  });
}

// --------------------------------------------------------- floor alignment

function floorCam() {
  const F = window.dotsFloor;
  if (!F) return null;
  try { return F.camera(sec); } catch (e) { return null; }
}

// The floor horizon sits at the top of the project area, just under the
// heading; returns its row in stage px (= viewport px while pinned).
function syncHorizon() {
  const c = floorCam();
  const H = (c && c.height) || window.innerHeight;
  const row = view.getBoundingClientRect().top - stage.getBoundingClientRect().top - bias;
  const share = clamp(row / H, 0.08, 0.6);
  if (Math.abs(share - lastShare) > 0.0015) {
    lastShare = share;
    sec.dataset.floorHorizon = share.toFixed(4);
    if (window.dotsFloor) window.dotsFloor.refresh();
  }
  return share * H;
}

const camera = {
  x: (box) => {
    const c = floorCam();
    return c ? c.cx - box.originX - box.left : -0.1 * box.width;
  },
  y: (box) => {
    const c = floorCam();
    if (!c || !live) return -1.3 * box.fontSize;
    const row = syncHorizon();
    return row - (box.originY - stage.getBoundingClientRect().top) - box.top;
  },
};
const perspective = (box) => {
  const c = floorCam();
  return c ? c.f : 6 * box.fontSize;
};

// ---------------------------------------------------------------- measure

function measure() {
  if (!live) return;
  geo.top = track.getBoundingClientRect().top + window.scrollY;
  geo.stageH = stage.offsetHeight;
  geo.P = Math.max(1, track.offsetHeight - geo.stageH);
  const st = stage.getBoundingClientRect();
  geo.left = st.left + window.scrollX;
  if (!items.length || items.some((it) => !it.stand)) return;
  for (const it of items) {
    it.stand.refresh();
    const e = it.stand.endPoint();
    // Never smaller than MIN_R: a bigger ball keeps its left edge at the
    // period's place, just after the last letter.
    const r = Math.max(e.r, MIN_R);
    it.spot = { gx: e.x + r - st.left, gy: e.y - st.top, r };
  }
  prev = { mode: 'hidden', at: -1 };
}

const frames = (n) => new Promise((r) => {
  const step = () => (n-- > 0 ? requestAnimationFrame(step) : r());
  step();
});

// The reactive mesh reaches from the bottom of the screen up to
// dotsFloor.camera().meshTop. On short screens the names stand above that:
// lift the horizon (the whole floor rises with it) until every landing and
// its ripple are on the mesh.
async function fitMesh() {
  if (!window.dotsFloor) return;
  for (let i = 0; i < 4; i++) {
    await frames(2);
    if (!live || items.some((it) => !it.spot)) return;
    const c = floorCam();
    if (!c) return;
    const need = Math.min(...items.map((it) => it.spot.gy - 4 * it.spot.r)) - 28;
    const gap = c.meshTop - c.shift - need;
    if (gap <= 2) return;
    bias += gap;
    measure();
  }
}

function restS(k) {
  const P = geo.P;
  if (k <= 0) return Math.ceil(ENTRY * P) + 1;
  return (ENTRY + k * STEP + STEP / 2) * P;
}

// ---------------------------------------------------------------- timeline

function timeline(s) {
  const P = geo.P;
  const E = ENTRY * P;
  const S = STEP * P;
  tl.names.fill(0);
  tl.infos.fill(0);
  if (s < 0) {
    tl.cur = 0;
    tl.mode = 'hidden';
    return tl;
  }
  if (s < E) {
    const u = s / E;
    tl.names[0] = smooth((u - 0.5) / 0.5);
    tl.infos[0] = smooth((u - 0.62) / 0.38);
    tl.cur = 0;
    if (u < DROP) {
      tl.mode = 'drop';
      tl.b = 0;
      tl.q = u / DROP;
    } else {
      tl.mode = 'rest';
      tl.b = 0;
    }
    return tl;
  }
  const x = (s - E) / S;
  const k = Math.round(x);
  const d = (x - k) / TRANS;
  if (k >= 1 && k <= items.length - 1 && Math.abs(d) < 0.5) {
    const u = d + 0.5;
    tl.names[k - 1] = 1 - smooth(u / 0.42);
    tl.names[k] = smooth((u - FLY) / (1 - FLY));
    tl.infos[k - 1] = 1 - smooth(u / 0.3);
    tl.infos[k] = smooth((u - 0.68) / 0.32);
    tl.cur = u < 0.5 ? k - 1 : k;
    if (u < FLY) {
      tl.mode = 'fly';
      tl.a = k - 1;
      tl.b = k;
      tl.q = u / FLY;
    } else {
      tl.mode = 'rest';
      tl.b = k;
    }
    return tl;
  }
  const j = clamp(Math.floor(x), 0, items.length - 1);
  tl.names[j] = 1;
  tl.infos[j] = 1;
  tl.cur = j;
  tl.mode = 'rest';
  tl.b = j;
  return tl;
}

// The incoming card's share while it waits for the landing ring (1 = free).
function gateK(i, now) {
  if (!gate || gate.k !== i) return 1;
  const g = smooth((now - gate.at - CARD_WAIT) / CARD_FADE);
  if (g >= 1) gate = null;
  return g;
}

function applyItems() {
  const now = performance.now();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.stand) continue;
    const p = tl.names[i];
    // Skip tiny steps, but always land exactly on 0 and 1.
    if (p !== it.p && (Math.abs(p - it.p) > 1e-4 || p === 0 || p === 1)) {
      it.stand.setProgress(p);
      if ((p <= 0) !== (it.p <= 0) || it.p < 0) it.h.classList.toggle('is-flat', p <= 0);
      it.p = p;
    }
    const o = Math.min(tl.infos[i], gateK(i, now));
    if (o !== it.op && (Math.abs(o - it.op) > 1e-3 || o === 0 || o === 1)) {
      const st = it.info.style;
      st.opacity = o.toFixed(3);
      st.transform = o >= 1 ? '' : `translate3d(0,${((1 - o) * 12).toFixed(1)}px,0)`;
      it.li.classList.toggle('is-on', o > 0.5);
      it.op = o;
    }
  }
  if (tl.cur !== curIdx) {
    curIdx = tl.cur;
    countEl.innerHTML = `<span><b>${pad2(curIdx + 1)}</b> / ${pad2(items.length)}</span>`;
    dots.forEach((b, i) => {
      if (i === curIdx) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  }
}

// ---------------------------------------------------------------- the ball

function arcApex(a, b) {
  const r = Math.max(a.r, b.r);
  return Math.max(0.17 * geo.stageH, 4 * r) + 0.1 * Math.abs(b.gx - a.gx);
}

function ballPose() {
  const P = geo.P;
  const S = STEP * P;
  let fall = 0;               // d(air)/ds at touchdown, for the impact speed
  if (tl.mode === 'drop') {
    const sp = items[0].spot;
    const h0 = sp.gy + 4 * sp.r;
    const q = tl.q;
    pose.gx = sp.gx; pose.gy = sp.gy; pose.r = sp.r;
    pose.air = h0 * (1 - q * q);
    fall = (2 * h0) / (DROP * ENTRY * P);
  } else if (tl.mode === 'fly') {
    const a = items[tl.a].spot;
    const b = items[tl.b].spot;
    const q = tl.q;
    const A = arcApex(a, b);
    pose.gx = a.gx + (b.gx - a.gx) * q;
    pose.gy = a.gy + (b.gy - a.gy) * q;
    pose.r = a.r + (b.r - a.r) * q;
    pose.air = 4 * A * q * (1 - q);
    fall = (4 * A) / (FLY * TRANS * S);
  } else {
    const sp = items[tl.b].spot;
    pose.gx = sp.gx; pose.gy = sp.gy; pose.r = sp.r;
    pose.air = 0;
  }
  pose.x = pose.gx;
  pose.y = pose.gy - pose.air - pose.r;
  pose.rest = tl.mode === 'rest';
  return fall;
}

// Blend in from wherever the ball was when this section took over.
function blendHandoff(now) {
  if (!handoff) return false;
  const u = (now - handoff.t0) / HANDOFF_MS;
  if (u >= 1 || !handoff.from) {
    handoff = null;
    return false;
  }
  const e = smooth(u);
  const f = handoff.from;
  const gx = pose.gx + pose.ox;
  const gy = pose.gy + pose.oy;
  const vgx = f.gx + (gx - f.gx) * e;
  const vgy = f.gy + (gy - f.gy) * e;
  const air = f.air + (pose.air - f.air) * e + 4 * 3 * pose.r * u * (1 - u);
  pose.r = f.r + (pose.r - f.r) * e;
  pose.gx = vgx - pose.ox;
  pose.gy = vgy - pose.oy;
  pose.air = air;
  pose.x = pose.gx;
  pose.y = pose.gy - air - pose.r;
  pose.rest = false;
  return true;
}

let lastFall = 0;
let lastLand = -1e9;          // when the ball last landed (ms)

const ctrl = {
  enter(from) {
    owning = true;
    handoff = from ? { t0: performance.now(), from } : null;
    prev = { mode: from ? 'fly' : 'hidden', at: -1 };
    requestFrame();
  },
  leave() {
    owning = false;
    handoff = null;
  },
  frame(now, B) {
    if (!live || !items.length || !items[0].spot) {
      // Names not built yet: the count and index still follow the scroll.
      if (live && items.length) {
        timeline(window.scrollY - geo.top);
        applyItems();
      }
      B.idle();
      return false;
    }
    const y = window.scrollY;
    const dt = now - lastT;
    // A jump (focus, a restore, a deep link) is not a fast scroll: the ball
    // stays where it lands.
    const jumped = Math.abs(y - lastY) > 0.5 * STEP * geo.P;
    if (dt > 0 && dt < 250) vel = 0.6 * vel + 0.4 * (((y - lastY) / dt) * 1000);
    else vel = 0;
    lastY = y;
    lastT = now;

    const s = y - geo.top;
    frac = s / geo.P;
    timeline(s);
    // How much of the landing project's card showed before this frame (on a
    // fast scroll this frame alone may already fade it in; onScroll leaves
    // the items to this frame while the section owns the ball).
    const shown = items[tl.b] ? Math.max(0, items[tl.b].op) : 1;
    applyItems();

    if (tl.mode === 'hidden') {
      prev = { mode: 'hidden', at: -1 };
      if (handoff) handoff = null;
      B.idle();
      return false;
    }
    const fall = ballPose();
    if (tl.mode !== 'rest') lastFall = fall;
    pose.layer = layer;
    pose.ox = geo.left - window.scrollX;
    pose.oy = Math.min(Math.max(geo.top - y, 0), geo.top + geo.P - y);
    const blending = blendHandoff(now);
    B.place(pose);

    const landed = !blending && tl.mode === 'rest' &&
      (prev.mode === 'fly' || prev.mode === 'drop' || (prev.mode === 'rest' && prev.at !== tl.b));
    if (landed) {
      const impact = lastFall * Math.abs(vel);
      // On a fast scroll the ball takes off again (and releases its dimple)
      // before the floor has settled, and landings come in quick succession:
      // soften them, or their heat merges into filled red patches.
      const speed = Math.abs(vel);
      const stay = speed > 1 && !jumped ? ((1 - TRANS * FLY) * STEP * geo.P / speed) * 1000 : Infinity;
      const calm = clamp(Math.min(stay, now - lastLand) / LAND_CALM_MS, 0, 1);
      lastLand = now;
      B.land(clamp(1.1 + impact / 5200, 1.1, 1.8) * (LAND_FAST_K + (1 - LAND_FAST_K) * calm * calm));
      // The card coming in with this project waits for the ring (one that is
      // already showing, as on the way back up, stays; so does one holding
      // keyboard focus).
      const it = items[tl.b];
      if (it && shown < 0.05 && !it.info.contains(document.activeElement)) {
        gate = { k: tl.b, at: performance.now() };
        applyItems();
      }
    }
    prev = { mode: blending ? 'fly' : tl.mode, at: tl.b };
    return blending || !!gate;
  },
};

// ------------------------------------------------------------------ modes

function wanted() {
  return !reduced && !gridChosen && window.innerHeight >= MIN_H;
}

function withoutAnchoring(fn) {
  root.style.setProperty('overflow-anchor', 'none');
  fn();
  requestAnimationFrame(() => requestAnimationFrame(() => root.style.removeProperty('overflow-anchor')));
}

function scrollToY(y, smoothly) {
  const behavior = smoothly && !reduced ? 'smooth' : 'instant';
  try {
    window.scrollTo({ top: y, behavior });
  } catch (e) {
    window.scrollTo(0, y);
  }
}

function jumpTo(k, smoothly) {
  if (!live) return;
  scrollToY(geo.top + restS(k), smoothly);
}

function setLive(on) {
  sec.classList.toggle('cat-live', on);
  sec.classList.toggle('cat-grid', !on && gridChosen && !reduced && window.innerHeight >= MIN_H);
  if (on === live) return;
  live = on;
  if (on) {
    measure();
    applyItems();
  }
  requestFrame();
}

// The project the visitor is looking at: in the catalogue, the current one;
// in the grid, the card nearest the middle of the screen.
function lookingAt() {
  if (live) {
    const s = window.scrollY - geo.top;
    return { k: Math.max(0, curIdx), inside: s > -0.25 * window.innerHeight && s < geo.P + 0.25 * window.innerHeight };
  }
  const mid = window.innerHeight / 2;
  const gr = grid.getBoundingClientRect();
  const inside = gr.top < mid && gr.bottom > mid;
  // Still where the switch to the grid left us: go back to that project.
  if (parked && Math.abs(window.scrollY - parked.y) < 8) return { k: parked.k, inside };
  const cx = window.innerWidth / 2;
  const cards = [...grid.querySelectorAll('.card')];
  let best = -1;
  let dist = Infinity;
  cards.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const d = Math.hypot((r.top + r.bottom) / 2 - mid, ((r.left + r.right) / 2 - cx) * 0.25);
    if (d < dist) { dist = d; best = i; }
  });
  return { k: Math.max(0, best), inside };
}

function restore(k) {
  if (live) {
    parked = null;
    jumpTo(k, false);
  } else {
    const card = grid.querySelectorAll('.card')[k];
    if (card) card.scrollIntoView({ block: 'center', behavior: 'instant' });
    parked = { k, y: window.scrollY };
  }
}

function chooseGrid(on) {
  gridChosen = on;
  const { k } = lookingAt();
  withoutAnchoring(() => {
    setLive(wanted());
    if (on) {
      scrollToY(sec.getBoundingClientRect().top + window.scrollY, false);
      // Remember the project: "One at a time" from here goes back to it,
      // not to the grid card nearest the middle of the screen (card 1).
      parked = { k, y: window.scrollY };
      oneBtn.focus({ preventScroll: true });
    } else {
      jumpTo(k, false);
      allBtn.focus({ preventScroll: true });
    }
  });
}

function update() {
  const was = live;
  const look = lookingAt();
  if (wanted() === live) return;
  // A visitor past the catalogue (Pause pressed in the hackathons, say) keeps
  // what they see: the track changing height above them must not move it.
  const next = !look.inside && sec.getBoundingClientRect().bottom < window.innerHeight ? sec.nextElementSibling : null;
  const before = next ? next.getBoundingClientRect().top : 0;
  withoutAnchoring(() => {
    setLive(wanted());
    if (look.inside && live !== was) restore(look.k);
    else if (next) scrollToY(window.scrollY + next.getBoundingClientRect().top - before, false);
  });
}

// ------------------------------------------------------------------- init

export function init() {
  sec = document.getElementById('awards');
  if (!sec) return;
  track = sec.querySelector('.cat-track');
  stage = sec.querySelector('.cat-stage');
  head = sec.querySelector('.scene-head');
  grid = sec.querySelector('.cards');
  const cards = grid ? [...grid.querySelectorAll('.card')] : [];
  if (!track || !stage || !head || !cards.length) return;
  reduced = root.classList.contains('reduced');

  // The view and the page height are final from the start, so nothing moves
  // under a visitor who jumps down the page early; only the 3D names, the
  // expensive part, wait until the hero intro is over (soon()).
  build(cards);
  layer = createLayer(stage);
  pose.layer = layer;
  sec.classList.add('cat-on');
  live = wanted();
  sec.classList.toggle('cat-live', live);
  measure();
  register('awards', ctrl);

  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    const keep = frac;
    resizeT = setTimeout(() => {
      update();
      if (!live) return;
      bias = 0;
      measure();
      fitMesh().then(requestFrame);
      const s = window.scrollY - geo.top;
      if (keep > 0 && keep < 1 && s > 0 && s < geo.P) scrollToY(geo.top + keep * geo.P, false);
      requestFrame();
    }, 120);
  });
  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => requestAnimationFrame(() => { measure(); requestFrame(); }));
  }
  if ('ResizeObserver' in window) {
    // Content above the track changing height moves the track.
    let t = 0;
    new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => { measure(); requestFrame(); }, 60);
    }).observe(document.querySelector('main'));
  }
  window.addEventListener('motion:change', (e) => {
    reduced = !!(e.detail && e.detail.reduced);
    update();
  });
  window.addEventListener('scroll', onScroll, { passive: true });

  soon(sec, () => buildNames().catch((e) => console.warn(`[catalogue] ${e && e.message}`)));
}

async function buildNames() {
  // One name per idle slice: each is ~20 layered spans per letter.
  for (const it of items) {
    await idle();
    it.stand = makeStand(it.h, { depth: 0.2, stagger: 0.22, overshoot: 9, perspective, camera, gap: 0.07, period: 0.2, progress: 0 });
  }
  await fontsReady(items[0].h);
  await Promise.all(items.map((it) => it.stand.ready));
  if (live) {
    measure();
    frame0();
    await fitMesh();
    requestFrame();
  }
  // Deep link: land on the first project, not on the empty stage.
  if (location.hash === '#awards' && live && window.scrollY > 0) {
    const s = window.scrollY - geo.top;
    if (Math.abs(s) < 4) jumpTo(0, false);
  }
}

// The names and cards follow the scroll even while another section owns the
// ball (the stage is on screen a little before and after that).
let itemsRaf = 0;
function onScroll() {
  if (!live || itemsRaf || owning) return;
  itemsRaf = requestAnimationFrame(() => {
    itemsRaf = 0;
    if (!live) return;
    timeline(window.scrollY - geo.top);
    applyItems();
  });
}

function frame0() {
  lastY = window.scrollY;
  lastT = performance.now();
  timeline(window.scrollY - geo.top);
  applyItems();
  requestFrame();
}

export default init;
