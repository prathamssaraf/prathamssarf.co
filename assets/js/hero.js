// Hero: the name stands up on the dot floor and the ball lands as its period.
//
// Once fonts are ready "PRATHAM SARAF" stands up letter by letter (stand3d,
// its camera lined up with the floor's: same vanishing point, horizon and
// focal length), then the red ball drops in and lands after SARAF with a
// squash, a ring and a ripple through the floor, rebounds twice and rests
// there, pressing a small dimple into the mesh. About 1.45 s, never blocking:
// the role line, meta line and buttons are plain page content from the first
// frame. On the first scroll the ball hops off the name toward the viewer,
// bounces once on the floor (no ripple once the floor is morphing into the
// About sphere) and drops out through the bottom of the screen: the hop-off
// runs in viewport terms, so the scroll never carries the ball up the screen,
// and it is never hidden while any of it shows. Back at the very top it drops
// in again.
//
// The landing sends its ripple at full strength; the two small rebounds only
// dent the floor (REBOUND_FLOOR), so the first ring travels out alone instead
// of the centre being re-excited into a filled red patch.
//
// The floor horizon (data-floor-horizon on #hello) is placed just above the
// name's cap line, so the camera looks down on the letters and their
// extrusion shows on top, like the floor's own perspective.

import { makeStand, fontsReady } from './stand3d.js';
import { register, bounceTo, hop, toLayer, requestFrame } from './ball.js';

const STAND_MS = 1000;        // the name's stand-up (all letters)
const DROP_AT = 600;          // ms after the stand-up starts: the ball falls
const DROP_MS = 440;
const HOP_OFF_AT = 8;         // px scrolled: the ball hops off the name
const BACK_AT = 2;            // px: back at the top, it drops in again...
const BACK_HOLD = 280;        // ...after this long there
const HORIZON_ABOVE = 0.16;   // em above the name's line box top
const OFF_HOP_MS = 300;       // the hop-off's first hop, to its landing on the floor
const MORPH_QUIET = [0.12, 0.3]; // floor morph blend over which the hop-off landing's ripple fades out
const REBOUND_FLOOR = 0.22;   // floorK for the rebounds' touchdowns: a dent, no ring, no heat

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let sec = null;
let h1 = null;
let stand = null;
let lastShare = -1;
let bias = 0;                 // px the horizon sits above its name-based row, to keep the landing on the mesh
let spot = null;              // page-layer px: {gx, gy, r}
let state = 'wait';           // wait | intro | seq | rest | off | gone
let dropAt = Infinity;
let run = null;               // bounceTo runner
let off = null;               // hop-off: {a, b, landed, sy0} (a, b in page-layer px at scrollY = sy0)
let topSince = -1;
let introDone = false;
let morph = 0;                // how far the floor has morphed toward the next scene (scene:progress)
const pose = { layer: null, x: 0, y: 0, r: 0, gx: 0, gy: 0, air: 0, floor: true, rest: false, fixed: false };
const tmp = {};

function floorCam() {
  const F = window.dotsFloor;
  if (!F) return null;
  try { return F.camera(sec); } catch (e) { return null; }
}

// Put the floor horizon a little above the name and return its row, in px
// from the section top (the hero is the first section, so page px).
function syncHorizon() {
  const c = floorCam();
  const H = (c && c.height) || window.innerHeight;
  const fs = parseFloat(getComputedStyle(h1).fontSize) || 100;
  const top = h1.getBoundingClientRect().top - sec.getBoundingClientRect().top;
  const share = clamp((top - HORIZON_ABOVE * fs - bias) / H, 0.08, 0.5);
  if (Math.abs(share - lastShare) > 0.0015) {
    lastShare = share;
    sec.dataset.floorHorizon = share.toFixed(4);
    if (window.dotsFloor) window.dotsFloor.refresh();
  }
  return share * H;
}

