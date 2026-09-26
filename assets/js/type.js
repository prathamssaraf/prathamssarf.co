// Kinetic type.
//
// .kinetic headings are split into words that slam in one by one from
// alternating sides with a lean and a horizontal-only motion blur (a
// per-heading SVG filter, stdDeviation "X 0"). The data-bracket word then gets
// four L-shaped corner brackets that snap in with a small overshoot.
// .typeon lines retype themselves with a block cursor that blinks twice.
// Both play once, on the first .is-in (set by scenes.js).

const WORD_STAGGER = 70;   // ms between words
const WORD_DUR = 520;      // ms per word
const FADE_MS = 50;        // opacity ramp at the start of each word
const DIST_MIN = 60;       // px, start offset range
const DIST_MAX = 140;
const LEAN_DEG = 8;
const BLUR_MAX = 18;       // stdDeviation X at launch
const BLUR_KEEP = 0.35;    // a word keeps the shared blur while its own is >= this share
const BRACKET_AT = 0.6;    // word progress at which its brackets snap in
const BRACKET_MS = 220;

const CHAR_MS = 16;
const TYPE_STAGGER = 110;  // ms between type-on lines that start together
const BLINK_MS = 260;

const SVG_NS = 'http://www.w3.org/2000/svg';

const BASE_CSS = `
:where(.kinetic .w){display:inline-block;position:relative;white-space:nowrap}
:where(.kinetic .w-i){display:inline-block}
:where(.kinetic .w-glue){white-space:nowrap}
:where(.kinetic .w-core){display:inline-block;position:relative}
:where(.kinetic .w-core.has-pre){margin-left:.24em}
:where(.kinetic .w-core.has-post){margin-right:.24em}
:where(.kinetic .kin-frame){--kin-sw:var(--kin-stroke,max(2px,.037em));position:absolute;top:var(--kin-t,0);bottom:var(--kin-b,0);left:calc(-1 * var(--kin-x,.19em));right:calc(-1 * var(--kin-x,.19em));pointer-events:none;transform-origin:50% 50%}
:where(.kinetic .w:has(+ .w.is-bracketed)),:where(.kinetic .w.is-bracketed:has(+ .w)){margin-right:var(--kin-x,.19em)}
:where(.kinetic .kin-c){position:absolute;width:.2em;height:.28em;box-sizing:border-box;border:0 solid var(--kin-bracket,currentColor)}
:where(.kinetic .kin-tl){top:0;left:0;border-top-width:var(--kin-sw);border-left-width:var(--kin-sw)}
:where(.kinetic .kin-tr){top:0;right:0;border-top-width:var(--kin-sw);border-right-width:var(--kin-sw)}
:where(.kinetic .kin-bl){bottom:0;left:0;border-bottom-width:var(--kin-sw);border-left-width:var(--kin-sw)}
:where(.kinetic .kin-br){bottom:0;right:0;border-bottom-width:var(--kin-sw);border-right-width:var(--kin-sw)}
:where(.typeon .to-cur-a){position:relative}
:where(.typeon .to-cur){position:absolute;left:.06em;top:.12em;bottom:.08em;width:.62em;background:currentColor;pointer-events:none}
`;

