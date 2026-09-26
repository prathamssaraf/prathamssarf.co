// Skills rings. Each .rings-row becomes a line of uppercase words with red dot
// separators, laid on an SVG textPath. Scroll progress p through the tall
// .rings-track drives three phases:
//   0 – .35  straight marquees streaming in alternating directions
//   .35 – .6 each path bends from a line into a full circle: an arc of angle
//            2πk with radius L / 2πk (k = 0 is the straight line), so the path
//            length L never changes and the text never reflows
//   .6 – 1   concentric rings rotating in alternating directions around
//            #rings-center; at the very end they spin up and fold into the dot
// Motion blur is physical: it scales with how far the text moved this frame
// (a horizontal Gaussian while the rows are nearly straight, a light
// compositor blur once the rings spin).
//
// Every item is always drawn. Phones spread all rows over 4 solid rings (5 if
// the type would otherwise drop under MIN_FONT). On phones, or when any ring's
// type is under LIST_FONT, the section gets .skills--list and site.css shows
// the real categorized list after the pinned stage.
//
// Every ring is its own <svg>. Once a ring is a full circle its SVG shrinks to
// a square around it and spins as a compositor layer (CSS transform), so the
// glyphs are rasterised once instead of being re-painted at a new angle every
// frame.

const SVGNS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const TAU = Math.PI * 2;
const SEP = '•';
const GAP_EM = 0.6; // space either side of a separator
const MIN_GAP_EM = 0.3;
const MIN_FONT = 8;
const LIST_FONT = 11;
const MOBILE_RINGS = [4, 5];

const BEND_START = 0.34;
const BEND_LEN = 0.2;
const BEND_STAGGER = 0.012; // per ring, outermost first
const COLLAPSE_START = 0.9;
const ENTRY_MS = 1250;
const ENTRY_STAGGER = 85;
const SCROLL_GAIN = 0.4; // px of travel per px scrolled
const MAX_BLUR = 22;
const CAP_MID_EM = 0.35; // half of Montserrat's cap height (.7em)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const inOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const inCubic = (t) => t * t * t;
const f2 = (v) => Math.round(v * 100) / 100;
const mod = (a, n) => ((a % n) + n) % n;

let uid = 0;