// stand3d camera options: the floor's vanishing point and focal length, as
// seen from the text box (see stand3d.js DEFAULTS.camera).
const camera = {
  x: (box) => {
    const c = floorCam();
    return c ? c.cx - box.originX - box.left : -0.1 * box.width;
  },
  y: (box) => {
    const c = floorCam();
    if (!c) return -1.3 * box.fontSize;
    const row = syncHorizon();
    const secTop = sec.getBoundingClientRect().top;
    return row - (box.originY - secTop) - box.top;
  },
};
const perspective = (box) => {
  const c = floorCam();
  return c ? c.f : 6 * box.fontSize;
};

function measureSpot() {
  if (!stand || !stand.enhanced) return;
  const e = stand.endPoint();
  const g = toLayer(e.cx + window.scrollX, e.y + window.scrollY, {});
  spot = { gx: g.x, gy: g.y, r: e.r };
}

const toSpot = () => spot;

const frames = (n) => new Promise((r) => {
  const step = () => (n-- > 0 ? requestAnimationFrame(step) : r());
  step();
});

// The reactive mesh covers the floor from the bottom of the screen up to
// dotsFloor.camera().meshTop. If the period lands above that (tall portrait
// screens), lift the horizon until the landing and its ripple are on it. The
// whole floor moves with the horizon, so each pass closes the gap.
async function fitMesh() {
  if (!window.dotsFloor || !stand || !stand.enhanced) return;
  for (let i = 0; i < 4; i++) {
    await frames(2);
    const c = floorCam();
    if (!c) return;
    const e = stand.endPoint();
    const need = e.y - 4 * e.r - 28;
    const gap = c.meshTop - c.shift - (need + window.scrollY);
    if (gap <= 2) break;
    bias += gap;
    stand.refresh();
  }
  measureSpot();
}

// The page layer's viewport top.
function origin() {
  const l = pose.layer;
  const r = l ? l.getBoundingClientRect() : { top: 0 };
  return r.top;
}

// Fall from above the top edge onto the period.
function startDrop(now, dur = DROP_MS) {
  measureSpot();
  if (!spot) return;
  const above = spot.gy + origin() + 4 * spot.r;
  run = bounceTo({ now, dur, from: { gx: spot.gx, gy: spot.gy, r: spot.r, air: above }, to: toSpot });
  state = 'seq';
}

// Hop off the name toward the viewer, bounce once, leave through the bottom.
// The hops are laid out in page-layer px as they stand now (scrollY = sy0)
// and played in viewport terms: each frame adds the scroll since then, so the
// ball moves down the screen however fast the page goes up. The second hop
// comes down below the bottom edge, so the ball leaves the screen in flight.
function startHopOff(now) {
  const from = run ? run.at(now, tmp) : { gx: spot.gx, gy: spot.gy, r: spot.r, air: 0 };
  const r = spot.r;
  const vh = window.innerHeight;
  const top = origin();       // the layer's viewport top: layer y + top = viewport y
  const g1 = { gx: from.gx + 3.6 * r, gy: from.gy + 0.1 * vh, r: r * 1.18 };
  const g2 = { gx: g1.gx + 4.6 * r, gy: Math.max(g1.gy + 0.62 * vh, vh - top + 3.5 * r), r: r * 1.5 };
  const a = hop({ t0: now, dur: OFF_HOP_MS, g0: { x: from.gx, y: from.gy }, h0: from.air || 0, r0: from.r, apex: 2.8 * r, to: () => g1 });
  const b = hop({ t0: now + OFF_HOP_MS, dur: 520, g0: { x: g1.gx, y: g1.gy }, h0: 0, r0: g1.r, apex: 2.2 * r, to: () => g2 });
  off = { a, b, landed: false, sy0: window.scrollY };
  run = null;
  state = 'off';
}