let reduced = false;
let defs = null;
let headingSeq = 0;
const headings = [];
const typeons = [];
const byEl = new Map();
const frames = [];

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
// Overshoot curve for the bracket snap (easeOutBack, gentle).
const backOut = (t) => {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

// Deterministic 0..1 per index so a reload replays the same choreography.
function hash01(i) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function normWord(s) {
  return String(s || '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function injectBaseStyles() {
  if (document.getElementById('type-base-css')) return;
  const style = document.createElement('style');
  style.id = 'type-base-css';
  style.textContent = BASE_CSS;
  document.head.prepend(style); // first, so site CSS wins on equal specificity
}

function getDefs() {
  if (defs && defs.isConnected) return defs;
  let svg = document.querySelector('svg.fx-defs');
  if (!svg) {
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'fx-defs');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    document.body.appendChild(svg);
  }
  defs = svg.querySelector('defs') || svg.appendChild(document.createElementNS(SVG_NS, 'defs'));
  return defs;
}

function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

// Horizontal blur plus two faint echoes either side: the smeared ghosting of
// a word shot at a slow shutter.
function makeBlurFilter(id) {
  const filter = svgEl('filter', {
    id, x: '-100%', y: '-15%', width: '300%', height: '130%',
    'color-interpolation-filters': 'sRGB',
  }, getDefs());
  const blur = svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0 0', result: 'b' }, filter);
  const echoA = svgEl('feOffset', { in: 'b', dx: '0', dy: '0', result: 'e1' }, filter);
  const echoB = svgEl('feOffset', { in: 'b', dx: '0', dy: '0', result: 'e2' }, filter);
  const fadeA = svgEl('feComponentTransfer', { in: 'e1', result: 'f1' }, filter);
  svgEl('feFuncA', { type: 'linear', slope: '.34' }, fadeA);
  const fadeB = svgEl('feComponentTransfer', { in: 'e2', result: 'f2' }, filter);
  svgEl('feFuncA', { type: 'linear', slope: '.22' }, fadeB);
  const merge = svgEl('feMerge', {}, filter);
  svgEl('feMergeNode', { in: 'f2' }, merge);
  svgEl('feMergeNode', { in: 'f1' }, merge);
  svgEl('feMergeNode', { in: 'b' }, merge);
  return { filter, blur, echoA, echoB, last: -1 };
}

function setBlur(fx, x) {
  const v = Math.round(x * 20) / 20;
  if (v === fx.last) return;
  fx.last = v;
  fx.blur.setAttribute('stdDeviation', `${v} 0`);
  fx.echoA.setAttribute('dx', String(Math.round(v * 1.6 * 10) / 10));
  fx.echoB.setAttribute('dx', String(Math.round(-v * 1.1 * 10) / 10));
}

// ================================================================ kinetic

function makeWord(text) {
  const w = document.createElement('span');
  w.className = 'w';
  w.setAttribute('aria-hidden', 'true');
  const inner = document.createElement('span');
  inner.className = 'w-i';
  inner.textContent = text;
  w.appendChild(inner);
  return { outer: w, inner, text };
}

const SKIP_TAGS = new Set(['BR', 'SVG', 'IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'SCRIPT', 'STYLE']);

// Replace text nodes with word spans, recursing into inline wrappers
// (<em>, <a>, …) so their styling survives.
function splitInto(node, words) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const frag = document.createDocumentFragment();
      for (const part of child.data.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(' '));
        } else {
          const w = makeWord(part);
          words.push(w);
          frag.appendChild(w.outer);
        }
      }
      child.replaceWith(frag);
    } else if (child.nodeType === Node.ELEMENT_NODE && !SKIP_TAGS.has(child.tagName.toUpperCase())
      && (child.textContent || '').trim()) {
      splitInto(child, words);
    }
  }
}

// An empty inline right after a word (e.g. the red .dot-period) must not
// wrap onto its own line: glue it to that word.
function glueTrailers(h) {
  h.querySelectorAll('.w').forEach((w) => {
    const next = w.nextSibling;
    if (next && next.nodeType === Node.ELEMENT_NODE && !next.classList.contains('w')
      && next.tagName !== 'BR' && !(next.textContent || '').trim()) {
      const glue = document.createElement('span');
      glue.className = 'w-glue';
      w.before(glue);
      glue.append(w, next);
    }
  });
}

// Frame only the letters: leading/trailing punctuation ("frame," / "(work)")
// stays outside the brackets.
function bracketHost(word) {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(word.text);
  if (!m || (!m[1] && !m[3]) || !m[2]) return word.outer;
  const core = document.createElement('span');
  core.className = 'w-core';
  core.textContent = m[2];
  if (m[1]) core.classList.add('has-pre');
  if (m[3]) core.classList.add('has-post');
  word.inner.textContent = '';
  if (m[1]) word.inner.append(m[1]);
  word.inner.append(core);
  if (m[3]) word.inner.append(m[3]);
  return core;
}

