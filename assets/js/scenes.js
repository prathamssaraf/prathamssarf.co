// Scroll controller. Owns the active section, the hard theme cut, the morph
// window between neighbouring scenes, and the .is-in reveal flags.
//
// Events (on window):
//   scene:change   {index, count, id, scene, theme, label, el}
//   scene:progress {from, to, blend, fromEl, toEl, index, global, velocity}

const REVEAL_SELECTOR = '[data-reveal], .kinetic, .typeon, section.scene';
const REVEAL_AT = 0.2;

// Morph window, in viewport heights relative to the centre line (+ is below).
// blend is 0 when the next section's top is MORPH_START below the line and
// reaches 1 when it is -MORPH_END above it, just after the theme cut at 0.
const MORPH_START = 0.55;
const MORPH_END = -0.05;

const FRAME_MS = 1000 / 60;
const FONT_WAIT_MS = 1200;

const state = {
  sections: [],
  tops: [],
  vh: 0,
  scrollMax: 1,
  active: -1,
  ready: false,
  dirty: true,
  forceProgress: false,
  frame: 0,
  lastY: 0,
  lastT: 0,
  idle: true,
  velocity: 0,
  reduced: false,
  userMoved: false,
};

const html = document.documentElement;

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------- layout

function measure() {
  const y = window.scrollY;
  state.vh = window.innerHeight || html.clientHeight || 1;
  state.tops = state.sections.map((s) => s.getBoundingClientRect().top + y);
  state.scrollMax = Math.max(1, html.scrollHeight - state.vh);
  state.dirty = false;
}

// Last section whose top is at or above the line (document order).
function activeAt(line) {
  let idx = 0;
  for (let i = 0; i < state.tops.length; i++) {
    if (state.tops[i] <= line) idx = i;
  }
  return idx;
}

// Morph between k-1 and k around the boundary nearest the centre line.
function morphAt(line, active) {
  const { tops, vh } = state;
  let k = -1;
  let best = Infinity;
  for (let i = 1; i < tops.length; i++) {
    const dist = Math.abs(tops[i] - line);
    if (dist < best) {
      best = dist;
      k = i;
    }
  }
  if (k > 0) {
    const d = (tops[k] - line) / vh;
    if (d <= MORPH_START && d >= MORPH_END) {
      return {
        fromIdx: k - 1,
        toIdx: k,
        blend: clamp01((MORPH_START - d) / (MORPH_START - MORPH_END)),
      };
    }
  }
  return { fromIdx: active, toIdx: active, blend: 0 };
}

// ---------------------------------------------------------------- theme

function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  if (bg && meta.getAttribute('content') !== bg) meta.setAttribute('content', bg);
}

function setActive(idx, announce) {
  const el = state.sections[idx];
  if (!el) return;
  state.active = idx;
  const theme = el.dataset.theme;
  if (theme && document.body.dataset.theme !== theme) {
    // Hard cut. Colour transitions sit out this frame (site.css, .theme-cut)
    // so buttons and cards switch with the background.
    html.classList.add('theme-cut');
    requestAnimationFrame(() => requestAnimationFrame(() => html.classList.remove('theme-cut')));
    document.body.dataset.theme = theme;
    syncThemeColor();
  }
  if (announce) {
    dispatch('scene:change', {
      index: idx,
      count: state.sections.length,
      id: el.id,
      scene: el.dataset.scene || '',
      theme: theme || '',
      label: el.dataset.label || '',
      el,
    });
  }
}

// ---------------------------------------------------------------- frame loop

function schedule() {
  if (!state.frame) state.frame = requestAnimationFrame(tick);
}

// Scroll events run before this frame's animation callbacks, so ticking here
// cuts the theme and emits progress before dots.js draws the frame (a frame
// queued from here would only run after it).
function onScroll() {
  if (state.frame) {
    cancelAnimationFrame(state.frame);
    state.frame = 0;
  }
  tick(performance.now());
}

function tick(now) {
  state.frame = 0;
  if (!state.sections.length) return;
  if (state.dirty) measure();

  const y = window.scrollY;
  const dy = y - state.lastY;
  // Normalise to px per 60 Hz frame; the first frame after idling counts as one.
  const frames = state.idle ? 1 : Math.min(4, Math.max(1, (now - state.lastT) / FRAME_MS));
  const velocity = dy / frames;
  state.lastY = y;
  state.lastT = now;

  const line = y + state.vh / 2;
  const idx = activeAt(line);
  if (idx !== state.active) setActive(idx, state.ready);

  const settled = dy === 0 && state.velocity !== 0; // report the stop once
  if (state.ready && (dy !== 0 || settled || state.forceProgress)) {
    emitProgress(line, velocity);
  }
  state.velocity = velocity;
  state.forceProgress = false;

  if (dy !== 0) {
    state.idle = false;
    schedule(); // one more frame to catch the stop and zero the velocity
  } else {
    state.idle = true;
  }
}

function emitProgress(line, velocity) {
  const { sections, active } = state;
  const m = morphAt(line, active);
  const fromEl = sections[m.fromIdx];
  const toEl = sections[m.toIdx];
  dispatch('scene:progress', {
    from: fromEl.dataset.scene || '',
    to: toEl.dataset.scene || '',
    blend: m.blend,
    fromEl,
    toEl,
    index: active,
    global: clamp01(window.scrollY / state.scrollMax),
    velocity,
  });
}

