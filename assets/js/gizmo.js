// Project-card gizmo: the card's shape as a polar radius function sampled at
// 96 angles (so any shape morphs into any other), idling in a slow spin. On
// hover / focus-within (or, on touch, when the card crosses the viewport
// centre) a thin transform box draws on around it, a mono readout reports
// ROT / SHAPE, and the shape springs into the next one in the cycle, leaving
// fading echo outlines and a short rotational smear behind it.
//
// One rAF loop drives every card; cards off-screen are skipped and the loop
// stops entirely when nothing is visible or animating.

const SVGNS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const N = 96;
const COS = new Float64Array(N);
const SIN = new Float64Array(N);
for (let j = 0; j < N; j++) {
  COS[j] = Math.cos((j / N) * TAU);
  SIN[j] = Math.sin((j / N) * TAU);
}

const ORDER = ['circle', 'squircle', 'triangle', 'flower'];

// Geometry, in viewBox units (the viewBox is 160 wide, centred on 0,0).
const UNIT = 46; // shape radius scale
const BOX = 56; // half side of the transform box
const HANDLE = 5.5;

// Timing.
const IDLE_DPS = 6; // idle spin, degrees per second
const MORPH_MS = 480;
const KICK_MS = 820; // rotation kick that accompanies a morph
const KICK_DEG = 96;
const DRAW_MS = 440; // box draw-on
const FADE_MS = 240; // box fade-out
const CYCLE_MS = 3400; // auto-advance while a card stays active
const ORIGIN_MS = 700; // the outline of the shape we morphed away from
const ECHO_TAIL_MS = 420; // lagged echoes linger this long after a morph
const ECHO_LAGS = [70, 150];
const ECHO_ALPHA = [0.55, 0.3];
const HISTORY_MS = 260;

// ------------------------------------------------------------------ shapes

function superellipse(t, n, s) {
  const c = Math.abs(Math.cos(t));
  const k = Math.abs(Math.sin(t));
  return s * Math.pow(Math.pow(c, n) + Math.pow(k, n), -1 / n);
}

// Regular polygon with inradius a and corner radius rho (the Minkowski sum of
// a smaller polygon and a disc), as an exact polar function. theta0 points at
// a vertex.
function roundedPolygon(t, sides, a, rho, theta0) {
  const seg = TAU / sides;
  const half = seg / 2;
  let u = (t - theta0) % seg;
  if (u < 0) u += seg;
  if (u > half) u -= seg; // angle from the nearest vertex direction
  const D = (a - rho) / Math.cos(half); // centre of the corner disc
  const tangent = Math.atan2(rho * Math.sin(half), D + rho * Math.cos(half));
  if (Math.abs(u) <= tangent) {
    const s = D * Math.sin(u);
    return D * Math.cos(u) + Math.sqrt(Math.max(0, rho * rho - s * s));
  }
  return a / Math.cos(Math.abs(u) - half);
}

// Flower: the union of a core disc and five round petals, so the lobes stay
// round and meet in soft cusps (a plain r = a + b·cos 5θ reads as a starfish).
function petals(t, count, d, rho, core, theta0) {
  let r = core;
  for (let k = 0; k < count; k++) {
    const u = t - theta0 - (k * TAU) / count;
    const s = d * Math.sin(u);
    const disc = rho * rho - s * s;
    if (disc > 0) r = Math.max(r, d * Math.cos(u) + Math.sqrt(disc));
  }
  return r;
}

const SHAPES = {
  circle: () => 0.87,
  squircle: (t) => superellipse(t, 5, 0.78),
  triangle: (t) => roundedPolygon(t, 3, 0.53, 0.2, -Math.PI / 2),
  flower: (t) => petals(t, 5, 0.5, 0.45, 0.62, -Math.PI / 2),
};

const SAMPLES = {};
for (const name of ORDER) {
  const r = new Float32Array(N);
  for (let j = 0; j < N; j++) r[j] = SHAPES[name]((j / N) * TAU) * UNIT;
  SAMPLES[name] = r;
}