// Montserrat metrics (em): ascent, descent, cap height. The frame sits
// PAD_TOP above the caps and PAD_BOTTOM below the baseline, whatever the
// heading's line-height, so the brackets hug the letters like a crop mark.
const FONT_ASC = 0.968;
const FONT_DESC = 0.251;
const FONT_CAP = 0.7;
const PAD_TOP = 0.11;
const PAD_BOTTOM = 0.12;

function fitFrame(frame) {
  const cs = getComputedStyle(frame.parentNode);
  const size = parseFloat(cs.fontSize) || 16;
  const lh = cs.lineHeight === 'normal' ? (FONT_ASC + FONT_DESC) : (parseFloat(cs.lineHeight) || size) / size;
  const half = (lh - FONT_ASC - FONT_DESC) / 2; // half-leading, may be negative
  const top = FONT_ASC + half - FONT_CAP - PAD_TOP;
  const bottom = FONT_DESC + half - PAD_BOTTOM;
  frame.style.setProperty('--kin-t', `${top.toFixed(3)}em`);
  frame.style.setProperty('--kin-b', `${bottom.toFixed(3)}em`);
}

function addBrackets(word) {
  const host = bracketHost(word);
  const frame = document.createElement('span');
  frame.className = 'kin-frame';
  frame.setAttribute('aria-hidden', 'true');
  for (const pos of ['tl', 'tr', 'bl', 'br']) {
    const c = document.createElement('span');
    c.className = `kin-c kin-${pos}`;
    frame.appendChild(c);
  }
  word.outer.classList.add('is-bracketed');
  host.appendChild(frame);
  fitFrame(frame);
  frames.push(frame);
  return frame;
}

function prepareHeading(h) {
  if (h.dataset.kineticReady) return;
  h.dataset.kineticReady = '1';
  const label = (h.textContent || '').replace(/\s+/g, ' ').trim();
  if (!label) return;
  if (!h.hasAttribute('aria-label')) h.setAttribute('aria-label', label);

  const words = [];
  splitInto(h, words);
  glueTrailers(h);
  if (!words.length) return;

  const want = normWord(h.dataset.bracket);
  const bracketWord = want ? words.find((w) => normWord(w.text) === want) : null;
  const frame = bracketWord ? addBrackets(bracketWord) : null;

  const seq = headingSeq++;
  const id = `kin-blur-${seq}`;
  const st = {
    el: h,
    words: words.map((w, i) => {
      const dir = i % 2 === 0 ? 1 : -1; // +1: enters from the left, moving right
      return {
        ...w,
        dir,
        dist: DIST_MIN + (DIST_MAX - DIST_MIN) * hash01(seq * 31 + i),
        delay: i * WORD_STAGGER,
        blurred: false,
        bracket: w === bracketWord,
      };
    }),
    frame,
    bracketAt: -1,
    filterId: id,
    fx: null,
    raf: 0,
    t0: 0,
    played: false,
  };
  headings.push(st);
  byEl.set(h, st);

  if (reduced || h.classList.contains('is-in')) {
    if (reduced) finishHeading(st);
    else playHeading(st);
  } else {
    for (const w of st.words) w.inner.style.opacity = '0';
    if (frame) frame.style.opacity = '0';
  }
}

// The filter region is a fraction of each word's box. Make it just wide
// enough that the narrowest word's smear (3 sigma + echo offset) isn't cut.
function sizeFilterRegion(st) {
  let minW = Infinity;
  for (const w of st.words) {
    const width = w.inner.offsetWidth;
    if (width > 0 && width < minW) minW = width;
  }
  if (!Number.isFinite(minW)) return;
  const margin = BLUR_MAX * (3 + 1.6) + 8;
  const frac = Math.min(4, margin / minW);
  st.fx.filter.setAttribute('x', `${(-frac * 100).toFixed(1)}%`);
  st.fx.filter.setAttribute('width', `${((1 + 2 * frac) * 100).toFixed(1)}%`);
}

function playHeading(st) {
  if (st.played) return;
  st.played = true;
  if (reduced) {
    finishHeading(st);
    return;
  }
  st.fx = st.fx || makeBlurFilter(st.filterId);
  sizeFilterRegion(st);
  for (const w of st.words) w.inner.style.willChange = 'transform, opacity';
  st.t0 = performance.now();
  const step = (now) => {
    st.raf = 0;
    if (stepHeading(st, now - st.t0)) st.raf = requestAnimationFrame(step);
    else finishHeading(st);
  };
  st.raf = requestAnimationFrame(step);
}