// Remeasure and re-emit on the next frame (layout changed, not scroll).
function invalidate() {
  state.dirty = true;
  state.forceProgress = true;
  schedule();
}

// ---------------------------------------------------------------- reveals

function observeReveals() {
  const els = document.querySelectorAll(REVEAL_SELECTOR);
  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  // Extra low thresholds so blocks taller than 5 viewports still register:
  // those count as "in" once they cover 20 % of the viewport.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const viewH = (e.rootBounds && e.rootBounds.height) || state.vh || window.innerHeight;
      if (e.intersectionRatio >= REVEAL_AT || e.intersectionRect.height >= viewH * REVEAL_AT) {
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    }
  }, { threshold: [0, 0.02, 0.05, 0.1, 0.15, REVEAL_AT] });
  els.forEach((el) => {
    if (!el.classList.contains('is-in')) io.observe(el);
  });
}

// ---------------------------------------------------------------- links

function jumpTo(target, smooth) {
  if (smooth) {
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  // Beat any CSS scroll-behavior: smooth for an instant jump.
  const prev = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';
  target.scrollIntoView({ block: 'start', behavior: 'auto' });
  html.style.scrollBehavior = prev;
}

function focusTarget(target) {
  if (!target.matches('a[href], button, input, select, textarea, [tabindex]')) {
    target.setAttribute('tabindex', '-1');
  }
  try {
    target.focus({ preventScroll: true });
  } catch (_) {
    /* old browsers: focus is a nicety here */
  }
}

// A mobile menu may be a popover, a <details>, or a toggle button; close it.
function closeMenus(link) {
  const pop = link.closest('[popover]');
  if (pop && typeof pop.hidePopover === 'function') {
    try { pop.hidePopover(); } catch (_) { /* already hidden */ }
  }
  const det = link.closest('details[open]');
  if (det) det.open = false;
  const nav = link.closest('.site-nav');
  if (nav) {
    const toggle = nav.querySelector('button[aria-expanded="true"]');
    if (toggle && !toggle.contains(link)) toggle.click();
  }
}

function onLinkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
  if (!link) return;
  let id = '';
  try {
    id = decodeURIComponent(link.getAttribute('href').slice(1));
  } catch (_) {
    return;
  }
  const target = id && document.getElementById(id);
  if (!target) return;
  e.preventDefault();
  closeMenus(link);
  jumpTo(target, !state.reduced);
  if (location.hash !== `#${id}`) history.pushState(null, '', `#${id}`);
  focusTarget(target);
}

// Deep link (#projects): the browser jumps before fonts and images settle,
// so re-align once layout is final, unless the visitor has already moved.
function alignToHash() {
  if (state.userMoved || !location.hash) return;
  const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  if (nav && nav.type === 'back_forward') return; // browser restores position
  if (nav && nav.type === 'reload' && window.scrollY > 0) return;
  let target = null;
  try {
    target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  } catch (_) {
    return;
  }
  if (target) jumpTo(target, false);
}

function markUserMoved() {
  state.userMoved = true;
}

// ---------------------------------------------------------------- start

function whenFontsReady() {
  const fonts = document.fonts && document.fonts.ready;
  const timeout = new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS));
  return fonts ? Promise.race([fonts.catch(() => {}), timeout]) : Promise.resolve();
}

function start() {
  alignToHash();
  measure();
  state.lastY = window.scrollY;
  state.idle = true;
  state.ready = true;
  setActive(activeAt(state.lastY + state.vh / 2), true);
  state.forceProgress = true;
  if (state.frame) {
    cancelAnimationFrame(state.frame);
    state.frame = 0;
  }
  tick(performance.now());
}

function onLayoutSettled() {
  alignToHash();
  invalidate();
}

export function init(opts = {}) {
  state.sections = Array.from(document.querySelectorAll('section.scene'));
  state.reduced = typeof opts.reduced === 'boolean' ? opts.reduced : html.classList.contains('reduced');

  observeReveals();
  document.addEventListener('click', onLinkClick);
  window.addEventListener('motion:change', (e) => {
    state.reduced = !!(e.detail && e.detail.reduced);
    // The switch resizes the skills track and main.js scrolls to make up for
    // it; section tops must be fresh before that scroll event is handled.
    if (state.sections.length) invalidate();
  });

  if (!state.sections.length) return;

  // Theme is right from the first paint; events wait for fonts + one frame.
  measure();
  state.lastY = window.scrollY;
  setActive(activeAt(state.lastY + state.vh / 2), false);

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', invalidate);
  window.addEventListener('orientationchange', invalidate);
  if (document.readyState !== 'complete') {
    window.addEventListener('load', onLayoutSettled, { once: true });
  }
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((type) => {
    window.addEventListener(type, markUserMoved, { passive: true, once: true });
  });

  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      if (state.ready) invalidate();
      else state.dirty = true;
    });
    state.sections.forEach((s) => ro.observe(s));
  }

  whenFontsReady().then(() => requestAnimationFrame(start));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (state.ready) onLayoutSettled();
    }).catch(() => {});
  }
}

// Other modules may call this after changing layout (e.g. building content).
export function refresh() {
  invalidate();
}