const f2 = (v) => Math.round(v * 100) / 100;

// Closed Catmull-Rom spline through the 96 samples, as cubic Béziers.
function pathFrom(r, scale = 1) {
  const x = new Float64Array(N);
  const y = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    x[j] = COS[j] * r[j] * scale;
    y[j] = SIN[j] * r[j] * scale;
  }
  let d = `M${f2(x[0])} ${f2(y[0])}`;
  for (let j = 0; j < N; j++) {
    const a = (j + N - 1) % N;
    const b = (j + 1) % N;
    const c = (j + 2) % N;
    d += `C${f2(x[j] + (x[b] - x[a]) / 6)} ${f2(y[j] + (y[b] - y[a]) / 6)} ` +
      `${f2(x[b] - (x[c] - x[j]) / 6)} ${f2(y[b] - (y[c] - y[j]) / 6)} ${f2(x[b])} ${f2(y[b])}`;
  }
  return d + 'Z';
}

// ------------------------------------------------------------------ easing

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
// Back-out: fast start, ~6 % overshoot around t = .62, settles at 1.
const back = (s) => (t) => {
  const u = t - 1;
  return t >= 1 ? 1 : 1 + (s + 1) * u * u * u + s * u * u;
};
const morphEase = back(1.3);
const backOut = back(2.2);

// ------------------------------------------------------------------ colour

