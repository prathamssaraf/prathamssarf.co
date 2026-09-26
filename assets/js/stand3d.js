// Flat-3D standing letters.
//
// makeStand(el) lays an element's letters flat on an imaginary floor (tops
// pointing away from the viewer) and stands them up again one by one, hinged
// at the baseline, left to right, with a small overshoot.
//
// The element keeps its own text nodes exactly where they are, only made
// transparent (-webkit-text-fill-color), so its layout box, kerning, line
// breaks, selection, find-in-page and accessible name never change. The 3D
// letters are an aria-hidden overlay placed from per-character Range rects.
// Each letter is a face plus N side layers pushed back in Z. Every layer is a
// flat element that carries the whole projection in its own transform
// (perspective() baked in around one shared camera point), so there is no
// preserve-3d and no depth buffer to disagree between engines: each letter
// paints as one stacking unit (deepest layer first, face last) and the units
// are depth-sorted from the camera every pose. Side layers are clipped where
// they would pass under the floor, so a flat letter shows no extrusion.
//
// Per frame one custom property per letter (--a, its angle) is written, plus a
// z-index when the depth order changes. Geometry is measured on build, on
// resize and when fonts load, never in the animation loop.

const FLAT = 90;           // degrees: lying on the floor, top edge away from the viewer
const LAYER_PX = 1.25;     // target extrusion depth per side layer
const MIN_LAYERS = 3;
const MAX_LAYERS = 18;
const FONTS_TIMEOUT = 3000;
const SKIP = '.s3d-skip, .sr-only, .visually-hidden, [hidden]';
const FONT_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
  'fontVariationSettings', 'fontFeatureSettings'];

const DEFAULTS = {
  depth: 0.14,                    // em: extrusion depth
  layers: 0,                      // side layers per letter; 0 = auto from depth (3–18)
  stagger: 0.3,                   // start-to-start delay between letters, as a share of one letter's swing
  overshoot: 8,                   // degrees past upright before settling
  // Camera (the shared perspective origin, the vanishing point) and its
  // distance. Camera offsets are from the text's own box (the union of its
  // letters): a number is a share of that box's width (x) / height (y),
  // 'Npx' / 'Nem' are absolute, and a function gets {left, top, width,
  // height, fontSize, elWidth, elHeight, originX, originY} (stage px; origin
  // = the stage's viewport position at measure time) and returns px from the
  // text box's left / top edge. Perspective takes the same forms (a number
  // is a share of the text width). The default sits a little left of and
  // above the text: extrusion shows on the left and top, as in the reference.
  perspective: '6em',
  camera: { x: -0.1, y: '-1.3em' },
  gap: 0.07,                      // em: space between the last letter and the period (endPoint)
  period: 0.2,                    // em: period diameter reported by endPoint
  fade: 0,                        // share of each letter's swing spent fading in from 0 (0 = always opaque)
  progress: 0,                    // initial pose
  onUpdate: null,                 // called with p after every pose change
};

// Structural styles, injected once (first in <head>, so page CSS can theme
// on top; the in-flow hide is doubled up so a page rule cannot undo it). Every layer is a flat element with the whole projection in its
// own transform: perspective centred on the shared camera, the hinge
// rotation about the baseline, then its own push back in Z. Side layer k is
// clipped where it would pass under the floor: its strip lower than
// k·st·tan(a) above the baseline. The angle is kept under 90deg because
// Firefox evaluates tan() in single precision, where tan(90deg) comes out
// large and negative (no trig support: no clip, still correct otherwise).
// At rest the projection collapses to 2D: a standing face is plain text, and
// side layer k is its glyph scaled by d / (d + k·st) about the camera point
// (--s), so a standing name holds no 3D layers and paints crisp. Flat
// letters' side layers are wholly under the floor, so they are dropped.
const BASE_CSS = `
.s3d-rel{position:relative}
.s3d-on.s3d-on{-webkit-text-fill-color:transparent;text-shadow:none}
.s3d-stage{position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;isolation:isolate;-webkit-user-select:none;user-select:none;-webkit-text-fill-color:currentcolor;text-shadow:none;text-decoration:none;text-transform:none;letter-spacing:normal;word-spacing:normal;font-kerning:none;font-variant-ligatures:none;white-space:pre;text-align:left;text-indent:0}
.s3d-l{position:absolute;display:block}
.s3d-l>span{position:absolute;left:0;top:0;display:block;height:100%;transform-origin:0 0;transform:translate(var(--cx),var(--cy)) perspective(var(--pd)) translate(calc(0px - var(--cx)),calc(var(--hy) - var(--cy))) rotateX(var(--a,90deg)) translate3d(0,calc(0px - var(--hy)),calc(var(--k,0) * var(--st) * -1))}
.s3d-l>span::before{content:var(--c)}
.s3d-k{color:var(--s3d-side,var(--accent,#E5432F));clip-path:inset(-50% -50% calc(100% - var(--hy) + var(--k) * var(--st) * tan(min(var(--a,90deg),89.9deg))) -50%)}
.s3d-f{color:var(--s3d-face,currentcolor)}
.s3d-up>.s3d-f{transform:none}
.s3d-up>.s3d-k{transform:translate(var(--cx),var(--cy)) scale(var(--s)) translate(calc(0px - var(--cx)),calc(0px - var(--cy)))}
.s3d-down>.s3d-k{display:none}
@media print,(forced-colors:active){.s3d-stage{display:none}.s3d-on.s3d-on{-webkit-text-fill-color:currentcolor}}
`;