const ctrl = {
  enter() {
    requestFrame();
  },
  leave() {
    if (state === 'seq' || state === 'rest' || state === 'off') state = 'gone';
    run = null;
    off = null;
  },
  frame(now, B) {
    if (!spot) measureSpot();
    const y = window.scrollY;
    pose.fixed = false;

    if (state === 'wait') return false;
    if (state === 'intro') {
      if (y > HOP_OFF_AT) {
        state = 'gone';
      } else if (now >= dropAt) {
        startDrop(now);
      } else {
        return true;
      }
    }
    if ((state === 'seq' || state === 'rest') && y > HOP_OFF_AT) startHopOff(now);

    if (state === 'gone') {
      if (introDone && y <= BACK_AT) {
        if (topSince < 0) topSince = now;
        if (now - topSince >= BACK_HOLD) startDrop(now, 400);
        else {
          B.idle();
          return true;
        }
      } else {
        topSince = -1;
        B.idle();
        return false;
      }
    }

    if (state === 'seq') {
      run.at(now, pose);
      pose.rest = !!pose.rest;
      B.place(pose);
      if (pose.landed) B.land(pose.landed, pose.bounce > 0 ? REBOUND_FLOOR : 1);
      if (pose.rest) state = 'rest';
      return !pose.rest;
    }
    if (state === 'rest') {
      pose.gx = spot.gx; pose.gy = spot.gy; pose.r = spot.r; pose.air = 0;
      pose.x = spot.gx; pose.y = spot.gy - spot.r; pose.rest = true;
      B.place(pose);
      return false;
    }
    if (state === 'off') {
      const first = now < off.b.t0;
      (first ? off.a : off.b).at(now, pose);
      const dy = y - off.sy0;
      pose.y += dy;
      pose.gy += dy;
      pose.rest = false;
      pose.fixed = true;
      B.place(pose);
      if (!first && !off.landed) {
        off.landed = true;
        // Scrolling on, the floor is already turning into the About sphere:
        // a ripple there would scatter red dots through the morph.
        const [q0, q1] = MORPH_QUIET;
        B.land(0.85, 1 - clamp((morph - q0) / (q1 - q0), 0, 1));
      }
      if (!first && pose.done) {
        // Normally below the bottom edge by now (hidden at once); if any of
        // it still shows, it falls on from here (ball.js, viewport terms).
        B.idle();
        state = 'gone';
        topSince = -1;
        return false;
      }
      return true;
    }
    return false;
  },
};

export async function init() {
  sec = document.getElementById('hello');
  h1 = document.getElementById('hello-title');
  if (!sec || !h1) return;
  const reduced = document.documentElement.classList.contains('reduced');
  const layerOf = () => document.querySelector('.ball-layer--page');
  pose.layer = layerOf();

  stand = makeStand(h1, { depth: 0.2, stagger: 0.28, overshoot: 9, perspective, camera, gap: 0.06, period: 0.2, progress: 0 });
  register('hello', ctrl);
  window.addEventListener('scene:progress', (e) => {
    const d = (e && e.detail) || {};
    if (d.fromEl !== sec) morph = 1;
    else morph = d.toEl === sec ? 0 : +d.blend || 0;
  });

  await fontsReady(h1);
  await stand.ready;
  pose.layer = pose.layer || layerOf();
  stand.refresh();
  await fitMesh();

  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(async () => {
      if (!stand) return;
      bias = 0;
      stand.refresh();
      measureSpot();
      await fitMesh();
      requestFrame();
    }, 120);
  });
  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => requestAnimationFrame(() => { measureSpot(); requestFrame(); }));
  }

  window.addEventListener('motion:change', (e) => {
    if (e.detail && e.detail.reduced) {
      stand.setProgress(1);
      introDone = true;
      state = 'gone';
      run = null;
      off = null;
    }
    requestFrame();
  });

  const onScreen = sec.getBoundingClientRect().bottom > 0;
  if (reduced || !onScreen) {
    stand.setProgress(1);
    introDone = true;
    state = 'gone';
    requestFrame();
    return;
  }
  const t0 = performance.now();
  stand.play({ duration: STAND_MS }).then(() => { introDone = true; });
  dropAt = t0 + DROP_AT;
  state = window.scrollY > HOP_OFF_AT ? 'gone' : 'intro';
  if (state === 'gone') introDone = true;
  requestFrame();
}

export default init;