function parseColor(str) {
  const s = (str || '').trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ------------------------------------------------------------------ DOM

let uid = 0;

function el(name, attrs, parent) {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function build(host) {
  const id = ++uid;
  const fillId = `gz-fill-${id}`;
  const frameId = `gz-frame-${id}`;
  const svg = el('svg', {
    class: 'gz',
    viewBox: '-80 -80 160 160',
    'aria-hidden': 'true',
    focusable: 'false',
  });

  const echoes = el('g', { class: 'gz-echoes' }, svg);
  const echo = ECHO_LAGS.map(() => el('path', { class: 'gz-echo', opacity: '0' }, echoes));
  const origin = el('path', { class: 'gz-echo gz-echo--origin', opacity: '0' }, echoes);

  const smear = el('g', { class: 'gz-smear', opacity: '0' }, svg);
  const smearUses = [0.3, 0.14].map((a) => el('use', { href: `#${fillId}`, opacity: String(a) }, smear));

  const fill = el('path', { class: 'gz-fill', id: fillId }, svg);

  const box = el('g', { class: 'gz-box', opacity: '0' }, svg);
  const boxGhost = el('g', { class: 'gz-box-ghosts', opacity: '0' }, box);
  const boxGhostUses = [0.32, 0.14].map((a) => el('use', { href: `#${frameId}`, opacity: String(a) }, boxGhost));
  const frame = el('g', { class: 'gz-frame', id: frameId }, box);
  const B = BOX;
  const edges = [
    `M${-B} ${-B}H${B}`,
    `M${B} ${-B}V${B}`,
    `M${B} ${B}H${-B}`,
    `M${-B} ${B}V${-B}`,
  ].map((d) => el('path', { class: 'gz-edge', d, pathLength: '1', 'stroke-dasharray': '1 1', 'stroke-dashoffset': '1' }, frame));
  const handleSpots = [[-B, -B], [0, -B], [B, -B], [B, 0], [B, B], [0, B], [-B, B], [-B, 0]];
  const handles = handleSpots.map(([x, y]) => {
    const g = el('g', { transform: `translate(${x} ${y}) scale(0)` }, frame);
    el('rect', { class: 'gz-handle', x: -HANDLE / 2, y: -HANDLE / 2, width: HANDLE, height: HANDLE }, g);
    return { g, x, y };
  });

  const cross = el('g', { class: 'gz-cross', opacity: '0' }, svg);
  el('circle', { r: '3.4' }, cross);
  el('path', { d: 'M-7.5 0H7.5M0 -7.5V7.5' }, cross);

  const readout = document.createElement('div');
  readout.className = 'gz-readout';
  const rot = document.createElement('span');
  rot.className = 'gz-rot';
  const name = document.createElement('span');
  name.className = 'gz-name';
  readout.append(rot, name);

  host.textContent = '';
  host.append(svg, readout);
  host.classList.add('gz-live');

  return { svg, echo, origin, smear, smearUses, fill, box, boxGhost, boxGhostUses, frame, edges, handles, cross, readout, rot, name };
}

// ------------------------------------------------------------------ state

const cards = [];
let reduced = false;
let raf = 0;
let last = 0;
let touchMode = false;
let centerObserver = null;

function nextShape(name) {
  return ORDER[(ORDER.indexOf(name) + 1) % ORDER.length];
}

function makeCard(card, host) {
  const base = ORDER.includes(card.dataset.shape) ? card.dataset.shape : 'circle';
  const dom = build(host);
  const c = {
    card,
    host,
    dom,
    shape: base,
    radii: Float32Array.from(SAMPLES[base]),
    from: Float32Array.from(SAMPLES[base]),
    to: SAMPLES[base],
    originPath: '',
    morphing: false,
    m0: -1e9,
    mEnd: -1e9,
    spin: (card.dataset.gizmoSeed ? +card.dataset.gizmoSeed : cards.length * 37) % 360,
    kickFrom: 0,
    kickTo: 0,
    k0: -1e9,
    rot: 0,
    prevRot: null,
    omega: 0,
    active: false,
    hover: false,
    focus: false,
    centred: false,
    a0: -1e9, // activation start
    d0: -1e9, // deactivation start
    drawP: 0,
    boxAlpha: 0,
    nextCycle: 0,
    visible: false,
    history: [],
    pathDirty: true,
    text: { rot: '', name: '' },
    fillColor: '',
  };
  c.rot = c.spin;
  c.dom.fill.setAttribute('d', pathFrom(c.radii));
  applyTransform(c);
  writeReadout(c, 1);
  return c;
}

function startMorph(c, now, target) {
  if (reduced) return;
  c.from = Float32Array.from(c.radii);
  c.to = SAMPLES[target];
  c.shape = target;
  c.originPath = pathFrom(c.from);
  c.originRot = c.rot;
  c.dom.origin.setAttribute('d', c.originPath);
  c.m0 = now;
  c.morphing = true;
  // Accumulate the kick so back-to-back morphs keep spinning forward.
  const current = kickValue(c, now);
  c.kickFrom = current;
  c.kickTo = current + KICK_DEG;
  c.k0 = now;
  c.history.length = 0;
  c.nextCycle = now + MORPH_MS + CYCLE_MS;
}

function kickValue(c, now) {
  const t = clamp01((now - c.k0) / KICK_MS);
  return c.kickFrom + (c.kickTo - c.kickFrom) * expoOut(t);
}

function setActive(c, on) {
  if (c.active === on) return;
  c.active = on;
  const now = performance.now();
  if (on) {
    // Re-entering while the box is still fading: keep it drawn, skip the draw-on.
    c.a0 = c.boxAlpha > 0.05 ? now - DRAW_MS : now;
    if (!reduced) startMorph(c, now, nextShape(c.shape));
  } else {
    c.d0 = now;
    c.fromAlpha = c.boxAlpha;
  }
  wake();
}

function refreshActive(c) {
  setActive(c, c.hover || c.focus || c.centred);
}

// ------------------------------------------------------------------ frame

function applyTransform(c) {
  const r = f2(c.rot);
  c.dom.fill.setAttribute('transform', `rotate(${r})`);
  c.dom.cross.setAttribute('transform', `rotate(${r})`);
}

function writeReadout(c, typed) {
  let deg = ((c.rot % 360) + 360) % 360;
  if (reduced && !c.morphing) deg = ((c.spin % 360) + 360) % 360;
  const rotText = `ROT ${deg.toFixed(1).padStart(5, '0')}°`;
  const nameText = `SHAPE ${c.shape.toUpperCase()}`;
  const cut = (s) => (typed >= 1 ? s : s.slice(0, Math.ceil(s.length * typed)));
  const a = cut(rotText);
  const b = cut(nameText);
  if (a !== c.text.rot) c.dom.rot.textContent = c.text.rot = a;
  if (b !== c.text.name) c.dom.name.textContent = c.text.name = b;
}

function sampleHistory(c, t) {
  const h = c.history;
  for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) return h[i];
  return h[0];
}

function update(c, now, dt) {
  const d = c.dom;

  // Rotation: idle spin plus the morph kick.
  if (!reduced) c.spin += IDLE_DPS * dt;
  c.rot = c.spin + kickValue(c, now);
  if (c.prevRot !== null && dt > 0) {
    const w = (c.rot - c.prevRot) / dt;
    c.omega += (w - c.omega) * 0.5;
  }
  c.prevRot = c.rot;

  // Shape morph.
  if (c.morphing) {
    const t = (now - c.m0) / MORPH_MS;
    const e = morphEase(clamp01(t));
    for (let j = 0; j < N; j++) c.radii[j] = c.from[j] + (c.to[j] - c.from[j]) * e;
    if (t >= 1) {
      c.radii.set(c.to);
      c.morphing = false;
      c.mEnd = now;
    }
    c.pathDirty = true;
  }
  if (c.pathDirty) {
    d.fill.setAttribute('d', pathFrom(c.radii));
    c.pathDirty = false;
  }
  applyTransform(c);

  // Echoes: the outline a moment ago, and the shape we left.
  const echoLevel = c.morphing ? 1 : clamp01(1 - (now - c.mEnd) / ECHO_TAIL_MS);
  if (echoLevel > 0) {
    c.history.push({ t: now, rot: c.rot, r: Float32Array.from(c.radii) });
    while (c.history.length > 2 && now - c.history[0].t > HISTORY_MS) c.history.shift();
    ECHO_LAGS.forEach((lag, i) => {
      const s = sampleHistory(c, now - lag);
      d.echo[i].setAttribute('d', pathFrom(s.r, 1 + 0.03 * (i + 1)));
      d.echo[i].setAttribute('transform', `rotate(${f2(s.rot)})`);
      d.echo[i].setAttribute('opacity', f2(ECHO_ALPHA[i] * echoLevel));
    });
    c.echoOn = true;
  } else if (c.echoOn) {
    d.echo.forEach((p) => p.setAttribute('opacity', '0'));
    c.history.length = 0;
    c.echoOn = false;
  }
  const o = clamp01((now - c.m0) / ORIGIN_MS);
  if (o < 1) {
    const s = 1 + 0.07 * expoOut(o);
    d.origin.setAttribute('transform', `rotate(${f2(c.originRot)}) scale(${f2(s)})`);
    d.origin.setAttribute('opacity', f2(0.5 * (1 - o) * (1 - o)));
    c.originOn = true;
  } else if (c.originOn) {
    d.origin.setAttribute('opacity', '0');
    c.originOn = false;
  }

  // Rotational smear while spinning fast.
  const speed = Math.abs(c.omega);
  const smearAlpha = reduced ? 0 : clamp01((speed - 40) / 260);
  if (smearAlpha > 0.01) {
    // Clones inherit the source's own rotate(rot), so only the lag is applied here.
    const lag = (i) => f2(-Math.sign(c.omega) * Math.min(speed * 0.02, 14) * (i + 1));
    d.smearUses.forEach((u, i) => u.setAttribute('transform', `rotate(${lag(i)})`));
    d.boxGhostUses.forEach((u, i) => u.setAttribute('transform', `rotate(${lag(i)})`));
    d.smear.setAttribute('opacity', f2(smearAlpha));
    d.boxGhost.setAttribute('opacity', f2(smearAlpha));
    c.smearOn = true;
  } else if (c.smearOn) {
    d.smear.setAttribute('opacity', '0');
    d.boxGhost.setAttribute('opacity', '0');
    c.smearOn = false;
  }

  // Transform box: draws on when active, fades when released.
  let alpha;
  let draw;
  if (c.active) {
    const t = reduced ? 1 : clamp01((now - c.a0) / DRAW_MS);
    draw = expoOut(t);
    alpha = Math.max(c.boxAlpha, reduced ? 1 : clamp01(t * 4));
  } else {
    const t = reduced ? 1 : clamp01((now - c.d0) / FADE_MS);
    draw = c.drawP;
    alpha = (c.fromAlpha ?? 0) * (1 - t);
  }
  if (draw !== c.drawP) {
    const off = f2(1 - draw);
    d.edges.forEach((e) => e.setAttribute('stroke-dashoffset', off));
    const pop = backOut(clamp01((draw - 0.35) / 0.65));
    d.handles.forEach((h) => h.g.setAttribute('transform', `translate(${h.x} ${h.y}) scale(${f2(pop)})`));
    c.drawP = draw;
  }
  if (alpha !== c.boxAlpha) {
    d.box.setAttribute('opacity', f2(alpha));
    d.cross.setAttribute('opacity', f2(alpha));
    d.readout.style.opacity = f2(alpha);
    c.boxAlpha = alpha;
  }
  if (alpha > 0) {
    const pulse = c.morphing ? 1 + 0.035 * Math.sin(Math.PI * clamp01((now - c.m0) / MORPH_MS)) : 1;
    d.frame.setAttribute('transform', `rotate(${f2(c.rot)}) scale(${f2(pulse)})`);
    writeReadout(c, c.active && !reduced ? clamp01((now - c.a0) / (DRAW_MS * 0.9)) : 1);
  }
  if (!alpha && !c.active && c.drawP) {
    // Reset the draw-on so the next activation starts from nothing.
    c.drawP = 0;
    d.edges.forEach((e) => e.setAttribute('stroke-dashoffset', '1'));
    d.handles.forEach((h) => h.g.setAttribute('transform', `translate(${h.x} ${h.y}) scale(0)`));
  }

  // Keep cycling while the card stays active.
  if (c.active && !reduced && !c.morphing && now >= c.nextCycle) startMorph(c, now, nextShape(c.shape));
}

// Does this card need a frame? Visible cards idle-spin; off-screen ones only
// finish a morph already under way; reduced motion only settles the box.
function busy(c) {
  if (reduced) {
    const want = c.active ? 1 : 0;
    return c.boxAlpha !== want || c.drawP !== want;
  }
  return c.visible || c.morphing;
}

function frame(now) {
  raf = 0;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  let keep = false;
  for (const c of cards) {
    if (!busy(c)) continue;
    update(c, now, dt);
    keep = true;
  }
  if (keep && !document.hidden) raf = requestAnimationFrame(frame);
  else last = 0;
}

function wake() {
  if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ colour

function paint() {
  for (const c of cards) {
    const cs = getComputedStyle(c.card);
    // site.css maps data-accent to --card-accent, the same colour as the tag square.
    const accent = cs.getPropertyValue('--card-accent').trim() || cs.getPropertyValue('--accent').trim() || '#E8432F';
    const fg = cs.getPropertyValue('--fg').trim() || '#151517';
    const bg = parseColor(cs.getPropertyValue('--bg'));
    const a = parseColor(accent);
    // An accent that matches the page background would vanish: use the ink.
    const fill = bg && a && distance(a, bg) < 70 ? fg : accent;
    if (fill === c.fillColor) continue;
    c.fillColor = fill;
    const rgb = parseColor(fill);
    const on = rgb && luminance(rgb) > 0.55 ? '#151517' : '#F4F1EB';
    c.dom.svg.style.setProperty('--gz-fill', fill);
    c.dom.svg.style.setProperty('--gz-on', on);
  }
}

// ------------------------------------------------------------------ wiring

function bind(c) {
  const { card } = c;
  card.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch') return;
    c.hover = true;
    refreshActive(c);
  });
  card.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return;
    c.hover = false;
    refreshActive(c);
  });
  card.addEventListener('focusin', () => {
    c.focus = true;
    refreshActive(c);
  });
  card.addEventListener('focusout', () => {
    // focus may be moving to another element inside the same card
    requestAnimationFrame(() => {
      c.focus = card.matches(':focus-within');
      refreshActive(c);
    });
  });
}