function injectBaseStyles() {
  if (document.getElementById('stand3d-base-css')) return;
  const style = document.createElement('style');
  style.id = 'stand3d-base-css';
  style.textContent = BASE_CSS;
  document.head.prepend(style);
}

const live = new Map();     // controller → finish-now hook for reduced motion
const byEl = new WeakMap();
const motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;
let watching = false;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// main.js owns html.reduced (OS setting + the Pause motion button). Pages
// without main.js fall back to the media query.
function isReduced() {
  const root = document.documentElement;
  if (root.classList.contains('reduced')) return true;
  if (root.classList.contains('js')) return false;
  return !!(motionQuery && motionQuery.matches);
}

// easeOutBack whose peak overshoot is `frac` of the full swing. The peak of
// 1 + (c+1)u³ + cu² (u = t−1) is 4c³ / 27(c+1)², solved for c by bisection.
function swingCurve(frac) {
  if (!(frac > 0)) return (t) => 1 - (1 - t) ** 3;
  let lo = 0;
  let hi = 20;
  for (let i = 0; i < 48; i++) {
    const c = (lo + hi) / 2;
    if ((4 * c ** 3) / (27 * (c + 1) ** 2) < frac) lo = c;
    else hi = c;
  }
  const c = (lo + hi) / 2;
  return (t) => {
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  };
}

// '12px' → 12, '0.5em' → 0.5 × em, '10%' / number → a share of `size`,
// function → called with the text box and returns px (see DEFAULTS.camera).
function toPx(v, size, em, box) {
  if (typeof v === 'function') return +v(box) || 0;
  if (typeof v === 'number') return v * size;
  const s = String(v).trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  if (s.endsWith('em')) return n * em;
  if (s.endsWith('%')) return (n / 100) * size;
  return n;
}

function cssString(ch) {
  return `"${[...ch].map((c) => (/["\\\n\r]/.test(c) ? `\\${c.codePointAt(0).toString(16)} ` : c)).join('')}"`;
}

function renderChar(ch, transform, wordStart) {
  if (transform === 'uppercase') return ch.toUpperCase();
  if (transform === 'lowercase') return ch.toLowerCase();
  if (transform === 'capitalize' && wordStart) return ch.toUpperCase();
  return ch;
}

function firstRect(range) {
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    if (rects[i].width > 0.01 || rects[i].height > 0.01) return rects[i];
  }
  return null;
}

// Distance from a text node's line-box top (as Range rects report it) to its
// baseline: a 0×0 inline-block dropped in front of the first visible
// character sits exactly on the baseline. The node is split for the probe
// and merged back straight after.
function ascentOf(node, idx, len) {
  let target = node;
  let probe = null;
  try {
    if (idx > 0) target = node.splitText(idx);
    probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline';
    target.parentNode.insertBefore(probe, target);
    const bottom = probe.getBoundingClientRect().bottom;
    const range = document.createRange();
    range.setStart(target, 0);
    range.setEnd(target, len);
    const r = firstRect(range);
    return r && bottom >= r.top && bottom <= r.bottom + 1 ? bottom - r.top : null;
  } finally {
    if (probe) probe.remove();
    if (target !== node) {
      node.appendData(target.data);
      target.remove();
    }
  }
}