// Returns true while anything is still moving.
function stepHeading(st, t) {
  const url = `url(#${st.filterId})`;
  let blur = 0;
  let moving = false;

  // Pass 1: position every word, find the fastest one for the shared blur.
  for (const w of st.words) {
    const lt = t - w.delay;
    if (lt <= 0) {
      moving = true;
      w.own = 0;
      continue;
    }
    const p = Math.min(1, lt / WORD_DUR);
    const rest = 1 - expoOut(p); // also proportional to speed under expo-out
    const x = w.dir * -w.dist * rest;
    const skew = -LEAN_DEG * w.dir * rest; // lean into the direction of travel
    w.inner.style.transform = rest > 0.0005 ? `translate3d(${x.toFixed(2)}px,0,0) skewX(${skew.toFixed(3)}deg)` : '';
    w.inner.style.opacity = lt >= FADE_MS ? '' : (lt / FADE_MS).toFixed(3);
    w.own = BLUR_MAX * rest;
    if (w.own > blur) blur = w.own;
    if (p < 1) moving = true;
    if (w.bracket && st.bracketAt < 0 && p >= BRACKET_AT) st.bracketAt = t;
  }

  // Pass 2: the filter is shared, so only words still near that speed wear it;
  // nearly landed words stay crisp.
  for (const w of st.words) {
    const wear = blur > 0.2 && w.own > 0.2 && w.own >= blur * BLUR_KEEP;
    if (wear !== w.blurred) {
      w.blurred = wear;
      w.inner.style.filter = wear ? url : '';
    }
  }
  setBlur(st.fx, blur);

  if (st.frame && st.bracketAt >= 0) {
    const bp = Math.min(1, (t - st.bracketAt) / BRACKET_MS);
    const s = 1 + 0.12 * (1 - backOut(bp));
    st.frame.style.opacity = bp > 0 ? '' : '0';
    st.frame.style.transform = bp < 1 ? `scale(${s.toFixed(4)})` : '';
    if (bp < 1) moving = true;
  } else if (st.frame) {
    moving = true;
  }
  return moving;
}

function finishHeading(st) {
  st.played = true;
  if (st.raf) cancelAnimationFrame(st.raf);
  st.raf = 0;
  for (const w of st.words) {
    const s = w.inner.style;
    s.transform = '';
    s.opacity = '';
    s.filter = '';
    s.willChange = '';
    w.blurred = false;
  }
  if (st.frame) {
    st.frame.style.opacity = '';
    st.frame.style.transform = '';
  }
  if (st.fx) {
    st.fx.filter.remove();
    st.fx = null;
  }
}

// ================================================================ type-on

function prepareTypeon(el) {
  if (el.dataset.typeonReady) return;
  el.dataset.typeonReady = '1';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const runs = [];
  let total = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    runs.push({ node: n, full: n.data, rest: null, shown: -1 });
    total += n.data.length;
  }
  if (!total) return;
  const st = { el, runs, total, played: false, raf: 0, cursorA: null, cursor: null };
  typeons.push(st);
  byEl.set(el, st);

  if (reduced) {
    st.played = true;
    return;
  }
  // Keep every character in layout so nothing below shifts. Transparent, not
  // hidden: the full line stays in the accessibility tree and find-in-page.
  for (const r of runs) {
    r.rest = document.createElement('span');
    r.rest.className = 'to-rest';
    r.rest.style.color = 'transparent';
    r.node.after(r.rest);
    showChars(r, 0);
  }
  if (el.classList.contains('is-in')) playTypeon(st);
}

function showChars(r, n) {
  if (n === r.shown) return;
  r.shown = n;
  r.node.data = r.full.slice(0, n);
  r.rest.textContent = r.full.slice(n);
}

let batchAt = -1;
let batchN = 0;

