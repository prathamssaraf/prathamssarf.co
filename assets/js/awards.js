// Hackathons: the heading stands up and the ball lands as its period; then,
// as each win card comes up the screen, the ball bounces onto it (a ring and
// a small ripple through the grid dots behind) and the card's tag — WINNER,
// 1ST PLACE, MENTOR — stands up once. The ball follows the reader: scrolling
// back up, it hops back to the card on screen. Time-driven hops (ball.js
// bounceTo), triggered by scroll.
//
// The hops form a queue: coming in from above, the ball always lands on the
// heading first (if it is on screen), then hops on to the current card, and
// it sits at least REST_MS on each stop, so a quick scroll never skips the
// heading. Whenever the ball is not on the heading, the heading shows its
// own CSS period (.period-on, a short fade), so it never ends at "2026" --
// but never while the ball is still within PERIOD_CLEAR radii of that spot
// (taking off, or coming in to land), so there is never a double dot.
//
// Spots are measured right before each hop, in the cards' final layout: the
// list's reveal (translateY on [data-reveal]) is subtracted, and added back
// live while it runs, so the ball sits on the tag through the reveal.
//
// Reduced motion: the heading and the tags stand still, no ball (the heading
// keeps its static CSS period).

import { makeStand, fontsReady } from './stand3d.js';
import { register, bounceTo, toLayer, current, getPageLayer, requestFrame, soon, idle } from './ball.js';

const TRIGGER = 0.64;         // a card is current once its tag's top is above this share of the viewport
const HEAD_TRIGGER = 0.85;    // the heading: once its top is above this share
const HEAD_MS = 800;
const HEAD_LAND = 420;        // ms after the heading starts standing: the ball falls
const TAG_MS = 620;
const REST_MS = 400;          // the least time the ball sits on a stop before the next hop
const PERIOD_CLEAR = 2.6;     // radii: the heading's CSS period waits until the ball is this far from its spot
const PERIOD_WAIT_MAX = 1500; // ms: ...but no longer than this

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let sec = null;
let targets = [];             // {el, stand, kind, played, top, spot, rv}
let head = null;              // targets[0] when it is the heading
let goal = -1;                // the target the reader is at (-1: above the section)
let at = -1;                  // the target the ball is on or flying to (-1: none)
let headSeen = false;         // the ball has been on (or skipped) the heading since the reader came in from above
let state = 'idle';           // idle | wait | seq | rest
let waitUntil = 0;
let restAt = 0;
let run = null;
let touched = false;          // the running hop has touched down
let reduced = false;
let revealDone = false;       // the list's reveal transform has finished
let ready = false;            // the stands are built and measured
const live = { gx: 0, gy: 0, r: 0 };
const pose = { layer: null, x: 0, y: 0, r: 0, gx: 0, gy: 0, air: 0, floor: false, rest: false };

// ------------------------------------------------------------------ geometry

// The current translateY of a target's reveal wrapper (0 once it is in).
function liftOf(t) {
  if (!t.rv) return 0;
  if (revealDone) return 0;
  let y = 0;
  try {
    const tf = getComputedStyle(t.rv).transform;
    if (tf && tf !== 'none') y = new DOMMatrixReadOnly(tf).m42 || 0;
  } catch (e) {
    y = 0;
  }
  if (y === 0 && t.rv.classList.contains('is-in')) revealDone = true;
  return y;
}

// Page-layer spot of one target, in its final layout (reveal subtracted).
function measureOne(t) {
  const sy = window.scrollY;
  const lift = liftOf(t);
  t.top = t.el.getBoundingClientRect().top + sy - lift;
  if (!t.stand.enhanced) return;
  const e = t.stand.endPoint();
  const g = toLayer(e.cx + window.scrollX, e.y + sy - lift, {});
  t.spot = { gx: g.x, gy: g.y, r: e.r };
}

function measure() {
  for (const t of targets) measureOne(t);
}

// The spot as it is on screen this frame (the reveal may still be lifting it).
function liveSpot(t) {
  const lift = liftOf(t);
  live.gx = t.spot.gx;
  live.gy = t.spot.gy + lift;
  live.r = t.spot.r;
  return live;
}

function pick() {
  const sy = window.scrollY;
  const vh = window.innerHeight;
  let k = -1;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t.top < sy + (t.kind === 'head' ? HEAD_TRIGGER : TRIGGER) * vh) k = i;
  }
  return k;
}

function layerOrigin() {
  const l = pose.layer || getPageLayer();
  return l ? l.getBoundingClientRect() : { left: 0, top: 0 };
}

function headOnScreen() {
  if (!head || !head.spot) return false;
  const y = head.spot.gy + layerOrigin().top;
  const vh = window.innerHeight;
  return y - 3 * head.spot.r > 0.06 * vh && y < vh - 8;
}