function skipped(node, el) {
  for (let e = node; e && e !== el; e = e.parentElement) if (e.matches(SKIP)) return true;
  return false;
}

function textNodes(el, stage) {
  const out = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || (stage && stage.contains(n))) continue;
    if (!/\S/.test(n.data)) continue;
    if (skipped(parent, el)) continue;
    out.push(n);
  }
  return out;
}

// Union of the letter boxes, in stage px.
function textBox(letters) {
  if (!letters.length) return { left: 0, top: 0, width: 0, height: 0 };
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const L of letters) {
    l = Math.min(l, L.x);
    t = Math.min(t, L.y);
    r = Math.max(r, L.x + L.w);
    b = Math.max(b, L.y + L.h);
  }
  return { left: l, top: t, width: r - l, height: b - t };
}

function fontDiff(cs, base) {
  const out = {};
  for (const k of FONT_PROPS) if (cs[k] !== base[k]) out[k] = cs[k];
  return out;
}

function watchMotion() {
  if (watching) return;
  watching = true;
  const onChange = () => {
    if (!isReduced()) return;
    live.forEach((finish) => finish());
  };
  window.addEventListener('motion:change', onChange);
  if (motionQuery) {
    if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', onChange);
    else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(onChange);
  }
}

// ------------------------------------------------------------------ makeStand