function playTypeon(st) {
  if (st.played) return;
  st.played = true;
  if (reduced) {
    finishTypeon(st);
    return;
  }
  const now = performance.now();
  if (now - batchAt > 40) {
    batchAt = now;
    batchN = 0;
  }
  const delay = batchN++ * TYPE_STAGGER;

  st.cursorA = document.createElement('span');
  st.cursorA.className = 'to-cur-a';
  st.cursorA.setAttribute('aria-hidden', 'true');
  st.cursor = document.createElement('span');
  st.cursor.className = 'to-cur';
  st.cursorA.appendChild(st.cursor);
  st.runs[0].node.after(st.cursorA);

  const t0 = now + delay;
  let cursorRun = 0;
  const step = (time) => {
    st.raf = 0;
    const t = time - t0;
    let left = Math.max(0, Math.floor(t / CHAR_MS));
    let at = 0;
    for (let i = 0; i < st.runs.length; i++) {
      const r = st.runs[i];
      const n = Math.min(r.full.length, left);
      showChars(r, n);
      left -= n;
      if (n > 0 || i === 0) at = i;
    }
    if (at !== cursorRun) {
      cursorRun = at;
      st.runs[at].node.after(st.cursorA);
    }
    const typed = Math.floor(Math.max(0, t) / CHAR_MS);
    if (typed < st.total) {
      st.raf = requestAnimationFrame(step);
      return;
    }
    // Two blinks, then gone: off, on, off, on, off.
    const phase = Math.floor((t - st.total * CHAR_MS) / BLINK_MS);
    if (phase >= 4) {
      finishTypeon(st);
      return;
    }
    st.cursor.style.visibility = phase % 2 === 0 ? 'hidden' : '';
    st.raf = requestAnimationFrame(step);
  };
  st.raf = requestAnimationFrame(step);
}

function finishTypeon(st) {
  st.played = true;
  if (st.raf) cancelAnimationFrame(st.raf);
  st.raf = 0;
  for (const r of st.runs) {
    r.node.data = r.full;
    if (r.rest) r.rest.remove();
    r.rest = null;
  }
  if (st.cursorA) st.cursorA.remove();
  st.cursorA = st.cursor = null;
}

// ================================================================ triggers

function trigger(el) {
  const st = byEl.get(el);
  if (!st) return;
  if (st.words) playHeading(st);
  else playTypeon(st);
}

function watch(els) {
  // Primary: scenes.js adds .is-in.
  if ('MutationObserver' in window) {
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.target.classList.contains('is-in')) trigger(r.target);
      }
    });
    els.forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
  }
  // Fallback: if scenes.js never runs, words must not stay hidden.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.2) {
          io.unobserve(e.target);
          // Give scenes.js the first word (same threshold) so both agree.
          setTimeout(() => trigger(e.target), 120);
        }
      }
    }, { threshold: [0.2] });
    els.forEach((el) => io.observe(el));
  } else {
    els.forEach(trigger);
  }
}

function onMotionChange(e) {
  reduced = !!(e.detail && e.detail.reduced);
  if (!reduced) return;
  headings.forEach(finishHeading);
  typeons.forEach(finishTypeon);
}

export function init(opts = {}) {
  reduced = typeof opts.reduced === 'boolean'
    ? opts.reduced
    : document.documentElement.classList.contains('reduced');
  const kinetic = Array.from(document.querySelectorAll('.kinetic'));
  const typeon = Array.from(document.querySelectorAll('.typeon'));
  if (!kinetic.length && !typeon.length) return;

  injectBaseStyles();
  kinetic.forEach(prepareHeading);
  typeon.forEach(prepareTypeon);
  watch([...kinetic, ...typeon].filter((el) => byEl.has(el)));
  window.addEventListener('motion:change', onMotionChange);
  // A printout gets every heading and line, played or not.
  window.addEventListener('beforeprint', () => {
    headings.forEach((st) => { if (!st.played || st.raf) finishHeading(st); });
    typeons.forEach((st) => { if (!st.played || st.raf) finishTypeon(st); });
  });
  let refit = 0;
  const refitAll = () => {
    refit = 0;
    frames.forEach(fitFrame);
  };
  window.addEventListener('resize', () => {
    if (!refit) refit = requestAnimationFrame(refitAll);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitAll).catch(() => {});
}