function setTouchMode(on) {
  touchMode = on;
  if (centerObserver) {
    centerObserver.disconnect();
    centerObserver = null;
  }
  if (on && 'IntersectionObserver' in window) {
    // A thin band across the middle of the viewport: the card holding it is "hovered".
    centerObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const c = cards.find((k) => k.card === e.target);
        if (!c) continue;
        c.centred = e.isIntersecting;
        refreshActive(c);
      }
    }, { rootMargin: '-44% 0px -44% 0px', threshold: 0 });
    cards.forEach((c) => centerObserver.observe(c.card));
  } else {
    cards.forEach((c) => {
      c.centred = false;
      refreshActive(c);
    });
  }
}

function setReduced(on) {
  reduced = on;
  const now = performance.now();
  for (const c of cards) {
    if (on) {
      // Settle everything immediately: base shape, no spin, static box.
      const base = ORDER.includes(c.card.dataset.shape) ? c.card.dataset.shape : 'circle';
      c.morphing = false;
      c.shape = base;
      c.radii.set(SAMPLES[base]);
      c.to = SAMPLES[base];
      c.kickFrom = c.kickTo = 0;
      c.k0 = -1e9;
      c.spin = 0;
      c.omega = 0;
      c.m0 = -1e9;
      c.mEnd = -1e9;
      c.pathDirty = true;
    }
    c.prevRot = null;
    c.a0 = c.active ? now - DRAW_MS : c.a0;
    update(c, now, 0);
  }
  wake();
}