// ------------------------------------------------------------ heading period

// The heading's CSS period shows whenever the heading stands and the ball is
// not sitting on it (nor landing there straight from the stand-up).
let periodOn = null;
let periodRaf = 0;            // polling for the ball to clear the heading spot
let periodWait = 0;           // when that started
function setPeriod(on) {
  if (!head || periodOn === on) return;
  periodOn = on;
  head.el.classList.toggle('period-on', on);
}

function headStood() {
  return !head.stand.enhanced || head.stand.progress >= 0.999;
}

// Is the ball (whoever places it) over the heading's period spot?
function ballAtHead() {
  if (!head || !head.spot) return false;
  const c = current();
  if (!c) return false;
  const o = layerOrigin();
  const px = head.spot.gx + o.left;
  const py = head.spot.gy - head.spot.r + o.top;
  return Math.hypot(c.x - px, c.y - py) < PERIOD_CLEAR * Math.max(c.r, head.spot.r);
}

function stopPeriodWait() {
  if (periodRaf) cancelAnimationFrame(periodRaf);
  periodRaf = 0;
  periodWait = 0;
}

function syncPeriod() {
  if (!head) return;
  if (reduced) {
    stopPeriodWait();
    setPeriod(false);
    return;
  }
  const onIt = at === 0 && (state === 'rest' || state === 'wait' ||
    (state === 'seq' && (touched || !periodOn || ballAtHead())));
  const want = headStood() && !onIt;
  if (want && !periodOn && ballAtHead()) {
    // Taking off (or handed to another section): show it once the ball has
    // cleared the spot, checked every frame.
    const now = performance.now();
    if (!periodWait) periodWait = now;
    if (now - periodWait < PERIOD_WAIT_MAX) {
      if (!periodRaf) periodRaf = requestAnimationFrame(() => { periodRaf = 0; syncPeriod(); });
      return;
    }
  }
  stopPeriodWait();
  setPeriod(want);
}

// ---------------------------------------------------------------- the hops

function standUp(t, ms) {
  if (t.played) return;
  t.played = true;
  t.stand.play({ duration: ms }).then(() => {
    if (t === head) syncPeriod();
  });
}

// Hop from wherever the ball is (or drop in from above the screen).
function fly(now, k) {
  const t = targets[k];
  measureOne(t);
  if (!t.spot) {
    at = -1;
    state = 'idle';
    run = null;
    return;
  }
  const to = () => liveSpot(t);
  const s = liveSpot(t);
  const o = layerOrigin();
  const c = current();
  let from;
  let apex = 0;
  let dur;
  if (c && c.y + c.r > 0 && c.y - c.r < window.innerHeight) {
    from = { gx: c.gx - o.left, gy: c.gy - o.top, r: c.r, air: c.air || 0 };
    const dist = Math.hypot(s.gx - from.gx, s.gy - from.gy);
    apex = Math.max(3.5 * s.r, 0.07 * window.innerHeight, from.gy - s.gy + 3 * s.r);
    dur = clamp(380 + dist * 0.45, 440, 760);
  } else {
    const top = s.gy + o.top;
    from = { gx: s.gx, gy: s.gy, r: s.r, air: Math.max(0, top) + 4 * s.r };
    dur = clamp(260 + 0.25 * from.air, 360, 520);
  }
  const rebound = t.kind === 'head' ? [[1.6, 240], [0.4, 120]] : [[1.3, 210], [0.34, 110]];
  run = bounceTo({ now, dur, from, to, apex, rebound });
  at = k;
  touched = false;
  state = 'seq';
}

// The next stop: the heading first when the reader has just come in from
// above and it is on screen, else where the reader is.
function nextStop() {
  if (goal < 0) return -1;
  if (head && !headSeen && goal > 0) {
    if (headOnScreen()) return 0;
    headSeen = true;
  }
  return goal;
}

// Start the way to stop k (-1: leave).
function go(now, k, B) {
  const leaving = at === 0 && k !== 0;
  if (k < 0) {
    at = -1;
    state = 'idle';
    run = null;
    B.idle();
  } else {
    // Anything above the stop stands without waiting for the ball.
    for (let i = 0; i < k; i++) standUp(targets[i], 500);
    const t = targets[k];
    if (t === head && !t.played) {
      standUp(t, HEAD_MS);
      at = k;
      state = 'wait';
      waitUntil = now + HEAD_LAND;
      run = null;
    } else {
      fly(now, k);
    }
  }
  if (leaving || k < 0) syncPeriod();
}