function el(name, attrs, parent) {
  const n = document.createElementNS(SVGNS, name);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function link(node, id) {
  node.setAttribute('href', `#${id}`);
  node.setAttributeNS(XLINK, 'xlink:href', `#${id}`);
}

// Path of length L whose midpoint sits at (cx, yM) with a horizontal tangent,
// bent into an arc of angle 2πk. Four cubic segments (each ≤ 90°), written in
// a form that stays exact as k → 0 where the radius goes to infinity.
function arcPath(cx, yM, L, k) {
  const th = TAU * Math.min(k, 0.99999);
  const small = th < 1e-6;
  const pt = (u) => {
    // u ∈ [-.5, .5] is the fraction of the length from the midpoint
    const a = u * th;
    const x = small ? u * L : (Math.sin(a) / th) * L;
    const y = small ? 0 : ((2 * Math.sin(a / 2) * Math.sin(a / 2)) / th) * L;
    return [cx + x, yM + y, Math.cos(a), Math.sin(a)];
  };
  // Bézier handle for a quarter of the arc: (4/3)·tan(θ/16)·R, R = L/θ.
  const h = small ? L / 12 : (4 / 3) * Math.tan(th / 16) * (L / th);
  let p = pt(-0.5);
  let d = `M${f2(p[0])} ${f2(p[1])}`;
  for (let s = 1; s <= 4; s++) {
    const q = pt(-0.5 + s / 4);
    d += `C${f2(p[0] + h * p[2])} ${f2(p[1] + h * p[3])} ${f2(q[0] - h * q[2])} ${f2(q[1] - h * q[3])} ${f2(q[0])} ${f2(q[1])}`;
    p = q;
  }
  return d;
}

function readRows(root) {
  return [...root.querySelectorAll('.rings-row')]
    .map((ul) => [...ul.querySelectorAll('li')]
      .map((li) => li.textContent.replace(/\s+/g, ' ').trim().toUpperCase())
      .filter(Boolean))
    .filter((row) => row.length);
}

class Rings {
  constructor(root) {
    this.root = root;
    this.section = root.closest('section') || root.parentElement || root;
    // The tall box whose scroll drives the phases (the stage is pinned in it).
    this.track = root.closest('.rings-track') || this.section;
    this.stage = root.closest('.rings-stage') || root;
    this.center = root.querySelector('#rings-center') || document.getElementById('rings-center');
    this.rows = readRows(root);
    if (!this.rows.length) throw new Error('rings: no .rings-row items');
    this.id = ++uid;

    const html = document.documentElement;
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reduced = html.classList.contains('reduced') || !!(mq && mq.matches);

    this.box = document.createElement('div');
    this.box.className = 'rings-layers';
    this.box.setAttribute('aria-hidden', 'true');
    const meter = el('svg', { class: 'rings-meter', 'aria-hidden': 'true', focusable: 'false' });
    this.meter = el('text', { class: 'rt' }, meter);
    root.append(this.box, meter);
    root.classList.add('rings--live');

    this.rings = [];
    this.running = false;
    this.collapsed = false;
    this.raf = 0;
    this.last = 0;
    this.lastY = window.scrollY;
    this.entered = this.reduced;
    this.entryT0 = -1e9;
    this.W = 0;
    this.H = 0;

    this.tick = this.tick.bind(this);
    this.queueLayout = this.queueLayout.bind(this);

    this.layout(true);
    this.listen(mq);
  }

  listen(mq) {
    if ('ResizeObserver' in window) new ResizeObserver(this.queueLayout).observe(this.root);
    window.addEventListener('resize', this.queueLayout);
    if (document.fonts) {
      // New fonts change every measurement, so these always rebuild.
      const refit = () => this.queueLayout(true);
      document.fonts.ready.then(refit);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', refit);
      // SVG text alone may not trigger the webfont download.
      ['800', '900'].forEach((w) => document.fonts.load(`${w} 32px Montserrat`, 'SKILLS').then(refit, () => {}));
    }
    const setReduced = (on) => {
      if (on === this.reduced) return;
      this.reduced = on;
      this.entered = true;
      this.entryT0 = -1e9;
      this.layout(true);
      this.wake();
    };
    const html = document.documentElement;
    window.addEventListener('motion:change', (e) => {
      setReduced(e.detail && typeof e.detail.reduced === 'boolean' ? e.detail.reduced : html.classList.contains('reduced'));
    });
    // Fallback only. main.js updates html.reduced first, including the
    // visitor's own pause, which the raw media query knows nothing about.
    if (mq && mq.addEventListener) mq.addEventListener('change', () => setReduced(html.classList.contains('reduced')));

    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        this.running = entries[entries.length - 1].isIntersecting;
        this.wake();
      }, { rootMargin: '15% 0px' }).observe(this.track);
    } else {
      this.running = true;
    }
    // Folded into the dot, the rings stop drawing; the observer stays quiet
    // while the track is in range, so scrolling is what restarts them.
    window.addEventListener('scroll', () => {
      if (!this.collapsed) return;
      this.collapsed = false;
      this.wake();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => this.wake());
  }

  queueLayout(force) {
    if (force === true) this.forceLayout = true;
    if (this.layoutQueued) return;
    this.layoutQueued = true;
    requestAnimationFrame(() => {
      this.layoutQueued = false;
      this.layout(this.forceLayout);
      this.forceLayout = false;
      this.wake();
    });
  }

  // ---------------------------------------------------------------- measure

  measure(cls, size, items) {
    const t = this.meter;
    t.setAttribute('class', cls);
    t.style.fontSize = `${size}px`;
    t.textContent = '';
    for (const item of items) {
      el('tspan', null, t).textContent = item;
      el('tspan', { class: 'rs' }, t).textContent = SEP;
    }
    const len = t.getComputedTextLength();
    // WebKit renders CSS letter-spacing on SVG text but leaves it out of
    // getComputedTextLength(); add it back (separators carry it too).
    if (this.lsMissing === undefined) {
      const saved = t.style.letterSpacing;
      t.style.letterSpacing = '0px';
      const a = t.getComputedTextLength();
      t.style.letterSpacing = '10px';
      const b = t.getComputedTextLength();
      t.style.letterSpacing = saved;
      this.lsMissing = t.getNumberOfChars() > 0 && Math.abs(b - a) < 0.5;
    }
    if (!this.lsMissing) return len;
    return len + t.getNumberOfChars() * (parseFloat(getComputedStyle(t).letterSpacing) || 0);
  }

  // Font size, cycle count n and gap so that n copies of the items fill L
  // exactly. Never drops an item: a tight ring just gets smaller type.
  fit(cls, items, L, target) {
    const g1 = this.measure(cls, 100, items) / 100; // text width per px of font
    const x = L / ((g1 + 2 * items.length * GAP_EM) * target);
    const n = Math.max(1, Math.round(x));
    // Largest size that still leaves the minimum gap around each separator.
    const room = (L / n) / (g1 + 2 * items.length * MIN_GAP_EM);
    const f = Math.min(target * Math.min(1.18, Math.max(0.85, x / n)), room);
    const w = this.measure(cls, f, items);
    const gap = Math.max(0, (L / n - w) / (2 * items.length));
    return { items, n, f, gap };
  }

  // ---------------------------------------------------------------- layout

  layout(force) {
    const rr = this.root.getBoundingClientRect();
    const sr = this.stage.getBoundingClientRect();
    if (!rr.width || !rr.height) return;
    const cr = this.center ? this.center.getBoundingClientRect() : null;
    const has = cr && cr.width > 0;
    const ccx = has ? cr.left + cr.width / 2 : rr.left + rr.width / 2;
    const ccy = has ? cr.top + cr.height / 2 : rr.top + rr.height / 2;
    const dotR = has ? cr.width / 2 : 9;
    const mobile = window.innerWidth < 768;
    // Mobile URL-bar resizes etc. fire often; rebuild only when geometry moved.
    const sig = [rr.width, rr.height, sr.width, sr.height, sr.left - rr.left, sr.bottom - rr.top,
      ccx - rr.left, ccy - rr.top, dotR, mobile].map((v) => (typeof v === 'number' ? Math.round(v) : v)).join();
    if (!force && sig === this.sig && this.rings.length) return;
    this.sig = sig;

    // The layers span the stage's full width (edge-to-edge marquees) and run
    // from the top of the rings box to the bottom of the stage.
    const left = Math.min(0, sr.left - rr.left);
    const W = Math.max(rr.width, sr.width);
    const H = Math.max(rr.height, sr.bottom - rr.top);
    Object.assign(this.box.style, { left: `${f2(left)}px`, top: '0px', width: `${f2(W)}px`, height: `${f2(H)}px` });
    this.W = W;
    this.H = H;
    this.cx = ccx - rr.left - left;
    this.cy = ccy - rr.top;

    // Rings stay inside the rings box (clear of the heading above it).
    const room = Math.min(ccx - rr.left, rr.right - ccx, ccy - rr.top, rr.bottom - ccy);
    const rOuter = Math.max(60, room * (mobile ? 0.94 : 0.9));
    const rInner = Math.max(dotR * 4, rOuter * (mobile ? 0.5 : 0.3));
    let plan = [];
    for (const count of mobile ? MOBILE_RINGS : [Math.min(7, this.rows.length)]) {
      plan = this.plan(count, rOuter, rInner, mobile);
      if (plan.every((g) => g.fit.f >= MIN_FONT)) break;
    }

    const old = this.rings;
    this.box.textContent = '';
    this.rings = plan.map((g, i) => this.buildRing(i, g.r, g.L, g.cls, g.fit, old[i]));
    this.meter.textContent = '';
    // The phone layout mixes every category into the rings, and small type on
    // a spinning ring is hard to read: show the real list after the stage.
    this.section.classList.toggle('skills--list', mobile || this.rings.some((g) => g.f < LIST_FONT));

    // Straight rows stack around the centre. The dot must fall between two
    // rows (an odd count sits half a row low), with the gap clearing the dot
    // by ~4px above and below the caps, which buildRing centres on the path.
    const count = this.rings.length;
    const maxF = Math.max(...this.rings.map((g) => g.f));
    const gapY = Math.max(maxF * 2.05, 2 * (dotR + CAP_MID_EM * maxF + 4));
    const shift = count % 2 ? 0.5 : 0;
    this.rings.forEach((g, i) => { g.yRow = this.cy + (i - (count - 1) / 2 + shift) * gapY; });
    this.render(performance.now(), 0, true);
  }

  // Radii, rows and fitted type for `count` rings from rOuter in to rInner.
  plan(count, rOuter, rInner, mobile) {
    const step = count > 1 ? (rOuter - rInner) / (count - 1) : 0;
    const span = rOuter - rInner || 1;
    const radii = Array.from({ length: count }, (_, i) => rOuter - i * step);
    const lengths = radii.map((r) => TAU * r);
    const lists = this.assign(count, lengths, mobile);
    return radii.map((r, i) => {
      // Phones get solid type only: 1px outline glyphs smear at that size.
      const cls = mobile ? 'rt rt--solid'
        : i === 0 ? 'rt rt--solid rt--wide' : i % 2 ? 'rt rt--outline' : 'rt rt--solid';
      const target = count > 1 ? step * mix(0.42, 0.56, (r - rInner) / span) : r * 0.12;
      const fit = this.fit(cls, lists[i], lengths[i], Math.max(10, Math.min(34, target)));
      return { r, L: lengths[i], cls, fit };
    });
  }

  // Desktop: one row per ring, longest row outermost. Mobile: the items of all
  // rows, in order, spread over the rings in proportion to their circumference.
  assign(count, lengths, mobile) {
    const cls = 'rt rt--solid';
    if (!mobile && count >= this.rows.length) {
      return this.rows
        .map((row) => ({ row, w: this.measure(cls, 100, row) }))
        .sort((a, b) => b.w - a.w)
        .map((x) => x.row);
    }
    const items = this.rows.flat();
    const widths = items.map((it) => this.measure(cls, 100, [it]) + 2 * GAP_EM * 100);
    const total = widths.reduce((a, b) => a + b, 0);
    const sumL = lengths.reduce((a, b) => a + b, 0);
    const out = Array.from({ length: count }, () => []);
    let ring = 0;
    let acc = 0;
    let quota = (total * lengths[0]) / sumL;
    items.forEach((it, j) => {
      const left = items.length - j;
      const ringsLeft = count - ring - 1;
      if (ring < count - 1 && out[ring].length && (acc + widths[j] / 2 > quota || left <= ringsLeft)) {
        ring++;
        quota += (total * lengths[ring]) / sumL;
      }
      out[ring].push(it);
      acc += widths[j];
    });
    return out.map((list, i) => (list.length ? list : [items[i % items.length]]));
  }

  buildRing(i, r, L, cls, fit, prev) {
    const id = `${this.id}-${i}`;
    const pathId = `rp-${id}`;
    const svg = el('svg', { class: 'rings-svg', focusable: 'false' });
    const defs = el('defs', null, svg);
    const path = el('path', { id: pathId }, defs);

    // End fade for the straight rows (whose ends are visible on wide screens).
    const grad = el('linearGradient', { id: `rgr-${id}`, gradientUnits: 'userSpaceOnUse', y1: '0', y2: '0' }, defs);
    const stops = [0, 1, 1, 0].map(() => el('stop', { 'stop-color': '#fff', offset: '0' }, grad));
    const mask = el('mask', { id: `rm-${id}`, maskUnits: 'userSpaceOnUse' }, defs);
    const maskRect = el('rect', { fill: `url(#rgr-${id})` }, mask);

    const blur = el('filter', { id: `rb-${id}`, x: '-12%', y: '-60%', width: '124%', height: '220%', 'color-interpolation-filters': 'sRGB' }, defs);
    const gauss = el('feGaussianBlur', { stdDeviation: '0 0' }, blur);

    const gm = el('g', null, svg);
    const gf = el('g', null, gm);
    const text = el('text', { class: cls }, gf);
    text.style.fontSize = `${f2(fit.f)}px`;
    const tp = el('textPath', { startOffset: '0' }, text);
    link(tp, pathId);
    const gap = f2(fit.gap);
    for (let c = 0; c < fit.n * 2; c++) {
      for (const item of fit.items) {
        el('tspan', { dx: gap }, tp).textContent = item;
        el('tspan', { dx: gap, class: 'rs' }, tp).textContent = SEP;
      }
    }
    // Centre the caps on the path. WebKit ignores dominant-baseline="central"
    // on textPath and stands the glyphs on the path, half a cap too high. A
    // dy on the first glyph moves it, and every glyph after it, the same
    // distance across the path in every engine.
    tp.firstChild.setAttribute('dy', f2(CAP_MID_EM * fit.f));
    this.box.appendChild(svg);

    return {
      i, r, L, f: fit.f, n: fit.n,
      dir: i % 2 ? -1 : 1,
      speed: 26 + r * 0.075,
      s: prev ? prev.s : i * 97.3,
      k: -1, yM: NaN, yRow: 0,
      svg, path, grad, stops, mask, maskRect, gauss,
      gm, gf, text, tp,
      blurV: 0, lastEx: null, flow: 1,
      mode: '',
      w: {},
    };
  }

  // 'full': the SVG covers the whole stage (straight or bending rows).
  // 'ring': a square around the finished circle, spun on the compositor.
  setMode(g, mode) {
    if (g.mode === mode) return;
    g.mode = mode;
    const { cx, cy, W, H } = this;
    const st = g.svg.style;
    if (mode === 'ring') {
      const s = Math.ceil(g.r + g.f * 0.9 + 6);
      g.svg.setAttribute('viewBox', `${f2(cx - s)} ${f2(cy - s)} ${2 * s} ${2 * s}`);
      Object.assign(st, { left: `${f2(cx - s)}px`, top: `${f2(cy - s)}px`, width: `${2 * s}px`, height: `${2 * s}px`, transformOrigin: '50% 50%' });
      st.willChange = this.reduced ? '' : 'transform';
    } else {
      g.svg.setAttribute('viewBox', `0 0 ${f2(W)} ${f2(H)}`);
      Object.assign(st, { left: '0px', top: '0px', width: `${f2(W)}px`, height: `${f2(H)}px`, transformOrigin: `${f2(cx)}px ${f2(cy)}px` });
      st.willChange = '';
    }
  }

  // ---------------------------------------------------------------- frame

  wake() {
    if (!this.raf && this.running && !this.reduced && !document.hidden) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  tick(now) {
    this.raf = 0;
    if (!this.running || this.reduced || document.hidden) return;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.render(now, dt, false);
    if (this.collapsed) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  render(now, dt, force) {
    if (!this.rings.length) return;
    // Reads first, then writes.
    const vh = window.innerHeight || 1;
    const rect = this.track.getBoundingClientRect();
    const span = rect.height - vh;
    const p = span > 1 ? clamp01(-rect.top / span) : rect.top <= 0 ? 1 : 0;
    const c = this.entered ? null : (this.center || this.root).getBoundingClientRect();
    const y = window.scrollY;
    const scrolled = Math.min(240, Math.abs(y - this.lastY));
    this.lastY = y;
    const reduced = this.reduced;

    if (c && (c.top + c.bottom) / 2 < vh * 0.8 && c.bottom > 0) {
      this.entered = true;
      // Arriving mid-section (deep link, fast jump): no entrance.
      this.entryT0 = p > 0.25 ? -1e9 : now;
    }
    const q = reduced ? 0 : smooth(COLLAPSE_START, 1, p);
    this.collapsed = !reduced && p >= 1; // every ring is invisible from here
    const frameScale = dt > 0 ? (1 / 60) / dt : 1;
    this.frame = (this.frame || 0) + 1;
    if (dt > 0) this.load = (this.load || 0) + ((dt > 0.024 ? 1 : 0) - (this.load || 0)) * 0.15;
    const { cx, cy, W } = this;

    for (const g of this.rings) {
      const k = reduced ? 1 : inOutCubic(clamp01((p - BEND_START - g.i * BEND_STAGGER) / BEND_LEN));
      const ring = k >= 1;
      this.setMode(g, ring ? 'ring' : 'full');
      const w = g.w;

      // Travel along the path: time + scroll, faster while straight, spinning up
      // at the end. Glyphs sliding along a curve are re-rasterised at a new
      // angle every frame, so mid-bend the time-based flow rests (the row only
      // moves with the scroll) and eases back in once it is straight again or
      // a closed ring, whose spin is compositor-only.
      const flowTo = k <= 0 || k >= 1 ? 1 : 0;
      g.flow = flowTo < g.flow || force ? flowTo : g.flow + (flowTo - g.flow) * (1 - Math.exp(-dt / 0.4));
      const ds = reduced ? 0 : g.speed * g.flow * (1 + 0.6 * (1 - k)) * (1 + 9 * q * q) * dt + SCROLL_GAIN * scrolled;
      g.s += g.dir * ds;
      // Under load, bending rows take turns (each still updates at half rate).
      if (!force && this.load > 0.5 && k > 0 && k < 1 && ((this.frame + g.i) & 1)) continue;

      // Entrance: rows slam in from alternating sides (dir +1 flows left, so it
      // arrives from the right).
      let ex = 0;
      if (!reduced) {
        const t = this.entered ? clamp01((now - this.entryT0 - g.i * ENTRY_STAGGER) / ENTRY_MS) : 0;
        ex = g.dir * (1 - expoOut(t)) * W * 1.25;
      }
      const moved = Math.abs(ds) + (g.lastEx === null ? 0 : Math.abs(ex - g.lastEx));
      g.lastEx = ex;
      g.blurV = reduced ? 0 : g.blurV + (moved * frameScale - g.blurV) * 0.35;

      // Geometry: only rewritten while the path is actually changing.
      const yM = mix(g.yRow, cy - g.r, k);
      if (k !== g.k || yM !== g.yM || force) {
        g.path.setAttribute('d', arcPath(cx, yM, g.L, k));
        g.k = k;
        g.yM = yM;
      }
      const phase = mod(g.s, g.L);
      // A full circle turns instead of sliding its text (identical result).
      const off = ring ? '0' : String(f2(-phase));
      if (off !== w.off) g.tp.setAttribute('startOffset', (w.off = off));

      const sc = f2(1 - 0.92 * inCubic(q));
      let tr;
      if (ring) {
        const rot = f2((-phase / g.r) * (180 / Math.PI));
        tr = `rotate(${rot}deg)${sc !== 1 ? ` scale(${sc})` : ''}`;
      } else {
        tr = `${ex ? `translate3d(${f2(ex)}px,0,0)` : ''}${sc !== 1 ? ` scale(${sc})` : ''}`;
      }
      if (tr !== w.tr) g.svg.style.transform = w.tr = tr;
      const op = String(f2(1 - smooth(0.4, 1, q)));
      if (op !== w.op) g.svg.style.opacity = w.op = op;

      // Motion blur: horizontal while nearly straight, and a light compositor
      // blur once the rings spin fast.
      const hb = Math.min(MAX_BLUR, g.blurV * 0.8) * (1 - smooth(0.12, 0.45, k));
      const wantFilter = hb > 0.35;
      if (wantFilter) {
        const sd = `${f2(hb)} 0`;
        if (sd !== w.sd) g.gauss.setAttribute('stdDeviation', (w.sd = sd));
      }
      if (wantFilter !== !!w.filt) {
        if (wantFilter) g.gf.setAttribute('filter', `url(#rb-${this.id}-${g.i})`);
        else g.gf.removeAttribute('filter');
        w.filt = wantFilter;
      }
      const cb = ring ? f2(Math.min(2.5, Math.max(0, g.blurV - 3) * 0.12)) : 0;
      const cf = cb > 0.15 ? `blur(${cb}px)` : '';
      if (cf !== (w.cf || '')) g.svg.style.filter = w.cf = cf;

      // Soft ends while the rows are (nearly) straight.
      const wantMask = !reduced && k < 0.3;
      if (wantMask) {
        if (!w.maskSet) {
          const fade = Math.min(150, g.L * 0.14);
          const x1 = cx - g.L / 2;
          g.grad.setAttribute('x1', f2(x1));
          g.grad.setAttribute('x2', f2(x1 + g.L));
          const o = fade / g.L;
          [0, o, 1 - o, 1].forEach((v, j) => g.stops[j].setAttribute('offset', f2(v)));
          for (const node of [g.maskRect, g.mask]) {
            node.setAttribute('x', f2(x1 - 60));
            node.setAttribute('width', f2(g.L + 120));
            node.setAttribute('y', f2(-this.H));
            node.setAttribute('height', f2(this.H * 3));
          }
          w.maskSet = true;
        }
        const endA = String(f2(smooth(0, 0.3, k)));
        if (endA !== w.endA) {
          g.stops[0].setAttribute('stop-opacity', endA);
          g.stops[3].setAttribute('stop-opacity', endA);
          g.stops[1].setAttribute('stop-opacity', '1');
          g.stops[2].setAttribute('stop-opacity', '1');
          w.endA = endA;
        }
      }
      if (wantMask !== !!w.mask) {
        if (wantMask) g.gm.setAttribute('mask', `url(#rm-${this.id}-${g.i})`);
        else g.gm.removeAttribute('mask');
        w.mask = wantMask;
      }
    }
  }
}

export function init() {
  const roots = [...document.querySelectorAll('[data-rings]')];
  const made = [];
  for (const root of roots) {
    try {
      made.push(new Rings(root));
    } catch (e) {
      // Leave the plain list in place.
      root.classList.remove('rings--live');
      root.querySelectorAll('.rings-layers, .rings-meter').forEach((n) => n.remove());
      console.warn(`[rings] ${e && e.message ? e.message : e}`);
    }
  }
  return { rings: made.length };
}