export function init(opts = {}) {
  const hosts = [...document.querySelectorAll('.card-gizmo')];
  if (!hosts.length) return { cards: 0 };

  const html = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  reduced = !!(opts.reduced ?? (html.classList.contains('reduced') || (mq && mq.matches)));

  for (const host of hosts) {
    const card = host.closest('.card') || host.parentElement;
    if (!card || cards.some((c) => c.card === card)) continue;
    const c = makeCard(card, host);
    cards.push(c);
    bind(c);
  }
  if (reduced) setReduced(true);

  const vis = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const c = cards.find((k) => k.card === e.target);
        if (c) c.visible = e.isIntersecting;
      }
      wake();
    }, { rootMargin: '120px 0px' })
    : null;
  cards.forEach((c) => {
    if (vis) vis.observe(c.card);
    else c.visible = true;
  });

  const hoverless = window.matchMedia ? window.matchMedia('(hover: none)') : null;
  setTouchMode(!!(hoverless && hoverless.matches));
  if (hoverless && hoverless.addEventListener) {
    hoverless.addEventListener('change', () => setTouchMode(hoverless.matches));
  }

  paint();
  window.addEventListener('scene:change', paint);
  window.addEventListener('motion:change', (e) => {
    const on = e.detail && typeof e.detail.reduced === 'boolean' ? e.detail.reduced : html.classList.contains('reduced');
    if (on !== reduced) setReduced(on);
  });
  // main.js normally announces motion changes; listen directly as a fallback.
  // It updates html.reduced first, including the visitor's own pause.
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', () => {
      const on = html.classList.contains('reduced');
      if (on !== reduced) setReduced(on);
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake();
  });

  wake();
  return { cards: cards.length };
}