export function makeStand(el, options = {}) {
  if (!el || el.nodeType !== 1) throw new TypeError('stand3d: makeStand needs an element');
  const prev = byEl.get(el);
  if (prev) prev.destroy();
  watchMotion();
  injectBaseStyles();

  const o = { ...DEFAULTS, ...options, camera: { ...DEFAULTS.camera, ...(options.camera || {}) } };
  const ease = swingCurve(clamp(o.overshoot, 0, 45) / FLAT);

  let letters = [];        // { ch, x, y, w, h, base, baseY, ls, fs, font, node, a, up, down, op, z, key }
  let stage = null;
  let layerCount = 0;
  let geo = null;          // { sx, sy, fontSize }
  let cam = { x: 0, y: 0, d: 1000, st: 1 };
  const order = [];
  let p = clamp(+o.progress || 0, 0, 1);
  let run = null;          // { resolve, t0, dur, from, to }
  let raf = 0;
  let measureRaf = 0;
  let lastSize = '';
  let destroyed = false;
  let enhanced = false;
  let failed = false;
  let waiting = null;      // a play() asked for before the letters exist: { resolve, opts }
  let settleReady;
  const ready = new Promise((r) => { settleReady = r; });

  // ---------------------------------------------------------------- measure

  function measure() {
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const er = el.getBoundingClientRect();
    const sx = el.offsetWidth ? er.width / el.offsetWidth : 1;
    const sy = el.offsetHeight ? er.height / el.offsetHeight : 1;
    const ox = er.left + el.clientLeft * sx;
    const oy = er.top + el.clientTop * sy;
    const out = [];
    const parentStyle = new Map();
    const range = document.createRange();

    for (const node of textNodes(el, stage)) {
      const parent = node.parentElement;
      let ps = parentStyle.get(parent);
      if (!ps) {
        const pcs = getComputedStyle(parent);
        ps = {
          transform: pcs.textTransform,
          ls: parseFloat(pcs.letterSpacing) || 0,
          fs: parseFloat(pcs.fontSize) || fontSize,
          font: parent === el ? {} : fontDiff(pcs, cs),
          hidden: pcs.visibility !== 'visible',
        };
        parentStyle.set(parent, ps);
      }
      if (ps.hidden) continue;

      const s = node.data;
      const first = s.search(/\S/);
      const firstLen = s.codePointAt(first) > 0xffff ? 2 : 1;
      const ascent = ascentOf(node, first, firstLen);
      let wordStart = true;
      for (let i = 0; i < s.length;) {
        const cp = s.codePointAt(i);
        const len = cp > 0xffff ? 2 : 1;
        const raw = s.slice(i, i + len);
        if (/\s/.test(raw)) {
          wordStart = true;
          i += len;
          continue;
        }
        range.setStart(node, i);
        range.setEnd(node, i + len);
        const r = firstRect(range);
        if (r && r.width > 0) {
          const h = r.height / sy;
          out.push({
            ch: renderChar(raw, ps.transform, wordStart),
            x: (r.left - ox) / sx,
            y: (r.top - oy) / sy,
            w: r.width / sx,
            h,
            base: ascent != null ? ascent / sy : h * 0.8,
            ls: ps.ls,
            fs: ps.fs,
            font: ps.font,
          });
        }
        wordStart = false;
        i += len;
      }
    }

    out.forEach((L) => { L.baseY = L.y + L.base; });

    const w = el.clientWidth || er.width / sx;
    const h = el.clientHeight || er.height / sy;
    return { letters: out, fontSize, sx, sy, w, h, left: ox, top: oy };
  }

  // ------------------------------------------------------------------ build

  // The glyph is CSS generated content (--c on the letter, ::before on each
  // layer), so the overlay adds no text: innerText, copy and crawlers still
  // see the element's own text exactly once.
  function makeLetter(L, n) {
    const wrap = document.createElement('span');
    wrap.className = 's3d-l';
    wrap.style.setProperty('--c', cssString(L.ch));
    for (let k = n; k >= 1; k--) {
      const s = document.createElement('span');
      s.className = 's3d-k';
      s.style.setProperty('--k', String(k));
      wrap.appendChild(s);
    }
    const f = document.createElement('span');
    f.className = 's3d-f';
    wrap.appendChild(f);
    return wrap;
  }

  function layout(m) {
    const depthPx = Math.max(0, o.depth) * m.fontSize;
    const n = o.layers > 0 ? Math.round(o.layers) : clamp(Math.ceil(depthPx / LAYER_PX), MIN_LAYERS, MAX_LAYERS);
    const same = n === layerCount && m.letters.length === letters.length
      && m.letters.every((L, i) => L.ch === letters[i].ch);

    if (!same) {
      stage.textContent = '';
      m.letters.forEach((L) => { L.node = makeLetter(L, n); stage.appendChild(L.node); });
    } else {
      m.letters.forEach((L, i) => { L.node = letters[i].node; });
    }
    m.letters.forEach((L, i) => {
      const old = same ? letters[i] : null;
      L.a = old ? old.a : NaN;
      L.up = old ? old.up : null;
      L.down = old ? old.down : null;
      L.op = old ? old.op : NaN;
    });
    letters = m.letters;
    layerCount = n;
    geo = { sx: m.sx, sy: m.sy, fontSize: m.fontSize };

    // The camera is placed against the text's own extent (the union of the
    // letter boxes), not the element box, which may be much wider.
    const tb = textBox(m.letters);
    const box = { ...tb, fontSize: m.fontSize, elWidth: m.w, elHeight: m.h, originX: m.left, originY: m.top };
    cam = {
      x: tb.left + toPx(o.camera.x, tb.width, m.fontSize, box),
      y: tb.top + toPx(o.camera.y, tb.height, m.fontSize, box),
      d: Math.max(1, toPx(o.perspective, tb.width, m.fontSize, box)),
      st: depthPx / n,
    };
    stage.style.setProperty('--pd', `${cam.d.toFixed(2)}px`);
    stage.style.setProperty('--st', `${cam.st.toFixed(3)}px`);

    for (const L of letters) {
      const st = L.node.style;
      st.left = `${L.x.toFixed(2)}px`;
      st.top = `${L.y.toFixed(2)}px`;
      st.width = `${L.w.toFixed(2)}px`;
      st.height = `${L.h.toFixed(2)}px`;
      st.lineHeight = `${L.h.toFixed(2)}px`;
      st.setProperty('--cx', `${(cam.x - L.x).toFixed(2)}px`);
      st.setProperty('--cy', `${(cam.y - L.y).toFixed(2)}px`);
      st.setProperty('--hy', `${L.base.toFixed(2)}px`);
      for (const k of FONT_PROPS) st[k] = L.font[k] || '';
      const kids = L.node.children;
      for (let j = 0; j < n; j++) {
        kids[j].style.setProperty('--s', (cam.d / (cam.d + (n - j) * cam.st)).toFixed(6));
      }
      L.z = -1;
    }
  }

  // ------------------------------------------------------------------- pose

  // Painter's order: each letter (its side layers, then its face) is one
  // stacking unit, and units paint farthest first, measured from the camera
  // (cam.x, cam.y, +d) to the letter's mid-height point at its current angle.
  // That puts letters nearer the vanishing point over the extrusions that run
  // behind them, upper lines over lower ones, and upright letters over the
  // rising and flat ones beside them.
  function pose() {
    const n = letters.length;
    if (!n) return;
    const stag = Math.max(0, +o.stagger || 0);
    const span = 1 / (1 + stag * (n - 1));
    const fade = clamp(+o.fade || 0, 0, 1);
    for (let i = 0; i < n; i++) {
      const L = letters[i];
      const t = clamp((p - i * stag * span) / span, 0, 1);
      const a = t >= 1 ? 0 : FLAT * (1 - ease(t));
      if (!(Math.abs(a - L.a) < 0.01)) {
        L.node.style.setProperty('--a', `${a.toFixed(3)}deg`);
        L.a = a;
      }
      const up = t >= 1;
      if (up !== L.up) {
        L.node.classList.toggle('s3d-up', up);
        L.up = up;
      }
      const down = t <= 0;
      if (down !== L.down) {
        L.node.classList.toggle('s3d-down', down);
        L.down = down;
      }
      const op = fade > 0 ? clamp(t / fade, 0, 1) : 1;
      if (op !== L.op) {
        if (op >= 1) L.node.style.removeProperty('opacity');
        else L.node.style.opacity = op.toFixed(3);
        L.op = op;
      }
      const u = L.fs * 0.35;
      const r = (a * Math.PI) / 180;
      const dx = L.x + L.w / 2 - cam.x;
      const dy = L.baseY - u * Math.cos(r) - cam.y;
      const dz = cam.d + u * Math.sin(r);
      L.key = dx * dx + dy * dy + dz * dz;
    }
    order.length = 0;
    for (let i = 0; i < n; i++) order.push(i);
    order.sort((i, j) => letters[j].key - letters[i].key || j - i);
    for (let k = 0; k < n; k++) {
      const L = letters[order[k]];
      if (L.z !== k + 1) {
        L.node.style.zIndex = String(k + 1);
        L.z = k + 1;
      }
    }
  }

  function setP(v) {
    p = clamp(v, 0, 1);
    if (enhanced) pose();
    if (typeof o.onUpdate === 'function') {
      try { o.onUpdate(p); } catch (e) { console.warn(`[stand3d] onUpdate: ${e && e.message}`); }
    }
  }

  // ---------------------------------------------------------------- refresh

  function refresh() {
    if (destroyed || !enhanced) return;
    measureRaf = 0;
    layout(measure());
    pose();
  }

  function scheduleRefresh() {
    if (destroyed || measureRaf) return;
    measureRaf = requestAnimationFrame(refresh);
  }

  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect;
      const key = `${Math.round(r.width * 10)}x${Math.round(r.height * 10)}`;
      if (key === lastSize) return;
      lastSize = key;
      scheduleRefresh();
    })
    : null;
  const onFonts = () => scheduleRefresh();
  const onWinResize = () => scheduleRefresh();

  // ------------------------------------------------------------------ timing

  function stopRun(completed) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    const r = run;
    run = null;
    if (r) r.resolve(completed);
  }

  function tick(now) {
    raf = 0;
    const r = run;
    if (!r) return;
    const k = clamp((now - r.t0) / r.dur, 0, 1);
    setP(r.from + (r.to - r.from) * k);
    if (k >= 1) {
      run = null;
      r.resolve(true);
    } else {
      raf = requestAnimationFrame(tick);
    }
  }

  function dropWaiting(result) {
    const w = waiting;
    waiting = null;
    if (w) w.resolve(result);
  }

  function play(opts = {}) {
    const { delay = 0, duration = 1200, to = 1 } = opts;
    if (destroyed) return Promise.resolve(false);
    stopRun(false);
    dropWaiting(false);
    const target = clamp(+to, 0, 1);
    if (!enhanced && !failed) {
      // Not built yet (styles still pending): play once it is.
      return new Promise((resolve) => { waiting = { resolve, opts }; });
    }
    if (isReduced() || failed) {
      setP(target);
      return Promise.resolve(true);
    }
    const dist = Math.abs(target - p);
    if (dist < 1e-4) {
      setP(target);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      run = {
        resolve,
        t0: performance.now() + Math.max(0, +delay || 0),
        dur: Math.max(1, (+duration || 0) * dist),
        from: p,
        to: target,
      };
      raf = requestAnimationFrame(tick);
    });
  }

  // ------------------------------------------------------------------- public

  const api = {
    get el() { return el; },
    get progress() { return p; },
    get count() { return letters.length; },
    get playing() { return !!run; },
    get enhanced() { return enhanced; },
    // Resolves true once the 3D letters exist, false if they never will.
    get ready() { return ready; },

    // Scroll-driven pose. Reduced motion: no in-between poses, only flat
    // (p < .5) or standing.
    setProgress(v) {
      if (destroyed) return api;
      stopRun(false);
      dropWaiting(false);
      const x = clamp(+v || 0, 0, 1);
      setP(isReduced() ? (x < 0.5 ? 0 : 1) : x);
      return api;
    },

    // Time-driven stand-up. Resolves true when it reaches the end, false if
    // setProgress / another play / fold / destroy interrupts it.
    play,

    // Time-driven fold back down (the reverse of play: the last letter goes first).
    fold(opts = {}) {
      return play({ ...opts, to: 0 });
    },

    // Where a period after the last letter sits, in viewport px: its left
    // edge x and the baseline y, plus a disc of the configured size resting
    // on the baseline (cx, cy, r). Pose-independent: the hinge is the
    // baseline. One layout read; call it when you need it, not per frame.
    endPoint() {
      const er = el.getBoundingClientRect();
      const last = letters[letters.length - 1];
      const fsLast = last ? last.fs : parseFloat(getComputedStyle(el).fontSize) || 16;
      const sx = geo ? geo.sx : 1;
      const sy = geo ? geo.sy : 1;
      const r = (o.period * fsLast * sx) / 2;
      let x;
      let y;
      if (last) {
        const ox = er.left + el.clientLeft * sx;
        const oy = er.top + el.clientTop * sy;
        x = ox + (last.x + last.w - Math.max(0, last.ls) + o.gap * fsLast) * sx;
        y = oy + last.baseY * sy;
      } else {
        x = er.right + o.gap * fsLast * sx;
        y = er.bottom;
      }
      return {
        x, y, r, cx: x + r, cy: y - r, fontSize: fsLast * sx,
        pageX: x + window.scrollX, pageY: y + window.scrollY,
      };
    },

    // The shared camera (perspective origin) in viewport px, and its distance
    // d in px: the letters' vanishing point, for lining up a floor with them.
    // One layout read.
    cameraPoint() {
      const er = el.getBoundingClientRect();
      const sx = geo ? geo.sx : 1;
      const sy = geo ? geo.sy : 1;
      const x = er.left + el.clientLeft * sx + cam.x * sx;
      const y = er.top + el.clientTop * sy + cam.y * sy;
      return { x, y, d: cam.d * sx };
    },

    // Re-measure now (layout changed in a way ResizeObserver cannot see).
    refresh() {
      if (measureRaf) cancelAnimationFrame(measureRaf);
      measureRaf = 0;
      refresh();
      return api;
    },

    destroy() {
      if (destroyed) return;
      stopRun(false);
      dropWaiting(false);
      destroyed = true;
      settleReady(enhanced);
      if (measureRaf) cancelAnimationFrame(measureRaf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onWinResize);
      if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onFonts);
      if (stage) stage.remove();
      el.classList.remove('s3d-on', 's3d-rel');
      el.classList.add('s3d-off');
      live.delete(api);
      if (byEl.get(el) === api) byEl.delete(el);
    },

  };

  function finishNow() {
    if (run) {
      const to = run.to;
      stopRun(true);
      setP(to);
    }
  }

  // ------------------------------------------------------------------- start

  stage = document.createElement('span');
  stage.className = 's3d-stage';
  stage.setAttribute('aria-hidden', 'true');
  el.appendChild(stage);

  // WebKit leaves new rules unresolved while a render-blocking stylesheet is
  // still loading, so the overlay may not be placeable yet: keep the pose
  // (and any play() asked for) and try again on load, then briefly after.
  // If the styles never apply, leave the text alone.
  function start(attempt) {
    if (destroyed) return;
    if (getComputedStyle(stage).position !== 'absolute') {
      if (document.readyState !== 'complete') {
        window.addEventListener('load', () => start(attempt), { once: true });
      } else if (attempt < 20) {
        setTimeout(() => start(attempt + 1), 50);
      } else {
        stage.remove();
        failed = true;
        el.classList.add('s3d-off');
        console.warn('[stand3d] base styles are not applied; leaving the text as it is');
        settleReady(false);
        if (waiting) {
          const w = waiting;
          waiting = null;
          play(w.opts).then(w.resolve);
        }
      }
      return;
    }
    if (getComputedStyle(el).position === 'static') el.classList.add('s3d-rel');
    layout(measure());
    el.classList.add('s3d-on');
    enhanced = true;
    setP(isReduced() ? (p < 0.5 ? 0 : 1) : p);
    if (ro) ro.observe(el);
    window.addEventListener('resize', onWinResize);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', onFonts);
    settleReady(true);
    if (waiting) {
      const w = waiting;
      waiting = null;
      play(w.opts).then(w.resolve);
    }
  }

  el.classList.remove('s3d-off');
  byEl.set(el, api);
  live.set(api, finishNow);
  start(0);
  return api;
}