function placeRest(B) {
  const t = targets[at];
  if (!t || !t.spot) return;
  const s = liveSpot(t);
  pose.gx = s.gx; pose.gy = s.gy; pose.r = s.r; pose.air = 0;
  pose.x = s.gx; pose.y = s.gy - s.r; pose.rest = true; pose.floor = false;
  B.place(pose);
}

const ctrl = {
  enter() {
    at = -1;
    state = 'idle';
    run = null;
    measure();
    requestFrame();
  },
  leave() {
    // Back above the section: the next visit lands on the heading again.
    // Past it: whatever the ball never reached stands up anyway.
    if (sec.getBoundingClientRect().top > 0) headSeen = false;
    else targets.forEach((t) => standUp(t, 500));
    at = -1;
    state = 'idle';
    run = null;
    syncPeriod();
  },
  frame(now, B) {
    if (!ready) {
      B.idle();
      return false;
    }
    pose.layer = pose.layer || getPageLayer();
    goal = pick();
    if (goal < 0) headSeen = false;

    if (state === 'wait') {
      if (goal < 0) {
        go(now, -1, B);
        return false;
      }
      if (now < waitUntil) return true;
      fly(now, at);
      if (state !== 'seq') return false;
    }
    if (state === 'seq') {
      run.at(now, pose);
      pose.floor = false;
      B.place(pose);
      // Coming in to land on the heading: its CSS period gives way as soon as
      // the ball is over it, not only at touchdown.
      if (at === 0 && periodOn) syncPeriod();
      if (pose.landed) {
        B.land(0.25 + 0.45 * pose.landed);
        if (!touched) {
          touched = true;
          const t = targets[at];
          if (t === head) headSeen = true;
          else if (t) standUp(t, TAG_MS);
          syncPeriod();
        }
      }
      if (!pose.rest) return true;
      state = 'rest';
      restAt = now;
    }
    const next = nextStop();
    if (state === 'rest') {
      placeRest(B);
      const rv = at > 0 && targets[at].rv;
      const lifting = !revealDone && !!rv && rv.classList.contains('is-in');
      if (next === at) return lifting;
      if (now - restAt < REST_MS) return true;
    } else if (next === at) {
      B.idle();
      return false;
    }
    go(now, next, B);
    return state !== 'idle';
  },
};

export function init() {
  sec = document.getElementById('projects');
  if (!sec) return;
  soon(sec, () => start().catch((e) => console.warn(`[awards] ${e && e.message}`)));
}

async function start() {
  reduced = document.documentElement.classList.contains('reduced');
  const h = sec.querySelector('#projects-title');
  const tags = [...sec.querySelectorAll('.award-rank')];
  if (h) {
    head = { el: h, kind: 'head', stand: makeStand(h, { depth: 0.18, stagger: 0.24, overshoot: 9, period: 0.24, gap: 0.06, progress: reduced ? 1 : 0 }) };
    targets.push(head);
  }
  for (const el of tags) {
    await idle();
    // Tags the ball has not reached lie flat and unseen (fade), not as smears on the card.
    targets.push({ el, kind: 'tag', stand: makeStand(el, { depth: 0.24, stagger: 0.3, overshoot: 10, period: 0.5, gap: 0.12, fade: 0.35, progress: reduced ? 1 : 0 }) });
  }
  if (!targets.length) return;
  const list = sec.querySelector('.awards');
  targets.forEach((t) => {
    t.played = reduced;
    t.rv = t.el.closest('[data-reveal]');
  });
  if (list) {
    // The reveal starts: keep frames coming so a resting ball rides along.
    list.addEventListener('transitionrun', (e) => {
      if (e.target === list && e.propertyName === 'transform') requestFrame();
    });
    list.addEventListener('transitionend', (e) => {
      if (e.target !== list || e.propertyName !== 'transform') return;
      if (list.classList.contains('is-in')) revealDone = true;
      measure();
      requestFrame();
    });
  }
  register('projects', ctrl);

  await fontsReady(targets[0].el);
  await Promise.all(targets.map((t) => t.stand.ready));
  targets.forEach((t) => t.stand.refresh());
  measure();
  ready = true;
  syncPeriod();

  let rt = 0;
  const remeasure = () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      targets.forEach((t) => t.stand.refresh());
      measure();
      requestFrame();
    }, 100);
  };
  window.addEventListener('resize', remeasure);
  if ('ResizeObserver' in window) new ResizeObserver(remeasure).observe(document.querySelector('main'));
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', remeasure);
  window.addEventListener('motion:change', (e) => {
    reduced = !!(e.detail && e.detail.reduced);
    if (reduced) {
      targets.forEach((t) => { t.played = true; t.stand.setProgress(1); });
    }
    at = -1;
    state = 'idle';
    run = null;
    syncPeriod();
    requestFrame();
  });
  requestFrame();
}

export default init;