export function getStand(el) {
  return byEl.get(el) || null;
}

// ----------------------------------------------------------------- auto mode

function fontShorthand(el) {
  const cs = getComputedStyle(el);
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

// Resolves once the element's own font is in (or after a timeout), plus one
// frame so layout has caught up.
export function fontsReady(el, timeout = FONTS_TIMEOUT) {
  const waits = [];
  if (document.fonts) {
    if (document.fonts.ready) waits.push(document.fonts.ready);
    if (el && typeof document.fonts.load === 'function') {
      waits.push(document.fonts.load(fontShorthand(el), el.textContent || 'A').catch(() => {}));
    }
  }
  const all = Promise.all(waits).catch(() => {});
  const cap = new Promise((r) => setTimeout(r, timeout));
  return Promise.race([all, cap]).then(() => new Promise((r) => requestAnimationFrame(() => r())));
}

const num = (v, d) => (v != null && v !== '' && Number.isFinite(+v) ? +v : d);

function optionsFromData(el) {
  const d = el.dataset;
  const out = {};
  if (d.stand3dDepth) out.depth = num(d.stand3dDepth, DEFAULTS.depth);
  if (d.stand3dStagger) out.stagger = num(d.stand3dStagger, DEFAULTS.stagger);
  if (d.stand3dOvershoot) out.overshoot = num(d.stand3dOvershoot, DEFAULTS.overshoot);
  return out;
}

function announce(el, stand, completed) {
  el.dispatchEvent(new CustomEvent('stand3d:done', { bubbles: true, detail: { stand, completed } }));
}

// Auto-enhances only elements that opt into auto-play:
//   data-stand3d="load"  stands up once, right after its font is ready
//   data-stand3d="view"  stands up once, when 40 % of it is on screen
// with optional data-stand3d-delay / -duration (ms) and -depth / -stagger /
// -overshoot. Anything else carrying data-stand3d is left to whoever calls
// makeStand(). Fires `stand3d:done` {stand, completed} on the element.
export function init() {
  const els = [...document.querySelectorAll('[data-stand3d]')]
    .filter((el) => /\b(load|view)\b/.test(el.getAttribute('data-stand3d') || '') && !byEl.has(el));
  if (!els.length) return;
  let io = null;
  const pending = new WeakMap();

  for (const el of els) {
    try {
      const mode = /\bview\b/.test(el.getAttribute('data-stand3d')) ? 'view' : 'load';
      const stand = makeStand(el, { ...optionsFromData(el), progress: isReduced() ? 1 : 0 });
      const timing = {
        delay: num(el.dataset.stand3dDelay, 0),
        duration: num(el.dataset.stand3dDuration, 1200),
      };
      const go = () => fontsReady(el)
        .then(() => { stand.refresh(); return stand.play(timing); })
        .then((done) => announce(el, stand, done))
        .catch((e) => console.warn(`[stand3d] ${e && e.message}`));

      if (mode === 'load' || typeof IntersectionObserver !== 'function') {
        go();
      } else {
        if (!io) {
          io = new IntersectionObserver((entries) => {
            for (const en of entries) {
              if (!en.isIntersecting) continue;
              io.unobserve(en.target);
              const fn = pending.get(en.target);
              pending.delete(en.target);
              if (fn) fn();
            }
          }, { threshold: 0.4 });
        }
        pending.set(el, go);
        io.observe(el);
      }
    } catch (e) {
      console.warn(`[stand3d] ${e && e.message}`);
    }
  }
}
